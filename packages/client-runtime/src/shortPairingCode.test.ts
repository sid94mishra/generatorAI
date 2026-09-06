// ────────────────────────────────────────────────────────────────
// A short pairing code has to work on every client, not just the web app.
//
// The web "Pair a device" panel prints the short code under a heading that
// says "2. Enter this code", the mobile manual-entry screen tells the user to
// copy "the code shown under the QR image", and the CLI's own help advertises
// `generatorai device pair XXXX-XXXX-XXXX`. Only the web app had ever
// implemented the short-code path (`apps/web/src/platform/authRuntime.ts`);
// the CLI and the mobile app went through `parsePairingCode`, which decodes
// the long offer blob and nothing else — so both rejected the exact code
// their own UI told the user to type ("Pairing code does not contain valid
// JSON").
//
// A short code carries no endpoint by design: the host that issued it is the
// one being asked, so resolution is a round trip rather than a decode.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';

import { resolveShortPairingCode, resolvePairingInput, PairingCodeError } from './pairing.js';

const ORIGIN = 'http://127.0.0.1:3101';
const SHORT = 'KTH1-6PJ8-PBXS';

function okFetch(body: Record<string, unknown>) {
  return vi.fn(async () => ({ ok: true, json: async () => body }) as unknown as Response);
}

const PREVIEW = {
  serverId: 'WXFphEJtTVyPJbVvPT5j8YeiOtZvgtAfW9IeavP8uKw',
  serverName: 'GeneratorAI (host)',
  requestedScopes: ['read:chats', 'write:chats'],
  expiresAt: Date.now() + 600_000,
};

describe('resolveShortPairingCode', () => {
  it('resolves a short code against the host that issued it', async () => {
    const fetchImpl = okFetch(PREVIEW);
    const consent = await resolveShortPairingCode(ORIGIN, SHORT, fetchImpl);

    expect(consent.serverId).toBe(PREVIEW.serverId);
    expect(consent.serverName).toBe(PREVIEW.serverName);
    expect(consent.requestedScopes).toEqual(PREVIEW.requestedScopes);
    // The origin that answered is the one to pin.
    expect(consent.endpoint).toBe(ORIGIN);
    expect(consent.endpoints[0]!.origin).toBe(ORIGIN);
  });

  it('sends the CANONICAL code, not what the user typed', async () => {
    // Dashes are presentation; the wire format is the ungrouped form, and a
    // server that had to normalise before hashing is an easy lookup mismatch.
    const fetchImpl = okFetch(PREVIEW);
    await resolveShortPairingCode(ORIGIN, ' kth1-6pj8 pbxs ', fetchImpl);

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ pairingToken: 'KTH16PJ8PBXS' });
  });

  it('posts to the pre-auth preview endpoint', async () => {
    const fetchImpl = okFetch(PREVIEW);
    await resolveShortPairingCode(`${ORIGIN}/`, SHORT, fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    // A doubled slash would 404 on some proxies.
    expect(url).toBe(`${ORIGIN}/api/auth/pair/preview`);
    expect(init.method).toBe('POST');
  });

  it('surfaces the server’s own refusal rather than a generic message', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: { code: 'EXPIRED', message: 'This pairing code has expired.' } }),
    }) as unknown as Response);

    await expect(resolveShortPairingCode(ORIGIN, SHORT, fetchImpl)).rejects.toMatchObject({
      code: 'EXPIRED',
      message: 'This pairing code has expired.',
    });
  });

  it('says the host is unreachable when the request cannot be made', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    await expect(resolveShortPairingCode(ORIGIN, SHORT, fetchImpl)).rejects.toBeInstanceOf(PairingCodeError);
    await expect(resolveShortPairingCode(ORIGIN, SHORT, fetchImpl)).rejects.toMatchObject({
      code: 'UNREACHABLE',
    });
  });
});

describe('resolvePairingInput', () => {
  it('takes the network path for a short code', async () => {
    const fetchImpl = okFetch(PREVIEW);
    const consent = await resolvePairingInput(SHORT, ORIGIN, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(consent.serverId).toBe(PREVIEW.serverId);
  });

  it('decodes a full offer blob offline, without touching the network', async () => {
    const fetchImpl = vi.fn();
    // Not a real offer — the point is that it is DECODED (and here rejected)
    // rather than sent to the host.
    await expect(resolvePairingInput('not-a-real-offer-blob', ORIGIN, fetchImpl)).rejects.toBeInstanceOf(
      PairingCodeError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
