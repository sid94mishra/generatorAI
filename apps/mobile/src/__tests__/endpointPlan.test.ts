import { describe, expect, it } from 'vitest';

import { buildEndpointCandidates } from '../transport/endpointPlan';

const fetchImpl = (async () => new Response('{}')) as unknown as typeof fetch;

describe('buildEndpointCandidates', () => {
  it('produces a LAN candidate for the paired endpoint', () => {
    const c = buildEndpointCandidates({ pairedEndpoint: 'http://192.168.1.10:3100', fetchImpl });
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ kind: 'lan', endpoint: 'http://192.168.1.10:3100' });
  });

  it.each(['http://127.0.0.1:3100', 'http://localhost:3100', 'http://[::1]:3100'])(
    'classifies %s as loopback',
    (endpoint) => {
      expect(buildEndpointCandidates({ pairedEndpoint: endpoint, fetchImpl })[0]!.kind).toBe(
        'loopback',
      );
    },
  );

  it('always ranks loopback above LAN regardless of list order', () => {
    // A simulator pointed at a host on the same machine must not go out to
    // the LAN interface and back.
    const c = buildEndpointCandidates({
      pairedEndpoint: 'http://192.168.1.10:3100',
      discoveredEndpoints: ['http://127.0.0.1:3100'],
      fetchImpl,
    });
    expect(c.map((x) => x.kind)).toEqual(['loopback', 'lan']);
  });

  it('keeps discovered endpoints in the order they were given', () => {
    const c = buildEndpointCandidates({
      pairedEndpoint: 'http://192.168.1.10:3100',
      discoveredEndpoints: ['http://192.168.1.11:3100', 'http://192.168.1.12:3100'],
      fetchImpl,
    });
    expect(c.map((x) => x.endpoint)).toEqual([
      'http://192.168.1.10:3100',
      'http://192.168.1.11:3100',
      'http://192.168.1.12:3100',
    ]);
  });

  it('de-duplicates a discovered endpoint that equals the paired one', () => {
    // Duplicates would double every connection attempt AND double the
    // backoff a user waits through while offline.
    const c = buildEndpointCandidates({
      pairedEndpoint: 'http://192.168.1.10:3100',
      discoveredEndpoints: ['http://192.168.1.10:3100/', 'HTTP://192.168.1.10:3100'],
      fetchImpl,
    });
    expect(c).toHaveLength(1);
  });

  it('never contacts the relay in local-only mode', () => {
    // This is a privacy promise, not an optimisation: the user has stated
    // their traffic may not leave the local network even sealed.
    const c = buildEndpointCandidates({
      pairedEndpoint: 'http://192.168.1.10:3100',
      relay: { cellUrl: 'wss://relay.test/relay/client', relayHostId: 'abc' },
      localOnly: true,
      fetchImpl,
    });
    expect(c.every((x) => x.kind !== 'relay')).toBe(true);
  });

  it('creates a working adapter from a candidate', async () => {
    const c = buildEndpointCandidates({ pairedEndpoint: 'http://192.168.1.10:3100', fetchImpl });
    const adapter = await c[0]!.create();
    expect(adapter.endpoint).toBe('http://192.168.1.10:3100');
    expect(adapter.streamUrl('/api/stream', 'ws')).toBe('ws://192.168.1.10:3100/api/stream');
  });

  it('trims a trailing slash so URLs never double up', () => {
    const c = buildEndpointCandidates({ pairedEndpoint: 'http://192.168.1.10:3100/', fetchImpl });
    expect(c[0]!.endpoint).toBe('http://192.168.1.10:3100/');
  });

  it('returns nothing when there is no endpoint at all', () => {
    expect(buildEndpointCandidates({ pairedEndpoint: '', fetchImpl })).toEqual([]);
  });
});
