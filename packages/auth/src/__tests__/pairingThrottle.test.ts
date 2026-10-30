// Audit F-3 (D-117): the pairing throttle used one process-wide bucket that
// every source spent, so one LAN host spamming `/pair/preview` locked real
// pairing out for everyone. Per-source is now the primary limit, the
// server-wide ceiling counts only what a source's own budget admitted, and a
// genuinely local request is exempt from the ceiling.

import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { PairingError } from '../DeviceService.js';
import { mintFindable, setup } from './pairingFixtures.js';

const BOGUS = 'ABCD-EFGH-JKMN';

async function outcome(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof PairingError ? err.code : 'error';
  }
}

describe('pairing throttle (F-3)', () => {
  it('70 bogus previews from source A do not block a legit preview + complete from source B', async () => {
    const { service } = setup();
    const token = await mintFindable(service);

    const results: Record<string, number> = {};
    for (let i = 0; i < 70; i += 1) {
      const r = await outcome(service.previewPairingGrant({ pairingToken: BOGUS, sourceAddress: '192.168.1.66' }));
      results[r] = (results[r] ?? 0) + 1;
    }
    // A is limited by its own budget …
    expect(results).toEqual({ INVALID_GRANT: 10, THROTTLED: 60 });

    // … and B is untouched by it.
    const preview = await service.previewPairingGrant({ pairingToken: token, sourceAddress: '192.168.1.20' });
    expect(preview.platform).toBe('mobile');
    const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const session = await service.completePairing({
      pairingToken: token,
      publicJwk: publicKey.export({ format: 'jwk' }),
      sourceAddress: '192.168.1.20',
    });
    expect(session.deviceId).toEqual(expect.any(String));
  });

  it('the throttled answer says whose budget ran out and when to retry', async () => {
    const { service } = setup();
    let last: unknown;
    for (let i = 0; i < 11; i += 1) {
      try {
        await service.previewPairingGrant({ pairingToken: BOGUS, sourceAddress: '10.0.0.9' });
      } catch (err) {
        last = err;
      }
    }
    expect(last).toBeInstanceOf(PairingError);
    const err = last as PairingError;
    expect(err.code).toBe('THROTTLED');
    expect(err.message).toMatch(/from this network address — try again in \d+ s/);
    expect(err.throttle?.limit).toBe('source');
    expect(err.throttle?.retryAfterMs).toBeGreaterThan(0);
    expect(err.throttle?.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  it('the server-wide ceiling needs many sources, and never blocks a genuinely local request', async () => {
    const { service } = setup({ perSource: 2, global: 6 });
    const token = await mintFindable(service);
    // Three sources × 2 admitted = the ceiling of 6; each source's 3rd try is its own limit.
    for (const src of ['10.0.0.1', '10.0.0.2', '10.0.0.3']) {
      for (let i = 0; i < 3; i += 1) {
        await outcome(service.previewPairingGrant({ pairingToken: BOGUS, sourceAddress: src }));
      }
    }
    // A fourth LAN source now meets the server ceiling …
    const lan = service.previewPairingGrant({ pairingToken: token, sourceAddress: '10.0.0.4' });
    await expect(lan).rejects.toMatchObject({ code: 'THROTTLED', throttle: { limit: 'server' } });
    // … but this machine (the desktop window, the owner's local browser) still pairs.
    const local = await service.previewPairingGrant({ pairingToken: token, sourceAddress: '127.0.0.1', trustedSource: true });
    expect(local.platform).toBe('mobile');
  });

  it('a forwarded "loopback" request does not share the trusted local budget', async () => {
    const { service } = setup({ perSource: 2, global: 100 });
    const token = await mintFindable(service);
    for (let i = 0; i < 5; i += 1) {
      await outcome(service.previewPairingGrant({ pairingToken: BOGUS, sourceAddress: '127.0.0.1' }));
    }
    const local = await service.previewPairingGrant({ pairingToken: token, sourceAddress: '127.0.0.1', trustedSource: true });
    expect(local.platform).toBe('mobile');
  });

  it('preview still does not burn the grant’s redemption attempts', async () => {
    const { service, pairing } = setup();
    const token = await mintFindable(service);
    for (let i = 0; i < 5; i += 1) {
      await service.previewPairingGrant({ pairingToken: token, sourceAddress: `10.1.0.${i}` });
    }
    expect(pairing.grants[0]!.attempts).toBe(0);
  });
});
