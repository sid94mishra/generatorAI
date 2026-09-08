// ────────────────────────────────────────────────────────────────
// MuxStreamClient — a 403 for ONE scope must not sink the connection.
//
// `POST /api/stream/connections` refuses the whole request when any one
// subscription is out of the principal's scope. The client used to treat
// that like a server outage: `onDisconnected('http:403')` for every scope,
// then the same payload again on backoff, twenty times, then give up. So a
// paired phone whose `global` sub needed a scope its grant lacked got no
// live events for its CHAT feeds either — the ones it was allowed.
//
// Now the 403 body is read, the refused scope is dropped from the wanted set,
// its handlers are told once and precisely, and the rest reconnect on the
// very next POST with no backoff penalty.
// ────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MuxStreamClient, parseInsufficientScope } from '../stream/MuxStreamClient.js';

interface Post {
  subs: Array<{ scope: string; id: string }>;
}

/**
 * A server that refuses `global` with the real 403 body shape and accepts
 * everything else, serving a `hello` on the attach so the client reaches a
 * genuinely connected state.
 */
function scopedServer(opts: { withSub?: boolean; refuse?: string } = {}) {
  const refuse = opts.refuse ?? 'global';
  const posts: Post[] = [];
  const subPosts: Array<{ add: Array<{ scope: string; id: string }>; remove: string[] }> = [];
  let grants = new Set<string>();
  let connections = 0;
  const streams: Array<ReadableStreamDefaultController<Uint8Array>> = [];

  const refusal = (scope: string, id: string) =>
    new Response(
      JSON.stringify({
        error: {
          code: 'INSUFFICIENT_SCOPE',
          message: `Subscribing to a "${scope}" stream requires the read:activity scope.`,
          requiredScopes: ['read:activity'],
          ...(opts.withSub === false ? {} : { sub: { scope, id } }),
        },
      }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    );

  const fetchImpl = async (path: string, init?: RequestInit): Promise<Response> => {
    if (path === '/api/stream/connections' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Post;
      posts.push(body);
      const bad = body.subs.find((s) => s.scope === refuse && !grants.has(refuse));
      if (bad) return refusal(bad.scope, bad.scope === 'global' ? 'all' : bad.id);
      connections += 1;
      return new Response(JSON.stringify({ connectionId: `c${connections}` }), { status: 201 });
    }
    if (/^\/api\/stream\/connections\/[^/]+\/subs$/.test(path) && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { add: Array<{ scope: string; id: string }>; remove: string[] };
      subPosts.push(body);
      const bad = body.add.find((s) => s.scope === refuse && !grants.has(refuse));
      if (bad) return refusal(bad.scope, bad.scope === 'global' ? 'all' : bad.id);
      return new Response(JSON.stringify({ accepted: true }), { status: 202 });
    }
    if (path.startsWith('/api/stream?c=')) {
      const id = decodeURIComponent(path.slice('/api/stream?c='.length));
      const active = posts[posts.length - 1]!.subs.map((s) => `${s.scope}:${s.scope === 'global' ? 'all' : s.id}`);
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            streams.push(controller);
            controller.enqueue(
              new TextEncoder().encode(
                `event: hello\ndata: ${JSON.stringify({ connectionId: id, active, resumed: {} })}\n\n`,
              ),
            );
          },
        }),
        { status: 200 },
      );
    }
    return new Response('{}', { status: 200 });
  };
  return {
    fetchImpl,
    posts,
    subPosts,
    grant: (scope: string) => {
      grants = new Set([...grants, scope]);
    },
    /** Push a `subs` control frame on the latest stream. */
    subsFrame: (frame: Record<string, unknown>) => {
      streams[streams.length - 1]!.enqueue(
        new TextEncoder().encode(`event: subs\ndata: ${JSON.stringify(frame)}\n\n`),
      );
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('parseInsufficientScope', () => {
  it('prefers the `sub` the server names', () => {
    expect(
      parseInsufficientScope({
        error: {
          code: 'INSUFFICIENT_SCOPE',
          message: 'Subscribing to a "chat" stream requires the read:chats scope.',
          requiredScopes: ['read:chats'],
          sub: { scope: 'chat', id: 'c1' },
        },
      }),
    ).toEqual({ scope: 'chat', id: 'c1', requiredScope: 'read:chats' });
  });

  it('falls back to the scope quoted in the message for an older server', () => {
    expect(
      parseInsufficientScope({
        error: {
          code: 'INSUFFICIENT_SCOPE',
          message: 'Subscribing to a "global" stream requires the admin:settings scope.',
          requiredScopes: ['admin:settings'],
        },
      }),
    ).toEqual({ scope: 'global', requiredScope: 'admin:settings' });
  });

  it('returns null for anything that is not an INSUFFICIENT_SCOPE body', () => {
    expect(parseInsufficientScope(null)).toBeNull();
    expect(parseInsufficientScope({ error: { code: 'TICKET_CHAINING_FORBIDDEN' } })).toBeNull();
    expect(parseInsufficientScope('nope')).toBeNull();
  });
});

describe('MuxStreamClient per-scope rejection', () => {
  it('drops the refused scope and connects the accepted one on the immediate second POST', async () => {
    const server = scopedServer();
    const client = new MuxStreamClient({ fetch: server.fetchImpl });
    const chatReasons: string[] = [];
    const globalReasons: string[] = [];
    let chatConnected = 0;
    client.subscribe('chat', 'c1', () => {}, {
      onConnected: () => {
        chatConnected += 1;
      },
      onDisconnected: (r) => chatReasons.push(r ?? ''),
    });
    client.subscribe('global', 'all', () => {}, {
      onDisconnected: (r) => globalReasons.push(r ?? ''),
    });

    // Well under the 1s first backoff step: the retry must be immediate.
    await vi.advanceTimersByTimeAsync(50);

    expect(server.posts).toHaveLength(2);
    expect(server.posts[0]!.subs.map((s) => s.scope)).toEqual(['chat', 'global']);
    expect(server.posts[1]!.subs.map((s) => s.scope)).toEqual(['chat']);

    // The chat scope was never told it was disconnected — it was not.
    expect(chatReasons).toEqual([]);
    expect(chatConnected).toBe(1);
    // The global scope was told once, and told why.
    expect(globalReasons).toEqual(['rejected:insufficient_scope:read:activity']);
    expect(client.rejectedScopes()).toEqual([
      { scope: 'global', id: 'all', reason: 'rejected:insufficient_scope:read:activity' },
    ]);

    // And it stays dropped: a long wait produces no further POSTs.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(server.posts).toHaveLength(2);
    expect(globalReasons).toHaveLength(1);

    client.disposeAll();
  });

  it('still identifies the scope when the server sends no `sub` (older server)', async () => {
    const server = scopedServer({ withSub: false });
    const client = new MuxStreamClient({ fetch: server.fetchImpl });
    let chatConnected = 0;
    client.subscribe('chat', 'c1', () => {}, { onConnected: () => { chatConnected += 1; } });
    client.subscribe('global', 'all', () => {});

    await vi.advanceTimersByTimeAsync(50);

    expect(server.posts).toHaveLength(2);
    expect(server.posts[1]!.subs.map((s) => s.scope)).toEqual(['chat']);
    expect(chatConnected).toBe(1);

    client.disposeAll();
  });

  it('stops without a further request when every scope was refused', async () => {
    const server = scopedServer();
    const client = new MuxStreamClient({ fetch: server.fetchImpl });
    const reasons: string[] = [];
    client.subscribe('global', 'all', () => {}, { onDisconnected: (r) => reasons.push(r ?? '') });

    await vi.advanceTimersByTimeAsync(60_000);

    expect(server.posts).toHaveLength(1);
    expect(reasons).toEqual(['rejected:insufficient_scope:read:activity']);

    client.disposeAll();
  });

  it('resetRejections retries the scope once the grant has changed', async () => {
    const server = scopedServer();
    const client = new MuxStreamClient({ fetch: server.fetchImpl });
    let globalConnected = 0;
    client.subscribe('chat', 'c1', () => {});
    client.subscribe('global', 'all', () => {}, { onConnected: () => { globalConnected += 1; } });
    await vi.advanceTimersByTimeAsync(50);
    expect(client.rejectedScopes().map((r) => r.scope)).toEqual(['global']);

    // The user grants read:activity on the desktop; the app re-asks.
    server.grant('global');
    client.resetRejections();
    await vi.advanceTimersByTimeAsync(50);

    // Live connection, so the retry is a /subs mutation, not a reconnect.
    expect(server.subPosts).toHaveLength(1);
    expect(server.subPosts[0]!.add.map((s) => s.scope)).toEqual(['global']);
    expect(client.rejectedScopes()).toEqual([]);

    server.subsFrame({ active: ['chat:c1', 'global:all'], resumed: {} });
    await vi.advanceTimersByTimeAsync(10);
    expect(globalConnected).toBe(1);

    client.disposeAll();
  });

  it('handles a 403 on the /subs reconcile path without tearing the connection down', async () => {
    const server = scopedServer();
    const client = new MuxStreamClient({ fetch: server.fetchImpl });
    client.subscribe('chat', 'c1', () => {});
    await vi.advanceTimersByTimeAsync(50);
    expect(server.posts).toHaveLength(1);

    // Added later, onto the live connection.
    const reasons: string[] = [];
    let runConnected = 0;
    client.subscribe('global', 'all', () => {}, { onDisconnected: (r) => reasons.push(r ?? '') });
    client.subscribe('run', 'r1', () => {}, { onConnected: () => { runConnected += 1; } });
    await vi.advanceTimersByTimeAsync(50);

    // The /subs that named global was refused; the retry carried only run.
    // No second connection was opened for it.
    expect(server.posts).toHaveLength(1);
    expect(server.subPosts.length).toBeGreaterThanOrEqual(2);
    expect(server.subPosts[0]!.add.map((s) => s.scope)).toContain('global');
    expect(server.subPosts[server.subPosts.length - 1]!.add.map((s) => s.scope)).toEqual(['run']);
    expect(server.subPosts.every((p) => p.remove.length === 0)).toBe(true);
    expect(reasons).toEqual(['rejected:insufficient_scope:read:activity']);

    server.subsFrame({ active: ['chat:c1', 'run:r1'], resumed: {} });
    await vi.advanceTimersByTimeAsync(10);
    expect(runConnected).toBe(1);

    client.disposeAll();
  });

  it('keeps the old whole-connection behaviour for a non-403 failure', async () => {
    let posts = 0;
    const fetchImpl = async (path: string, init?: RequestInit): Promise<Response> => {
      if (path === '/api/stream/connections' && init?.method === 'POST') {
        posts += 1;
        return new Response('{"error":{"code":"CONNECTION_CAP_EXCEEDED"}}', { status: 429 });
      }
      return new Response('{}', { status: 200 });
    };
    const client = new MuxStreamClient({ fetch: fetchImpl });
    const reasons: string[] = [];
    client.subscribe('chat', 'c1', () => {}, { onDisconnected: (r) => reasons.push(r ?? '') });

    await vi.advanceTimersByTimeAsync(50);
    expect(posts).toBe(1);
    expect(reasons).toEqual(['http:429']);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(posts).toBe(2); // backed off, then retried the same thing

    client.disposeAll();
  });
});
