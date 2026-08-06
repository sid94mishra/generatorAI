import { describe, expect, it } from 'vitest';
import { hostIdFromPublicKey } from './e2ee.js';
import {
  PairingOfferSchema,
  createPairingOfferSchema,
  pairingEndpoints,
} from './pairingOffer.js';
import { toBase64Url } from './bytes.js';

const publicKey = new Uint8Array(32).fill(7);
const base = {
  endpoint: 'http://192.168.1.20:3100',
  serverId: hostIdFromPublicKey(publicKey),
  serverPublicKey: toBase64Url(publicKey),
  pairingGrant: '0123456789abcdef',
  pairingExpiresAt: 1_000,
  requestedScopes: ['chat:read'],
  transportCapabilities: ['lan'] as const,
  serverName: 'Test server',
};

describe('PairingOfferSchema endpoint versions', () => {
  it('accepts and normalizes a legacy version 1 offer', () => {
    const offer = createPairingOfferSchema(() => 0).parse({ v: 1, ...base });
    expect(pairingEndpoints(offer)).toEqual([
      { origin: base.endpoint, reachability: 'lan', priority: 0 },
    ]);
  });

  it('requires version 2 endpoint ordering to agree with the primary endpoint', () => {
    const result = createPairingOfferSchema(() => 0).safeParse({
      v: 2,
      ...base,
      endpoints: [
        { origin: 'http://192.168.1.21:3100', reachability: 'lan', priority: 10 },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('sorts valid version 2 endpoint candidates by priority', () => {
    const offer = createPairingOfferSchema(() => 0).parse({
      v: 2,
      ...base,
      endpoints: [
        { origin: base.endpoint, reachability: 'lan', priority: 10 },
        { origin: 'https://host.example.test', reachability: 'public', priority: 20 },
      ],
    });
    expect(PairingOfferSchema.safeParse(offer).success).toBe(false);
    expect(pairingEndpoints(offer).map((endpoint) => endpoint.origin)).toEqual([
      base.endpoint,
      'https://host.example.test',
    ]);
  });
});