// Audit F-5 (D-118): a joining device chose its own `platform`, so a grant
// minted for an MCP agent could be completed as `cli` and then be handed the
// terminal and admin scopes MCP devices must never hold (and be treated as a
// person). The grant's platform is now authoritative.

import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { pairedPlatform, type PairingError } from '../DeviceService.js';
import { ALL_SCOPES } from '../scopes.js';
import { OWNER, mintFindable, setup } from './pairingFixtures.js';

const jwk = () => generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ format: 'jwk' });

describe('pairedPlatform', () => {
  it('never lets the joining party leave the mcp or mobile class', () => {
    for (const claimed of ['web', 'desktop', 'cli', 'other', 'mobile'] as const) {
      expect(pairedPlatform('mcp', claimed), `mcp → ${claimed}`).toBeNull();
    }
    for (const claimed of ['web', 'desktop', 'cli', 'other', 'mcp'] as const) {
      expect(pairedPlatform('mobile', claimed), `mobile → ${claimed}`).toBeNull();
    }
  });

  it('keeps the grant platform when none is claimed or it matches', () => {
    expect(pairedPlatform('mcp', undefined)).toBe('mcp');
    expect(pairedPlatform('mcp', 'mcp')).toBe('mcp');
    expect(pairedPlatform('mobile', 'mobile')).toBe('mobile');
  });

  it('lets a general-purpose grant be refined, including into a stricter class', () => {
    expect(pairedPlatform('other', 'cli')).toBe('cli');
    expect(pairedPlatform('desktop', 'web')).toBe('web');
    expect(pairedPlatform('other', 'mobile')).toBe('mobile');
    expect(pairedPlatform('web', 'mcp')).toBe('mcp');
  });
});

describe('completePairing pins the platform (F-5)', () => {
  it('the audit reproduction: an mcp grant completed as cli is refused and audited', async () => {
    const { service, devices, audit } = setup();
    const token = await mintFindable(service, 'mcp');
    await expect(
      service.completePairing({ pairingToken: token, publicJwk: jwk(), platform: 'cli', sourceAddress: '10.0.0.5' }),
    ).rejects.toMatchObject<Partial<PairingError>>({ code: 'PLATFORM_MISMATCH' });
    expect(devices.devices).toHaveLength(0);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'pairing.failed',
        reasonCode: 'platform_mismatch',
        metadata: { grantPlatform: 'mcp', claimedPlatform: 'cli' },
      }),
    );
  });

  it('an mcp grant pairs as mcp, which can then never be given the terminal or admin', async () => {
    const { service, devices } = setup();
    const token = await mintFindable(service, 'mcp');
    const session = await service.completePairing({ pairingToken: token, publicJwk: jwk(), sourceAddress: '10.0.0.5' });
    expect(devices.devices[0]!.platform).toBe('mcp');
    await expect(
      service.updateDeviceScopes(session.deviceId, [...session.scopes, 'exec:terminal', 'admin:settings'], {
        ...OWNER,
        scopes: [...ALL_SCOPES],
      }),
    ).rejects.toMatchObject<Partial<PairingError>>({ code: 'SCOPE_ESCALATION' });
  });

  it('a mobile grant cannot be completed as web (which would skip approval proofs)', async () => {
    const { service } = setup();
    const token = await mintFindable(service, 'mobile');
    await expect(
      service.completePairing({ pairingToken: token, publicJwk: jwk(), platform: 'web', sourceAddress: '10.0.0.5' }),
    ).rejects.toMatchObject<Partial<PairingError>>({ code: 'PLATFORM_MISMATCH' });
  });

  it('a general-purpose grant records the refined platform', async () => {
    const { service, devices } = setup();
    const token = await mintFindable(service, 'other');
    await service.completePairing({ pairingToken: token, publicJwk: jwk(), platform: 'cli', sourceAddress: '10.0.0.5' });
    expect(devices.devices[0]!.platform).toBe('cli');
  });

  it('refining into mcp re-checks the grant scopes against mcp', async () => {
    const { service } = setup();
    const grant = await service.createPairingGrant({
      deviceNameHint: 'Laptop',
      platform: 'cli',
      requestedScopes: ['read:status', 'exec:terminal'],
      createdBy: OWNER,
    });
    await expect(
      service.completePairing({ pairingToken: grant.pairingToken, publicJwk: jwk(), platform: 'mcp', sourceAddress: '10.0.0.5' }),
    ).rejects.toMatchObject<Partial<PairingError>>({ code: 'SCOPE_ESCALATION' });
  });
});
