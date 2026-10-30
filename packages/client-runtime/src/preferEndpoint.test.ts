import { describe, expect, it } from 'vitest';
import { preferEndpoint, type PairingConsent } from './pairing.js';

const consent: PairingConsent = {
  serverName: 'Studio',
  endpoint: 'https://studio.tail1234.ts.net',
  endpoints: [
    { origin: 'https://studio.tail1234.ts.net', reachability: 'private-network', priority: 0 },
    { origin: 'https://192.168.1.20:3100', reachability: 'lan', priority: 1 },
    { origin: 'http://127.0.0.1:3100', reachability: 'loopback', priority: 2 },
  ],
  serverId: 'x'.repeat(43),
  fingerprint: 'XXXX',
  requestedScopes: ['read:status'],
  transportCapabilities: ['lan'],
  relayOffered: false,
  expiresAt: Date.now() + 60_000,
  pairingGrant: 'ABCDEFGHJKMN',
};

describe('preferEndpoint', () => {
  it('moves a listed origin first and renumbers', () => {
    const next = preferEndpoint(consent, 'https://192.168.1.20:3100/settings');
    expect(next.endpoint).toBe('https://192.168.1.20:3100');
    expect(next.endpoints.map((e) => [e.origin, e.priority])).toEqual([
      ['https://192.168.1.20:3100', 0],
      ['https://studio.tail1234.ts.net', 1],
      ['http://127.0.0.1:3100', 2],
    ]);
  });

  it('never adopts an origin the offer does not list', () => {
    expect(preferEndpoint(consent, 'https://evil.example')).toBe(consent);
    expect(preferEndpoint(consent, 'not a url')).toBe(consent);
    expect(preferEndpoint(consent, 'https://studio.tail1234.ts.net')).toBe(consent);
  });
});
