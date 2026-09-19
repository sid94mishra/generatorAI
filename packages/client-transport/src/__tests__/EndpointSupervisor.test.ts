import { describe, expect, it, vi } from 'vitest';

import { Backoff } from '../Backoff.js';
import {
  EndpointSupervisor,
  HostIdentityMismatchError,
  NoReachableEndpointError,
} from '../EndpointSupervisor.js';
import type { TransportAdapter, TransportCandidate, TransportStatus } from '../TransportAdapter.js';

const PINNED = 'pinned-server-id';

/** Records the order of lifecycle calls so ordering can be asserted. */
function fakeAdapter(
  kind: TransportAdapter['kind'],
  endpoint: string,
  opts: { failOpen?: string; log?: string[] } = {},
): TransportAdapter {
  return {
    kind,
    endpoint,
    async open() {
      opts.log?.push(`open:${kind}`);
      if (opts.failOpen) throw new Error(opts.failOpen);
    },
    async fetch() {
      return new Response('{}');
    },
    streamUrl: (p) => `${endpoint}${p}`,
    async close() {
      opts.log?.push(`close:${kind}`);
    },
  };
}

function candidate(
  kind: TransportAdapter['kind'],
  endpoint: string,
  priority: number,
  opts: { failOpen?: string; log?: string[] } = {},
): TransportCandidate {
  return { kind, endpoint, priority, create: () => fakeAdapter(kind, endpoint, opts) };
}

/** No real timers: retry scheduling must be deterministic in tests. */
const instantSleep = async (): Promise<void> => undefined;

describe('EndpointSupervisor — candidate selection', () => {
  it('prefers the lowest priority candidate', async () => {
    const sup = new EndpointSupervisor({
      pinnedServerId: PINNED,
      candidates: [candidate('relay', 'https://relay.test', 10), candidate('lan', 'http://lan', 1)],
      verifyHost: async () => PINNED,
      sleep: instantSleep,
    });

    const adapter = await sup.connect();
    // LAN before relay: faster, and it keeps traffic off a third party.
    expect(adapter.kind).toBe('lan');
    expect(sup.currentStatus).toMatchObject({ state: 'connected', kind: 'lan' });
  });

  it('falls over to the next candidate when the first is unreachable', async () => {
    const sup = new EndpointSupervisor({
      pinnedServerId: PINNED,
      candidates: [
        candidate('lan', 'http://lan', 1, { failOpen: 'ECONNREFUSED' }),
        candidate('relay', 'https://relay.test', 10),
      ],
      verifyHost: async () => PINNED,
      sleep: instantSleep,
    });

    expect((await sup.connect()).kind).toBe('relay');
  });

  it('reports every failure when nothing is reachable', async () => {
    const sup = new EndpointSupervisor({
      pinnedServerId: PINNED,
      candidates: [
        candidate('lan', 'http://lan', 1, { failOpen: 'ECONNREFUSED' }),
        candidate('relay', 'https://relay.test', 10, { failOpen: 'DNS failure' }),
      ],
      verifyHost: async () => PINNED,
      sleep: instantSleep,
    });

    await expect(sup.connect()).rejects.toThrow(NoReachableEndpointError);
    await expect(sup.connect()).rejects.toThrow(/ECONNREFUSED.*DNS failure/s);
    expect(sup.currentStatus).toMatchObject({ state: 'offline' });
  });

  it('fails immediately when no candidates are configured', async () => {
    const sup = new EndpointSupervisor({
      pinnedServerId: PINNED,
      candidates: [],
      verifyHost: async () => PINNED,
      sleep: instantSleep,
    });
    await expect(sup.connect()).rejects.toThrow(NoReachableEndpointError);
  });

  it('retries the whole list across rounds', async () => {
    let attempts = 0;
    const flaky: TransportCandidate = {
      kind: 'lan',
      endpoint: 'http://lan',
      priority: 1,
      create: () => {
        attempts += 1;
        // Succeeds only on the third try.
        return fakeAdapter('lan', 'http://lan', attempts < 3 ? { failOpen: 'flaky' } : {});
      },
    };

    const sup = new EndpointSupervisor({
      pinnedServerId: PINNED,
      candidates: [flaky],
      verifyHost: async () => PINNED,
      sleep: instantSleep,
    });

    expect((await sup.connect(5)).kind).toBe('lan');
    expect(attempts).toBe(3);
  });
});

describe('EndpointSupervisor — host identity pinning', () => {
  it('verifies identity BEFORE the caller can send a credential', async () => {
    // This ordering is the security property: `/api/auth/server-info` is
    // unauthenticated, so we learn who answered before handing over a proof.
    const order: string[] = [];
    const sup = new EndpointSupervisor({
      pinnedServerId: PINNED,
      candidates: [
        {
          kind: 'lan',
          endpoint: 'http://lan',
          priority: 1,
          create: () => fakeAdapter('lan', 'http://lan', { log: order }),
        },
      ],
      verifyHost: async () => {
        order.push('verify');
        return PINNED;
      },
      sleep: instantSleep,
    });

    await sup.connect();
    expect(order).toEqual(['open:lan', 'verify']);
  });

  it('refuses a substituted host and does not fall through to another route', async () => {
    // Silently succeeding over the relay would hide the fact that something
    // is answering for the host on the local network. The user must see it.
    const relayCreated = vi.fn();
    const sup = new EndpointSupervisor({
      pinnedServerId: PINNED,
      candidates: [
        candidate('lan', 'http://lan', 1),
        {
          kind: 'relay',
          endpoint: 'https://relay.test',
          priority: 10,
          create: () => {
            relayCreated();
            return fakeAdapter('relay', 'https://relay.test');
          },
        },
      ],
      verifyHost: async () => 'someone-elses-server-id',
      sleep: instantSleep,
    });

    await expect(sup.connect()).rejects.toThrow(HostIdentityMismatchError);
    expect(relayCreated).not.toHaveBeenCalled();
    expect(sup.currentStatus).toMatchObject({
      state: 'host-mismatch',
      expected: PINNED,
      actual: 'someone-elses-server-id',
    });
  });

  it('closes the transport when identity verification fails', async () => {
    // A dangling relay stream holds a slot on the host's 64-stream budget.
    const log: string[] = [];
    const sup = new EndpointSupervisor({
      pinnedServerId: PINNED,
      candidates: [
        {
          kind: 'lan',
          endpoint: 'http://lan',
          priority: 1,
          create: () => fakeAdapter('lan', 'http://lan', { log }),
        },
      ],
      verifyHost: async () => 'impostor',
      sleep: instantSleep,
    });

    await expect(sup.connect()).rejects.toThrow(HostIdentityMismatchError);
    expect(log).toEqual(['open:lan', 'close:lan']);
  });

  it('closes the transport when the health probe fails', async () => {
    const log: string[] = [];
    const sup = new EndpointSupervisor({
      pinnedServerId: PINNED,
      candidates: [
        {
          kind: 'lan',
          endpoint: 'http://lan',
          priority: 1,
          create: () => fakeAdapter('lan', 'http://lan', { failOpen: 'refused', log }),
        },
      ],
      verifyHost: async () => PINNED,
      sleep: instantSleep,
    });

    await expect(sup.connect()).rejects.toThrow(NoReachableEndpointError);
    expect(log).toEqual(['open:lan', 'close:lan']);
  });

  it('skips verification only when pinning is explicitly disabled', async () => {
    const verifyHost = vi.fn();
    const sup = new EndpointSupervisor({
      pinnedServerId: '',
      candidates: [candidate('loopback', 'http://127.0.0.1:3100', 1)],
      verifyHost,
      sleep: instantSleep,
    });

    await sup.connect();
    expect(verifyHost).not.toHaveBeenCalled();
  });
});

describe('EndpointSupervisor — lifecycle', () => {
  it('reuses the active adapter instead of reconnecting', async () => {
    const create = vi.fn(() => fakeAdapter('lan', 'http://lan'));
    const sup = new EndpointSupervisor({
      pinnedServerId: PINNED,
      candidates: [{ kind: 'lan', endpoint: 'http://lan', priority: 1, create }],
      verifyHost: async () => PINNED,
      sleep: instantSleep,
    });

    const a = await sup.connect();
    const b = await sup.connect();
    expect(a).toBe(b);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('collapses concurrent connects into a single attempt', async () => {
    // A burst of requests after a drop must not start a stampede of parallel
    // relay handshakes against one host.
    const create = vi.fn(() => fakeAdapter('lan', 'http://lan'));
    const sup = new EndpointSupervisor({
      pinnedServerId: PINNED,
      candidates: [{ kind: 'lan', endpoint: 'http://lan', priority: 1, create }],
      verifyHost: async () => PINNED,
      sleep: instantSleep,
    });

    const results = await Promise.all([sup.connect(), sup.connect(), sup.connect()]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(new Set(results).size).toBe(1);
  });

  it('re-selects a route after invalidate', async () => {
    const create = vi.fn(() => fakeAdapter('lan', 'http://lan'));
    const sup = new EndpointSupervisor({
      pinnedServerId: PINNED,
      candidates: [{ kind: 'lan', endpoint: 'http://lan', priority: 1, create }],
      verifyHost: async () => PINNED,
      sleep: instantSleep,
    });

    await sup.connect();
    await sup.invalidate('network changed');
    expect(sup.currentStatus).toMatchObject({ state: 'offline', reason: 'network changed' });
    expect(sup.adapter).toBeNull();

    await sup.connect();
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('closes the adapter on disconnect', async () => {
    const log: string[] = [];
    const sup = new EndpointSupervisor({
      pinnedServerId: PINNED,
      candidates: [
        { kind: 'lan', endpoint: 'http://lan', priority: 1, create: () => fakeAdapter('lan', 'http://lan', { log }) },
      ],
      verifyHost: async () => PINNED,
      sleep: instantSleep,
    });

    await sup.connect();
    await sup.disconnect();
    expect(log).toContain('close:lan');
    expect(sup.currentStatus).toMatchObject({ state: 'idle' });
  });

  it('emits the full status progression', async () => {
    const seen: TransportStatus[] = [];
    const sup = new EndpointSupervisor({
      pinnedServerId: PINNED,
      candidates: [
        candidate('lan', 'http://lan', 1, { failOpen: 'nope' }),
        candidate('relay', 'https://relay.test', 10),
      ],
      verifyHost: async () => PINNED,
      sleep: instantSleep,
      onStatusChange: (s) => seen.push(s),
    });

    await sup.connect();
    expect(seen.map((s) => s.state)).toEqual(['connecting', 'connecting', 'connected']);
  });

  it('propagates abort without marking the endpoint offline', async () => {
    const controller = new AbortController();
    controller.abort();
    const sup = new EndpointSupervisor({
      pinnedServerId: PINNED,
      candidates: [candidate('lan', 'http://lan', 1)],
      verifyHost: async () => PINNED,
      sleep: instantSleep,
    });

    await expect(sup.connect(1, controller.signal)).rejects.toThrow();
    // An abort is the caller changing their mind, not a broken endpoint.
    expect(sup.currentStatus.state).not.toBe('offline');
  });
});

describe('Backoff', () => {
  it('grows exponentially and respects the ceiling', () => {
    const b = new Backoff({ baseMs: 100, factor: 2, maxMs: 500, jitter: 0, random: () => 0 });
    expect([b.next(), b.next(), b.next(), b.next()]).toEqual([100, 200, 400, 500]);
  });

  it('only ever subtracts jitter, so maxMs is a true upper bound', () => {
    const b = new Backoff({ baseMs: 1000, factor: 1, jitter: 0.3, random: () => 1 });
    expect(b.next()).toBe(700);
  });

  it('spreads retries across the jitter window', () => {
    // Without jitter every client that dropped during the same restart
    // retries at the same instant and knocks the server over again.
    const values = new Set<number>();
    for (const r of [0, 0.25, 0.5, 0.75, 1]) {
      values.add(new Backoff({ baseMs: 1000, factor: 1, jitter: 0.3, random: () => r }).next());
    }
    expect(values.size).toBe(5);
    expect(Math.min(...values)).toBe(700);
    expect(Math.max(...values)).toBe(1000);
  });

  it('resets after a successful connection', () => {
    const b = new Backoff({ baseMs: 100, factor: 2, jitter: 0, random: () => 0 });
    b.next();
    b.next();
    expect(b.attempts).toBe(2);
    b.reset();
    expect(b.attempts).toBe(0);
    expect(b.next()).toBe(100);
  });
});

describe('EndpointSupervisor — React Native AbortSignal', () => {
  // Hermes' AbortSignal has `aborted`/`reason` but no `throwIfAborted`.
  const rnSignal = (aborted: boolean): AbortSignal =>
    ({ aborted, addEventListener() {}, removeEventListener() {} }) as unknown as AbortSignal;

  it('connects with a signal that lacks throwIfAborted', async () => {
    const sup = new EndpointSupervisor({
      pinnedServerId: PINNED,
      candidates: [candidate('lan', 'http://lan', 1)],
      verifyHost: async () => PINNED,
      sleep: instantSleep,
    });
    expect((await sup.connect(1, rnSignal(false))).kind).toBe('lan');
  });

  it('rejects with an AbortError when such a signal is already aborted', async () => {
    const sup = new EndpointSupervisor({
      pinnedServerId: PINNED,
      candidates: [candidate('lan', 'http://lan', 1)],
      verifyHost: async () => PINNED,
      sleep: instantSleep,
    });
    await expect(sup.connect(1, rnSignal(true))).rejects.toMatchObject({ name: 'AbortError' });
  });
});
