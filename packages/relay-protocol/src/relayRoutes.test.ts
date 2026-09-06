import { describe, expect, it } from 'vitest';
import { toBase64Url } from './bytes.js';
import { hostIdFromPublicKey } from './e2ee.js';
import { createPairingOfferSchema } from './pairingOffer.js';
import { RelayStreamIdSchema } from './relayProtocol.js';
import {
  RELAY_ROUTES,
  canonicalRelayOrigin,
  isRelayStreamId,
  newRelayStreamId,
  relayAssignmentUrl,
  relayClientSocketUrl,
  relayDataSocketUrl,
  relayHostSocketUrl,
} from './relayRoutes.js';

describe('canonicalRelayOrigin', () => {
  it('maps ws/wss to http/https and strips any path', () => {
    expect(canonicalRelayOrigin('wss://relay.example.com/relay/host')).toBe('https://relay.example.com');
    expect(canonicalRelayOrigin('ws://127.0.0.1:8787')).toBe('http://127.0.0.1:8787');
    expect(canonicalRelayOrigin('https://relay.example.com/')).toBe('https://relay.example.com');
  });

  it('rejects non-relay schemes and garbage', () => {
    expect(canonicalRelayOrigin('ftp://relay')).toBeNull();
    expect(canonicalRelayOrigin('not a url')).toBeNull();
    expect(canonicalRelayOrigin('')).toBeNull();
  });
});

describe('relay URL helpers', () => {
  const cell = 'https://relay.example.com';

  it('builds every route from the shared table', () => {
    expect(relayAssignmentUrl(cell, 'A'.repeat(43))).toBe(
      `${cell}${RELAY_ROUTES.assignment}?relayHostId=${'A'.repeat(43)}`,
    );
    expect(relayHostSocketUrl(cell)).toBe(`wss://relay.example.com${RELAY_ROUTES.host}`);
    expect(relayClientSocketUrl(cell)).toBe(`wss://relay.example.com${RELAY_ROUTES.client}`);
    expect(relayDataSocketUrl(cell, { streamId: 'abc', relayHostId: 'h' })).toBe(
      `wss://relay.example.com${RELAY_ROUTES.data}?streamId=abc&relayHostId=h`,
    );
  });

  it('accepts a ws/wss cell origin and a plain http one (loopback tests, LAN relays)', () => {
    expect(relayHostSocketUrl('wss://relay.example.com/relay/host')).toBe(
      `wss://relay.example.com${RELAY_ROUTES.host}`,
    );
    expect(relayHostSocketUrl('http://127.0.0.1:8787')).toBe(`ws://127.0.0.1:8787${RELAY_ROUTES.host}`);
  });

  it('refuses to build a URL from a non-origin so a bad control message cannot redirect the bridge', () => {
    expect(() => relayDataSocketUrl('javascript:alert(1)', { streamId: 'a', relayHostId: 'b' })).toThrow();
  });

  it('produces the canonical https origin shape the pairing-offer relay block requires', () => {
    // The relay used to hand out `wss://…/relay/host` as `cellUrl`, which the
    // offer schema rejects — a host that had attached successfully would still
    // have failed to mint a pairing offer.
    const schema = createPairingOfferSchema(() => 0);
    const publicKey = new Uint8Array(32).fill(9);
    const serverId = hostIdFromPublicKey(publicKey);
    const offer = (cellUrl: string, directorUrl: string) => ({
      v: 1,
      endpoint: 'http://192.168.1.20:3100',
      serverId,
      serverPublicKey: toBase64Url(publicKey),
      pairingGrant: '0123456789abcdef',
      pairingExpiresAt: 1_000,
      requestedScopes: ['chat:read'],
      transportCapabilities: ['lan', 'relay'],
      serverName: 'Test server',
      relay: {
        v: 1,
        directorUrl,
        cellUrl,
        assignmentEpoch: 1,
        relayHostId: serverId,
        inviteToken: 'B'.repeat(43),
        inviteExpiresAt: 60_000,
        e2eeFraming: 1,
      },
    });
    const canonical = canonicalRelayOrigin('wss://relay.example.com/relay/host')!;
    expect(schema.safeParse(offer(canonical, canonical)).success).toBe(true);
    const legacy = schema.safeParse(
      offer('wss://relay.example.com/relay/host', 'https://relay.example.com/relay/assignment'),
    );
    expect(legacy.success).toBe(false);
  });
});

describe('newRelayStreamId', () => {
  it('always satisfies the wire schema (the old `binding:uuid` form did not)', () => {
    for (let i = 0; i < 200; i++) {
      const id = newRelayStreamId();
      expect(isRelayStreamId(id)).toBe(true);
      expect(RelayStreamIdSchema.safeParse(id).success).toBe(true);
    }
    expect(isRelayStreamId('device-binding-1:2f0a7b1e-0000-4000-8000-000000000000')).toBe(false);
  });
});
