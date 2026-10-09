import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  inspect: vi.fn(),
  setAnchors: vi.fn(),
  clearAnchors: vi.fn(),
}));
vi.mock('../../native/trustModule', () => ({ NativeTrust: native }));

import { consentFor, normalizeAddress, prefillFrom, probeAddress } from '../pairingInput';

const SERVER_PUBLIC_KEY = Buffer.alloc(32, 7).toString('base64url');
const CA = Buffer.alloc(32, 1).toString('base64url');
const LEAF = Buffer.alloc(32, 2).toString('base64url');

beforeEach(() => {
  vi.restoreAllMocks();
  native.inspect.mockReset();
  native.setAnchors.mockReset();
  native.clearAnchors.mockReset();
});

describe('pairing input (MD-34, MD-35)', () => {
  it('pre-fills a typed or linked short code and nothing else', () => {
    expect(prefillFrom('4h7k-2m9p-xq3t')).toEqual({ code: '4H7K2M9PXQ3T', address: null, consent: null });
    expect(prefillFrom('generatorai://pair?code=4H7K-2M9P-XQ3T')).toEqual({ code: '4H7K2M9PXQ3T', address: null, consent: null });
    expect(prefillFrom('')).toBeNull();
    expect(prefillFrom('hello')).toBeNull();
  });
  it('normalizes addresses to an origin, https:// when none is typed (MD-201)', () => {
    expect(normalizeAddress('192.168.1.24:3100')).toBe('https://192.168.1.24:3100');
    expect(normalizeAddress('https://ghe.example.com/')).toBe('https://ghe.example.com');
    expect(normalizeAddress('http://h:3100/path')).toBe('http://h:3100');
    expect(normalizeAddress('   ')).toBeNull();
    expect(normalizeAddress('http://')).toBeNull();
  });
});

describe('typed-code trust (MD-200)', () => {
  it('refuses a plain-HTTP address before any request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(consentFor('4H7K2M9PXQ3T', 'http://192.168.1.24:3100', null)).rejects.toMatchObject({ field: 'address' });
    expect(await probeAddress('http://192.168.1.24:3100')).toEqual({ kind: 'insecure' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(native.inspect).not.toHaveBeenCalled();
  });

  it('reads the CA from the handshake, anchors it only for the preview, and proposes it with the leaf to compare', async () => {
    native.inspect.mockResolvedValue({ leaf: LEAF, root: CA, chain: [LEAF, CA] });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      expect(String(input)).toBe('https://192.168.1.24:3100/api/auth/pair/preview');
      // The anchor is in place while the preview runs.
      expect(native.setAnchors).toHaveBeenCalledWith('pairing-preview', ['192.168.1.24:3100'], [CA]);
      expect(native.clearAnchors).not.toHaveBeenCalled();
      return new Response(
        JSON.stringify({
          serverId: 'S'.repeat(43),
          serverName: 'Studio',
          requestedScopes: ['read:chats'],
          expiresAt: Date.now() + 60_000,
          endpoints: [{ origin: 'https://192.168.1.24:3100', reachability: 'lan', priority: 0 }],
        }),
        { status: 200 },
      );
    });
    const proposal = await consentFor('4H7K2M9PXQ3T', '192.168.1.24:3100', null);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(native.inspect).toHaveBeenCalledWith('192.168.1.24', 3100);
    expect(native.clearAnchors).toHaveBeenCalledWith('pairing-preview');
    expect(proposal.trust).toEqual({ v: 1, fingerprints: [CA], source: 'certificate' });
    expect(proposal.certificate).toBe(LEAF);
    expect(proposal.consent.endpoint).toBe('https://192.168.1.24:3100');
  });

  it('clears the preview anchor when the code is refused', async () => {
    native.inspect.mockResolvedValue({ leaf: LEAF, root: CA, chain: [LEAF, CA] });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: { code: 'INVALID_GRANT', message: 'Nope' } }), { status: 400 }));
    await expect(consentFor('4H7K2M9PXQ3T', '192.168.1.24:3100', null)).rejects.toMatchObject({ field: 'code', message: 'Nope' });
    expect(native.clearAnchors).toHaveBeenCalledWith('pairing-preview');
  });

  it('says the address is unreachable when no TLS handshake happens', async () => {
    native.inspect.mockRejectedValue(new Error('refused'));
    await expect(consentFor('4H7K2M9PXQ3T', '192.168.1.24:3100', null)).rejects.toMatchObject({ field: 'address' });
    expect(await probeAddress('192.168.1.24:3100')).toEqual({ kind: 'unreachable' });
  });

  it('leaves a public name to the system trust (no inspection, no anchor)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ serverId: 'S'.repeat(43), serverName: 'Studio', requestedScopes: [], expiresAt: Date.now() + 60_000 }), { status: 200 }),
    );
    const proposal = await consentFor('4H7K2M9PXQ3T', 'https://studio.tail1234.ts.net', null);
    expect(native.inspect).not.toHaveBeenCalled();
    expect(proposal.trust.fingerprints).toEqual([]);
    expect(proposal.certificate).toBeNull();
  });
});

describe('QR trust (MD-199)', () => {
  const qr = (endpoint: string, extra: Record<string, unknown> = {}) => {
    const offer = {
      v: 2,
      endpoint,
      endpoints: [{ origin: endpoint, reachability: 'lan', priority: 0 }],
      serverId: '',
      serverPublicKey: SERVER_PUBLIC_KEY,
      pairingGrant: '4H7K2M9PXQ3T',
      pairingExpiresAt: Date.now() + 60_000,
      requestedScopes: ['read:chats'],
      transportCapabilities: ['lan'],
      serverName: 'Studio',
      ...extra,
    };
    return offer;
  };

  it('pins the CA and backup CA the offer names, without contacting anything', async () => {
    const { hostIdFromPublicKey } = await import('@generatorai/relay-protocol');
    const offer = qr('https://192.168.1.24:3100', { certificateFingerprint: CA, backupCertificateFingerprint: LEAF });
    offer.serverId = hostIdFromPublicKey(Buffer.from(SERVER_PUBLIC_KEY, 'base64url'));
    const link = `generatorai://pair?code=${Buffer.from(JSON.stringify(offer)).toString('base64url')}`;
    const prefill = prefillFrom(link)!;
    expect(prefill.address).toBe('https://192.168.1.24:3100');
    const proposal = await consentFor(prefill.code, prefill.address!, prefill.consent);
    expect(proposal.trust).toEqual({ v: 1, fingerprints: [CA, LEAF], source: 'qr' });
    expect(proposal.certificate).toBeNull();
    expect(native.inspect).not.toHaveBeenCalled();
  });

  it('refuses an offer that only lists plain-HTTP addresses (an old server)', async () => {
    const { hostIdFromPublicKey } = await import('@generatorai/relay-protocol');
    const offer = qr('http://192.168.1.24:3100', { certificateFingerprint: CA });
    offer.serverId = hostIdFromPublicKey(Buffer.from(SERVER_PUBLIC_KEY, 'base64url'));
    const prefill = prefillFrom(`generatorai://pair?code=${Buffer.from(JSON.stringify(offer)).toString('base64url')}`)!;
    await expect(consentFor(prefill.code, prefill.address!, prefill.consent)).rejects.toMatchObject({ field: 'form' });
  });
});
