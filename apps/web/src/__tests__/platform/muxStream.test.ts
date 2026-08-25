// ────────────────────────────────────────────────────────────────
// muxStream — W09-a (§5.9), the client half.
//
// The value of multiplexing is entirely in the four defects it has to avoid.
// Opening one socket is trivial; opening one socket that resumes every scope
// independently and renders nothing twice is not. So every test here names a
// defect rather than a method.
// ────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __setAllowUnauthenticatedForTests } from '@/platform/authRuntime.js';
import { openMultiplexedStream, resetMuxStreamForTests } from '@/platform/muxStream.js';

__setAllowUnauthenticatedForTests(true);

const live: MockEventSource[] = [];

class MockEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  readyState = MockEventSource.OPEN;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  closed = false;
  private listeners = new Map<string, Array<(ev: Event) => void>>();

  constructor(readonly url: string) {
    live.push(this);
  }
  close() {
    this.closed = true;
    this.readyState = MockEventSource.CLOSED;
  }
  addEventListener(type: string, fn: (ev: Event) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  removeEventListener() {}
  dispatchEvent() {
    return false;
  }

  control(type: string, data: Record<string, unknown>) {
    for (const fn of this.listeners.get(type) ?? []) {
      fn({ data: JSON.stringify(data) } as MessageEvent as Event);
    }
  }

  frame(s: string, q: number, e: number, k = 'harness.token', p: unknown = {}) {
    this.onmessage?.({ data: JSON.stringify({ s, q, e, k, p }) } as MessageEvent);
  }
}

/** Every request the module made, so cursor and mutation payloads are visible. */
let posts: Array<{ url: string; body: Record<string, unknown> }> = [];
let nextConnectionOk = true;

const originalES = (globalThis as unknown as { EventSource?: unknown }).EventSource;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  live.length = 0;
  posts = [];
  nextConnectionOk = true;
  resetMuxStreamForTests();
  (globalThis as unknown as { EventSource: unknown }).EventSource = MockEventSource;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    posts.push({ url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
    if (url.endsWith('/api/stream/connections')) {
      return nextConnectionOk
        ? ({ ok: true, status: 201, json: async () => ({ connectionId: 'conn-1', ticket: 't' }) } as unknown as Response)
        : ({ ok: false, status: 429, json: async () => ({}) } as unknown as Response);
    }
    return { ok: true, status: 202, json: async () => ({ accepted: true }) } as unknown as Response;
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  resetMuxStreamForTests();
  globalThis.fetch = originalFetch;
  if (originalES !== undefined) {
    (globalThis as unknown as { EventSource: unknown }).EventSource = originalES;
  }
});

/** Wait for the coalescing microtask and the connection POST to settle. */
async function settle(): Promise<void> {
  await vi.waitFor(() => expect(live.length).toBeGreaterThan(0));
}

const connectionPosts = () => posts.filter((p) => p.url.endsWith('/api/stream/connections'));
const subPosts = () => posts.filter((p) => p.url.includes('/subs'));

describe('muxStream', () => {
  it('carries every scope on ONE EventSource', async () => {
    // The Phase 1 exit criterion: a chat tab with the right pane open plus a
    // run plus two more chats used to be five sockets.
    openMultiplexedStream('chat', 'A', {});
    openMultiplexedStream('run', 'B', {});
    openMultiplexedStream('chat', 'C', {});
    await settle();

    expect(live).toHaveLength(1);
    expect(connectionPosts()).toHaveLength(1);
    expect(connectionPosts()[0]!.body['subs']).toEqual([
      { scope: 'chat', id: 'A' },
      { scope: 'run', id: 'B' },
      { scope: 'chat', id: 'C' },
    ]);
  });

  it('delivers each frame only to the scope it is addressed to', async () => {
    const chat: string[] = [];
    const run: string[] = [];
    openMultiplexedStream('chat', 'A', { onMessage: (m) => chat.push(m.data) });
    openMultiplexedStream('run', 'B', { onMessage: (m) => run.push(m.data) });
    await settle();

    live[0]!.frame('chat:A', 1, 100);
    live[0]!.frame('run:B', 1, 101);
    expect(chat).toHaveLength(1);
    expect(run).toHaveLength(1);
  });

  it('rebuilds the single-scope frame body so `parseFrame` is untouched', async () => {
    const seen: Array<{ lastEventId: string; data: string }> = [];
    openMultiplexedStream('chat', 'A', { onMessage: (m) => seen.push(m) });
    await settle();

    live[0]!.frame('chat:A', 900, 100, 'harness.token', { text: 'hi' });
    expect(JSON.parse(seen[0]!.data)).toEqual({
      kind: 'harness.token',
      payload: { text: 'hi' },
    });
    // The per-scope seq, not the connection's opaque frame counter.
    expect(seen[0]!.lastEventId).toBe('900');
  });

  it('renders an event once even though it fans out to several scopes (N-10)', async () => {
    // One harness event is published to `chat:<id>` AND `session:<id>`, and
    // `sseManager` routes by `payload.sessionId` — so without dedup on the
    // global event id the same token would be appended twice.
    const chat: string[] = [];
    const session: string[] = [];
    openMultiplexedStream('chat', 'A', { onMessage: (m) => chat.push(m.data) });
    openMultiplexedStream('session', 'S', { onMessage: (m) => session.push(m.data) });
    await settle();

    live[0]!.frame('chat:A', 1, 500);
    live[0]!.frame('session:S', 7, 500); // same `e` — same underlying event

    expect(chat.length + session.length).toBe(1);
  });

  it('resumes every scope from its own cursor (N-9)', async () => {
    openMultiplexedStream('chat', 'A', {});
    openMultiplexedStream('run', 'B', {});
    await settle();
    live[0]!.control('hello', {
      connectionId: 'conn-1',
      active: ['chat:A', 'run:B'],
      resumed: { 'chat:A': true, 'run:B': true },
    });

    live[0]!.frame('chat:A', 900, 1);
    live[0]!.frame('run:B', 12, 2);

    // Drop the link. A single `Last-Event-ID` could carry only one of 900/12.
    live[0]!.readyState = MockEventSource.CLOSED;
    live[0]!.onerror?.({} as Event);
    await vi.waitFor(() => expect(connectionPosts().length).toBeGreaterThan(1), { timeout: 5000 });

    expect(connectionPosts()[1]!.body['cursors']).toEqual({ 'chat:A': 900, 'run:B': 12 });
  });

  it('re-snapshots only the scope whose resume failed', async () => {
    const resyncs: string[] = [];
    openMultiplexedStream('chat', 'A', { onResync: () => resyncs.push('chat:A') });
    openMultiplexedStream('run', 'B', { onResync: () => resyncs.push('run:B') });
    await settle();

    live[0]!.control('hello', {
      connectionId: 'conn-1',
      active: ['chat:A', 'run:B'],
      resumed: { 'chat:A': true, 'run:B': false },
    });

    expect(resyncs).toEqual(['run:B']);
  });

  it('forgets a cursor the server could not honour', async () => {
    openMultiplexedStream('chat', 'A', {});
    await settle();
    live[0]!.control('hello', { connectionId: 'conn-1', active: ['chat:A'], resumed: { 'chat:A': true } });
    live[0]!.frame('chat:A', 900, 1);
    live[0]!.control('hello', { connectionId: 'conn-1', active: ['chat:A'], resumed: { 'chat:A': false } });

    live[0]!.readyState = MockEventSource.CLOSED;
    live[0]!.onerror?.({} as Event);
    await vi.waitFor(() => expect(connectionPosts().length).toBeGreaterThan(1), { timeout: 5000 });

    // Keeping 900 would make the next reconnect fail for the same reason.
    expect(connectionPosts()[1]!.body['cursors']).toEqual({});
  });

  it('treats a gap as scope-local, never fatal to the connection', async () => {
    const resyncs: string[] = [];
    openMultiplexedStream('chat', 'A', { onResync: () => resyncs.push('chat:A') });
    openMultiplexedStream('run', 'B', { onResync: () => resyncs.push('run:B') });
    await settle();
    live[0]!.control('hello', { connectionId: 'conn-1', active: ['chat:A', 'run:B'], resumed: {} });

    live[0]!.control('gap', { s: 'run:B', fromSeq: 4, toSeq: 9, reason: 'slow_consumer' });

    expect(resyncs).toEqual(['run:B']);
    expect(live[0]!.closed).toBe(false);
  });

  it('adds a subscription without reconnecting', async () => {
    openMultiplexedStream('chat', 'A', {});
    await settle();
    live[0]!.control('hello', { connectionId: 'conn-1', active: ['chat:A'], resumed: {} });

    openMultiplexedStream('chat', 'C', {});
    await vi.waitFor(() => expect(subPosts()).toHaveLength(1));

    expect(live).toHaveLength(1); // the position in chat:A is not lost
    expect(subPosts()[0]!.body['add']).toEqual([{ scope: 'chat', id: 'C' }]);
  });

  it('picks up a scope requested WHILE a reconcile is already in flight, without waiting for a control frame', async () => {
    // △ Phase 1 review — a scope requested mid-reconcile used to be dropped
    // silently by the re-entrancy guard and only recovered because the server
    // always echoes a `subs` frame after every mutation, which happened to
    // trigger another `reconcile()`. This test proves the retry no longer
    // depends on that frame ever arriving.
    let resolveFirstPost: (() => void) | undefined;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      posts.push({ url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
      if (url.endsWith('/api/stream/connections')) {
        return { ok: true, status: 201, json: async () => ({ connectionId: 'conn-1', ticket: 't' }) } as unknown as Response;
      }
      // The FIRST /subs POST hangs until released; later ones resolve at once.
      if (!resolveFirstPost) {
        await new Promise<void>((resolve) => {
          resolveFirstPost = resolve;
        });
      }
      return { ok: true, status: 202, json: async () => ({ accepted: true }) } as unknown as Response;
    }) as typeof globalThis.fetch;

    openMultiplexedStream('chat', 'A', {});
    await settle();
    live[0]!.control('hello', { connectionId: 'conn-1', active: ['chat:A'], resumed: {} });

    openMultiplexedStream('chat', 'C', {}); // triggers the in-flight POST
    await vi.waitFor(() => expect(resolveFirstPost).toBeDefined());

    openMultiplexedStream('chat', 'D', {}); // arrives while C's POST is pending
    expect(subPosts()).toHaveLength(1); // D did not fire a second POST yet — correctly deferred

    resolveFirstPost?.();
    // No control frame is ever sent here — the retry must be self-triggered.
    // `activeScopes` is only ever updated from the server's authoritative
    // `subs` confirmation (never sent in this test), so the retry correctly
    // re-offers C alongside D rather than assuming C's still-unconfirmed POST
    // succeeded — resending an already-active scope is idempotent server-side.
    await vi.waitFor(() => expect(subPosts()).toHaveLength(2));
    expect(subPosts()[1]!.body['add']).toEqual([
      { scope: 'chat', id: 'C' },
      { scope: 'chat', id: 'D' },
    ]);
  });

  it('removes a subscription without dropping the socket its siblings share', async () => {
    const a = openMultiplexedStream('chat', 'A', {});
    openMultiplexedStream('run', 'B', {});
    await settle();
    live[0]!.control('hello', { connectionId: 'conn-1', active: ['chat:A', 'run:B'], resumed: {} });

    a.close();
    await vi.waitFor(() => expect(subPosts()).toHaveLength(1));
    expect(subPosts()[0]!.body['remove']).toEqual(['chat:A']);
    expect(live[0]!.closed).toBe(false);
  });

  it('closes the socket when the last subscriber leaves', async () => {
    const a = openMultiplexedStream('chat', 'A', {});
    await settle();
    a.close();
    expect(live[0]!.closed).toBe(true);
  });

  it('refcounts two subscribers on one scope', async () => {
    const first = openMultiplexedStream('chat', 'A', {});
    openMultiplexedStream('chat', 'A', {});
    await settle();
    live[0]!.control('hello', { connectionId: 'conn-1', active: ['chat:A'], resumed: {} });

    first.close();
    // Still wanted by the second subscriber, so nothing is removed or closed.
    expect(subPosts()).toHaveLength(0);
    expect(live[0]!.closed).toBe(false);
  });

  it('stops asking for a scope the server keeps refusing', async () => {
    // Reconciling a refusal forever is a POST loop: the client wants the
    // scope, the server never lists it as active, so the difference never
    // closes.
    const errors: number[] = [];
    openMultiplexedStream('chat', 'A', { onError: () => errors.push(1) });
    await settle();

    for (let i = 0; i < 5; i += 1) {
      live[0]!.control('subs', {
        active: [],
        resumed: {},
        rejected: [{ s: 'chat:A', reason: 'scope_cap_exceeded' }],
      });
      await Promise.resolve();
    }

    expect(errors.length).toBeGreaterThan(0);
    expect(subPosts().length).toBeLessThan(5);
  });

  it('does not open a connection for a subscriber that left first', async () => {
    const handle = openMultiplexedStream('chat', 'A', {});
    handle.close();
    await Promise.resolve();
    await Promise.resolve();
    expect(live).toHaveLength(0);
  });
});
