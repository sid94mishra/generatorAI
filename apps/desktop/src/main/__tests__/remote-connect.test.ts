// G-4 (D-126): how "Connect to a server…" decides trust before loading.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { encodePairingOffer } from '../../../../../packages/relay-protocol/src/pairingOffer';
import { hostIdFromPublicKey } from '../../../../../packages/relay-protocol/src/e2ee';
import { pinForCa, sha256Hex, type InspectedCertificate } from '../pinnedTrust';
import { parseServerInput, planRemoteConnection, trustPrompt } from '../remote-connect';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', 'pinned', name), 'utf8');
const caA = fixture('ca-a.crt');
const caB = fixture('ca-b.crt');
const NOW = Date.now();
const pinA = pinForCa(caA, NOW);
const pinB = pinForCa(caB, NOW);
const publicKey = Buffer.alloc(32, 7).toString('base64url');
const serverId = hostIdFromPublicKey(Buffer.from(publicKey, 'base64url'));

function offerCode(endpoints: string[], fingerprint: string | undefined = pinA.sha256): string {
  return encodePairingOffer({
    v: 2,
    endpoint: endpoints[0]!,
    endpoints: endpoints.map((origin, priority) => ({ origin, reachability: origin.includes('.ts.net') ? 'private-network' : origin.includes('127.0.0.1') ? 'loopback' : 'lan', priority })),
    serverId,
    serverPublicKey: publicKey,
    ...(fingerprint ? { certificateFingerprint: fingerprint } : {}),
    pairingGrant: 'ABCDEFGHJKMN',
    pairingExpiresAt: NOW + 5 * 60_000,
    requestedScopes: ['read:status'],
    transportCapabilities: ['lan'],
    serverName: 'Studio',
  } as never);
}

const pinned = (caPem: string, caSha256: string): InspectedCertificate => ({
  systemTrusted: false,
  leafPem: 'leaf',
  leafSha256Hex: sha256Hex(Buffer.from('leaf')),
  caPem,
  caSha256,
});
const publicCert: InspectedCertificate = { systemTrusted: true, leafPem: 'leaf', leafSha256Hex: 'AA', caPem: null, caSha256: null };

describe('parseServerInput', () => {
  it('tells an address from a pairing code', () => {
    expect(parseServerInput('192.168.1.20:3100')).toEqual({ kind: 'address', url: 'http://192.168.1.20:3100' });
    const code = offerCode(['https://192.168.1.20:3100']);
    expect(parseServerInput(code).kind).toBe('offer');
    expect(parseServerInput(`generatorai://pair?code=${code}`).kind).toBe('offer');
    expect(parseServerInput('generatorai://pair?code=garbage').kind).toBe('invalid');
    expect(parseServerInput('https://x/y').kind).toBe('invalid');
  });
});

describe('planRemoteConnection — pairing code', () => {
  it('pins the CA when it matches the code’s fingerprint, and checks the server identity', async () => {
    const serverInfo = vi.fn(async () => ({ serverId }));
    const plan = await planRemoteConnection(parseServerInput(offerCode(['https://192.168.1.20:3100'])) as never, {
      inspect: async () => pinned(caA, pinA.sha256),
      serverInfo,
      now: () => NOW,
    });
    expect(plan).toMatchObject({ ok: true, url: 'https://192.168.1.20:3100', trust: 'pinned', vouchedByOffer: true, label: 'Studio' });
    expect(plan.ok && plan.pinnedCa?.sha256).toBe(pinA.sha256);
    expect(serverInfo).toHaveBeenCalledWith('https://192.168.1.20:3100', caA);
  });

  it('refuses a CA that does not match the code (impersonation)', async () => {
    const plan = await planRemoteConnection(parseServerInput(offerCode(['https://192.168.1.20:3100'])) as never, {
      inspect: async () => pinned(caB, pinB.sha256),
      serverInfo: async () => ({ serverId }),
      now: () => NOW,
    });
    expect(plan.ok).toBe(false);
    expect(plan.ok ? '' : plan.message).toMatch(/does not match this pairing code/);
  });

  it('uses a publicly trusted ts.net address first with nothing to pin, skipping loopback', async () => {
    const inspect = vi.fn(async (origin: string) => (origin.includes('ts.net') ? publicCert : pinned(caA, pinA.sha256)));
    const plan = await planRemoteConnection(
      parseServerInput(offerCode(['https://studio.tail1234.ts.net', 'https://192.168.1.20:3100', 'http://127.0.0.1:3100'])) as never,
      { inspect, serverInfo: async () => ({ serverId }), now: () => NOW },
    );
    expect(plan).toMatchObject({ ok: true, url: 'https://studio.tail1234.ts.net', trust: 'system', vouchedByOffer: false });
    expect(plan.ok && plan.pinnedCa).toBeFalsy();
    expect(inspect).not.toHaveBeenCalledWith('http://127.0.0.1:3100');
  });

  it('falls back to the next address, and refuses a different server behind it', async () => {
    const plan = await planRemoteConnection(
      parseServerInput(offerCode(['https://studio.tail1234.ts.net', 'https://192.168.1.20:3100'])) as never,
      {
        inspect: async (origin) => {
          if (origin.includes('ts.net')) throw new Error('unreachable');
          return pinned(caA, pinA.sha256);
        },
        serverInfo: async () => ({ serverId: 'someone-else' }),
        now: () => NOW,
      },
    );
    expect(plan.ok).toBe(false);
    expect(plan.ok ? '' : plan.message).toMatch(/different GeneratorAI server/);
  });

  it('tries a native-lane http:// address as https:// on the same port', async () => {
    const inspect = vi.fn(async () => pinned(caA, pinA.sha256));
    const plan = await planRemoteConnection(parseServerInput(offerCode(['http://192.168.1.20:3100'])) as never, {
      inspect,
      serverInfo: async () => ({ serverId }),
      now: () => NOW,
    });
    expect(inspect).toHaveBeenCalledWith('https://192.168.1.20:3100');
    expect(plan).toMatchObject({ ok: true, url: 'https://192.168.1.20:3100', trust: 'pinned' });
  });
});

describe('planRemoteConnection — typed address', () => {
  it('a self-signed server needs the trust step (not vouched)', async () => {
    const plan = await planRemoteConnection({ kind: 'address', url: 'https://192.168.1.20:3100' }, { inspect: async () => pinned(caA, pinA.sha256), serverInfo: async () => ({}), now: () => NOW });
    expect(plan).toMatchObject({ ok: true, trust: 'pinned', vouchedByOffer: false });
    if (!plan.ok) return;
    const text = trustPrompt(plan, 'AA BB');
    expect(text.message).toBe('Trust https://192.168.1.20:3100?');
    expect(text.detail).toContain('Compare it with Settings › Security & devices › HTTPS certificate');
  });

  it('upgrades a plain LAN address to https on the same port; loopback stays plain', async () => {
    const plan = await planRemoteConnection({ kind: 'address', url: 'http://192.168.1.20:3100' }, { inspect: async () => pinned(caA, pinA.sha256), serverInfo: async () => ({}), now: () => NOW });
    expect(plan).toMatchObject({ ok: true, url: 'https://192.168.1.20:3100', trust: 'pinned' });
    const local = await planRemoteConnection({ kind: 'address', url: 'http://127.0.0.1:3100' }, { inspect: vi.fn(), serverInfo: vi.fn(), now: () => NOW });
    expect(local).toMatchObject({ ok: true, url: 'http://127.0.0.1:3100', trust: 'plain' });
  });

  it('a public certificate needs nothing', async () => {
    const plan = await planRemoteConnection({ kind: 'address', url: 'https://studio.tail1234.ts.net' }, { inspect: async () => publicCert, serverInfo: async () => ({}), now: () => NOW });
    expect(plan).toMatchObject({ ok: true, trust: 'system' });
  });
});
