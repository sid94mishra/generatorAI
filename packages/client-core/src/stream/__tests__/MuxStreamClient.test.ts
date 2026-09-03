import { afterEach, describe, expect, it, vi } from 'vitest';
import { MuxStreamClient, type MuxStreamEvent } from '../MuxStreamClient.js';

/**
 * A controllable `GET /api/stream?c=...` response: a real `Response` whose
 * body is a `ReadableStream` this test can push SSE frames into on demand,
 * and close whenever it wants (simulating the server ending the connection).
 */
function fakeSseResponse(): { response: Response; push: (event: string, data: unknown) => void; close: () => void } {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const encoder = new TextEncoder();
  return {
    response: new Response(stream, { status: 200 }),
    push: (event, data) => {
      const record = event === 'message' ? '' : `event: ${event}\n`;
      controller.enqueue(encoder.encode(`${record}data: ${JSON.stringify(data)}\n\n`));
    },
    close: () => controller.close(),
  };
}

/**
 * Routes the three real endpoints this client calls
 * (`POST /connections`, `GET /api/stream?c=`, `POST /connections/:id/subs`)
 * to caller-controlled responses, and records every call for assertions.
 */
function fakeServer() {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  let nextConnectionId = 1;
  const sse = fakeSseResponse();

  const fetchImpl = vi.fn(async (path: string, init?: RequestInit): Promise<Response> => {
    calls.push({ path, init });
    if (path === '/api/stream/connections' && init?.method === 'POST') {
      return new Response(JSON.stringify({ connectionId: `conn_${nextConnectionId++}` }), { status: 201 });
    }
    if (path.startsWith('/api/stream?c=')) {
      return sse.response;
    }
    if (/\/api\/stream\/connections\/.+\/subs$/.test(path) && init?.method === 'POST') {
      return new Response(JSON.stringify({ accepted: true }), { status: 202 });
    }
    return new Response('not found', { status: 404 });
  });

  return { fetchImpl, calls, push: sse.push, close: sse.close };
}

describe('MuxStreamClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens exactly one connection for two subscriptions requested in the same tick', async () => {
    const server = fakeServer();
    const client = new MuxStreamClient({ fetch: server.fetchImpl });

    client.subscribe('chat', 'c1', () => {});
    client.subscribe('run', 'r1', () => {});
    await Promise.resolve(); // let the coalescing microtask fire
    await Promise.resolve();
    await Promise.resolve();

    const connectionPosts = server.calls.filter((c) => c.path === '/api/stream/connections');
    expect(connectionPosts).toHaveLength(1);
    const body = JSON.parse(String(connectionPosts[0]?.init?.body));
    expect(body.subs).toEqual(
      expect.arrayContaining([{ scope: 'chat', id: 'c1' }, { scope: 'run', id: 'r1' }]),
    );

    client.disposeAll();
  });

  it('delivers a data frame to the matching scope handler with kind/data/sequence', async () => {
    const server = fakeServer();
    const client = new MuxStreamClient({ fetch: server.fetchImpl });
    const received: MuxStreamEvent[] = [];
    client.subscribe('chat', 'c1', (e) => received.push(e));
    await flushMicrotasks();

    server.push('message', { s: 'chat:c1', q: 5, e: 100, k: 'chat.message', p: { text: 'hi' } });
    await flushMicrotasks();

    expect(received).toEqual([{ kind: 'chat.message', data: { text: 'hi' }, sequence: 5 }]);
    client.disposeAll();
  });

  it('dedupes an event delivered under the same global event id (fan-out to multiple scopes)', async () => {
    const server = fakeServer();
    const client = new MuxStreamClient({ fetch: server.fetchImpl });
    const chatEvents: MuxStreamEvent[] = [];
    client.subscribe('chat', 'c1', (e) => chatEvents.push(e));
    await flushMicrotasks();

    // Same event id (`e`) delivered twice — the server fans one event out to
    // more than one scope; a subscriber of both scopes must only see it once.
    server.push('message', { s: 'chat:c1', q: 1, e: 42, k: 'chat.message', p: { text: 'first' } });
    server.push('message', { s: 'chat:c1', q: 2, e: 42, k: 'chat.message', p: { text: 'duplicate' } });
    await flushMicrotasks();

    expect(chatEvents).toHaveLength(1);
    expect(chatEvents[0]?.data).toEqual({ text: 'first' });
    client.disposeAll();
  });

  it('unions filters from two local subscribers of the same scope, each re-filtering on arrival', async () => {
    const server = fakeServer();
    const client = new MuxStreamClient({ fetch: server.fetchImpl });
    const a: MuxStreamEvent[] = [];
    const b: MuxStreamEvent[] = [];
    client.subscribe('browser', 'b1', (e) => a.push(e), { filter: ['browser.session_created'] });
    client.subscribe('browser', 'b1', (e) => b.push(e), { filter: ['browser.'] });
    await flushMicrotasks();

    const connectionPosts = server.calls.filter((c) => c.path === '/api/stream/connections');
    const body = JSON.parse(String(connectionPosts[0]?.init?.body));
    // The union sent to the server includes both prefixes.
    expect(body.subs[0].filter).toEqual(expect.arrayContaining(['browser.', 'browser.session_created']));

    server.push('message', { s: 'browser:b1', q: 1, e: 1, k: 'browser.session_created', p: {} });
    server.push('message', { s: 'browser:b1', q: 2, e: 2, k: 'browser.tab_closed', p: {} });
    await flushMicrotasks();

    expect(a).toHaveLength(1); // only matched its own narrow filter
    expect(b).toHaveLength(2); // matched the wide filter for both
    client.disposeAll();
  });

  it('sends the accumulated cursor on the NEXT connect after a reconnect', async () => {
    const server = fakeServer();
    const client = new MuxStreamClient({ fetch: server.fetchImpl });
    client.subscribe('chat', 'c1', () => {});
    await flushMicrotasks();

    server.push('message', { s: 'chat:c1', q: 7, e: 1, k: 'chat.message', p: {} });
    await flushMicrotasks();

    // Simulate the server ending the connection (a genuine disconnect) —
    // internal teardown should retry and carry the cursor forward.
    server.close();
    await flushMicrotasks();
    await new Promise((r) => setTimeout(r, 1100)); // past the backoff's base delay

    const connectionPosts = server.calls.filter((c) => c.path === '/api/stream/connections');
    expect(connectionPosts.length).toBeGreaterThanOrEqual(2);
    const secondBody = JSON.parse(String(connectionPosts[1]?.init?.body));
    expect(secondBody.cursors).toEqual({ 'chat:c1': 7 });
    client.disposeAll();
  }, 10_000);

  it('seeds a cursor from `afterSequence` only when no live cursor already exists', async () => {
    const server = fakeServer();
    const client = new MuxStreamClient({ fetch: server.fetchImpl });
    client.subscribe('chat', 'c1', () => {}, { afterSequence: 42 });
    await flushMicrotasks();

    const body = JSON.parse(String(server.calls[0]?.init?.body));
    expect(body.cursors).toEqual({ 'chat:c1': 42 });
    client.disposeAll();
  });

  it('clears the cursor and reports onDisconnected on a scope-local gap frame', async () => {
    const server = fakeServer();
    const client = new MuxStreamClient({ fetch: server.fetchImpl });
    const disconnects: Array<string | undefined> = [];
    client.subscribe('chat', 'c1', () => {}, { onDisconnected: (reason) => disconnects.push(reason) });
    await flushMicrotasks();

    server.push('gap', { s: 'chat:c1', reason: 'sequence_hole' });
    await flushMicrotasks();

    expect(disconnects).toEqual(['gap:sequence_hole']);
    client.disposeAll();
  });

  it('reports every active handler as onDisconnected("disposed") exactly once on disposeAll', async () => {
    const server = fakeServer();
    const client = new MuxStreamClient({ fetch: server.fetchImpl });
    const disconnects: Array<string | undefined> = [];
    client.subscribe('chat', 'c1', () => {}, { onDisconnected: (reason) => disconnects.push(reason) });
    await flushMicrotasks();

    client.disposeAll();
    expect(disconnects).toEqual(['disposed']);

    // A late subscribe can race a concurrent disposeAll() in real callers
    // (e.g. StreamReconciler mid-reconcile while the connection tears down)
    // — it must not throw into a caller with no reason to expect it. A
    // harmless no-op disposer, not an exception, is the contract.
    const disposer = client.subscribe('chat', 'c2', () => {});
    expect(disposer).toBeInstanceOf(Function);
    expect(() => disposer()).not.toThrow();
  });

  it('isolates a throwing handler — other subscribers still receive the same and later events', async () => {
    const server = fakeServer();
    const client = new MuxStreamClient({ fetch: server.fetchImpl });
    const good: MuxStreamEvent[] = [];
    client.subscribe('chat', 'c1', () => {
      throw new Error('boom — a bug in this pane, not the connection');
    });
    client.subscribe('chat', 'c1', (e) => good.push(e));
    await flushMicrotasks();

    server.push('message', { s: 'chat:c1', q: 1, e: 1, k: 'chat.message', p: { n: 1 } });
    server.push('message', { s: 'chat:c1', q: 2, e: 2, k: 'chat.message', p: { n: 2 } });
    await flushMicrotasks();

    // The throwing handler did not stop the co-resident handler from
    // receiving either event, and did not tear down the connection (no
    // reconnect attempt was made).
    expect(good).toHaveLength(2);
    const connectionPosts = server.calls.filter((c) => c.path === '/api/stream/connections');
    expect(connectionPosts).toHaveLength(1);
    client.disposeAll();
  });

  it('gives up after MAX_RECONNECT_ATTEMPTS and reports onDisconnected instead of retrying forever', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(async (): Promise<Response> => new Response('down', { status: 503 }));
      const client = new MuxStreamClient({ fetch: fetchImpl });
      const disconnects: Array<string | undefined> = [];
      client.subscribe('chat', 'c1', () => {}, { onDisconnected: (reason) => disconnects.push(reason) });

      // Drive the retry loop to completion: each failed connect() schedules
      // a backoff timer; advancing past it re-triggers connect().
      for (let i = 0; i < 25; i++) {
        await vi.runOnlyPendingTimersAsync();
        await Promise.resolve();
      }

      expect(disconnects.at(-1)).toEqual(expect.stringContaining('giving up after'));
      const attemptsMade = fetchImpl.mock.calls.length;

      // No further retries after giving up — the count stays put even
      // after more time passes.
      await vi.advanceTimersByTimeAsync(120_000);
      expect(fetchImpl.mock.calls.length).toBe(attemptsMade);

      client.disposeAll();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not open a second connection once the last handler for the only scope unsubscribes before connect resolves', async () => {
    const server = fakeServer();
    const client = new MuxStreamClient({ fetch: server.fetchImpl });
    const unsubscribe = client.subscribe('chat', 'c1', () => {});
    unsubscribe(); // unsubscribe before the coalescing microtask even runs
    await flushMicrotasks();

    const connectionPosts = server.calls.filter((c) => c.path === '/api/stream/connections');
    expect(connectionPosts).toHaveLength(0);
  });

  it('actually aborts the GET when every scope unsubscribes while the connect POST is still in flight, instead of leaving it open forever', async () => {
    // Unlike the test above (unsubscribe before connect() even starts), this
    // drives the real race: the POST resolves AFTER the unsubscribe, landing
    // in connect()'s "nothing wants this anymore" branch. A real `fetch`
    // rejects an in-flight request once its `signal` is aborted — this fake
    // GET honors that, the same way a real server connection would, so the
    // test fails by hanging (not just by a wrong assertion) if the fix
    // regresses back to never calling `.abort()`.
    let resolvePost!: (id: string) => void;
    const postPromise = new Promise<string>((resolve) => {
      resolvePost = resolve;
    });
    const getCalls: RequestInit[] = [];
    const fetchImpl = vi.fn(async (path: string, init?: RequestInit): Promise<Response> => {
      if (path === '/api/stream/connections' && init?.method === 'POST') {
        const id = await postPromise;
        return new Response(JSON.stringify({ connectionId: id }), { status: 201 });
      }
      if (path.startsWith('/api/stream?c=')) {
        getCalls.push(init ?? {});
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
      }
      return new Response('not found', { status: 404 });
    });

    const client = new MuxStreamClient({ fetch: fetchImpl });
    const unsubscribe = client.subscribe('chat', 'c1', () => {});
    await flushMicrotasks(); // the POST is now in flight
    unsubscribe(); // everyone's gone before it resolves

    resolvePost('conn_1');
    // If the GET is never aborted, this hangs until vitest's own test
    // timeout — the whole point of this test is that it does NOT hang.
    await flushMicrotasks();
    await flushMicrotasks();

    expect(getCalls).toHaveLength(1);
    expect(getCalls[0]?.signal?.aborted).toBe(true);
    client.disposeAll();
  });
});

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}
