// ────────────────────────────────────────────────────────────────
// `read:activity` — the global lifecycle feed for non-admin devices.
//
// `scope=global` used to require `admin:settings`, which no default device or
// mobile grant carries. The mobile app subscribes `global` for list-lifecycle
// events on the SAME multiplexed connection as its chat feeds, and the server
// answered the whole `POST /api/stream/connections` with 403 — so a paired
// phone received no live events at all, for any scope.
//
// The fix is a lesser scope that opens `global` narrowed to
// `LIFECYCLE_EVENT_KINDS`. The narrowing is decided from the principal and
// applied in the route's own delivery path, so these tests drive the real
// attached stream through a fake broker that deliberately IGNORES
// `kindPrefixes`: if the gate lived only in the broker's filter, (b) below
// would fail.
// ────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import type { Principal } from '@generatorai/auth';
import type { StreamEventRow } from '@generatorai/core';

import { createUnifiedStreamRoutes } from '../routes/stream.js';
import { resetConnectionRegistry } from '../streaming/streamConnectionRegistry.js';
import { LIFECYCLE_EVENT_KINDS } from '../composition/streamScopes.js';

type Deliver = (row: StreamEventRow) => void | Promise<void>;

/**
 * A broker that records every subscription's handler and the options it was
 * given, and lets the test publish straight to a scope. It applies NO prefix
 * filter of its own — that is the point.
 */
function fakeBroker() {
  const handlers = new Map<string, Set<Deliver>>();
  const subscribeOptions = new Map<string, Record<string, unknown>>();
  let seq = 0;
  return {
    handlers,
    subscribeOptions,
    streamSpaceId: async () => 'space-1',
    replay: async () => [],
    publish: vi.fn(),
    subscribe: vi.fn(
      async (scope: string, scopeId: string, handler: Deliver, opts: Record<string, unknown> = {}) => {
        const key = `${scope}:${scopeId}`;
        subscribeOptions.set(key, opts);
        const set = handlers.get(key) ?? new Set<Deliver>();
        set.add(handler);
        handlers.set(key, set);
        const onResume = opts['onResume'] as ((s: unknown) => void) | undefined;
        onResume?.({ resumed: true, oldestSeq: 0, deliveredUpTo: 0 });
        return () => {
          set.delete(handler);
        };
      },
    ),
    /** Deliver one event to everything subscribed on `scope:scopeId`. */
    emit(scope: string, scopeId: string, kind: string, payload: unknown): void {
      seq += 1;
      const row = {
        scope,
        scopeId,
        kind,
        payload,
        seq,
        id: seq,
        ts: Date.now(),
      } as unknown as StreamEventRow;
      for (const h of handlers.get(`${scope}:${scopeId}`) ?? []) void h(row);
    },
  };
}

function principal(scopes: readonly string[], id = 'device:d1'): Principal {
  return {
    type: 'paired-device',
    id,
    scopes: scopes as Principal['scopes'],
    transport: 'lan',
    credentialKind: 'access-token',
  };
}

const PHONE = ['read:chats', 'write:chats', 'stream:events', 'read:activity'] as const;
const ADMIN = ['read:chats', 'stream:events', 'admin:settings'] as const;
/** The pre-fix default grant: no `admin:settings`, no `read:activity`. */
const LEGACY_PHONE = ['read:chats', 'write:chats', 'stream:events'] as const;

let broker: ReturnType<typeof fakeBroker>;
let server: Server | null = null;
const openStreams: AbortController[] = [];

function makeApp(current: Principal) {
  const container = {
    streamBroker: broker,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    config: { streaming: { heartbeatIntervalMs: 60_000 } },
    security: {
      auth: {
        issueStreamTicket: vi.fn(async () => ({ ticket: 'tkt', expiresAt: Date.now() + 30_000 })),
      },
    },
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.principal = current;
    next();
  });
  app.use('/api/stream', createUnifiedStreamRoutes(container as never));
  return app;
}

async function listen(app: express.Express): Promise<string> {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server!.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

interface Frame {
  event: string | null;
  data: Record<string, unknown>;
}

/**
 * Attach `GET /api/stream?c=<id>` and hand back the frames as they arrive.
 * `frames` is live — a test publishes, then waits for the array to grow.
 */
async function attach(base: string, connectionId: string): Promise<{ frames: Frame[]; close: () => void }> {
  const abort = new AbortController();
  openStreams.push(abort);
  const res = await fetch(`${base}/api/stream?c=${encodeURIComponent(connectionId)}`, {
    headers: { accept: 'text/event-stream' },
    signal: abort.signal,
  });
  expect(res.status).toBe(200);
  const frames: Frame[] = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          let event: string | null = null;
          let data = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          if (data) frames.push({ event, data: JSON.parse(data) as Record<string, unknown> });
        }
      }
    } catch {
      /* aborted */
    }
  })();
  return { frames, close: () => abort.abort() };
}

const hello = (frames: Frame[]) => frames.find((f) => f.event === 'hello');
const dataFrames = (frames: Frame[]) => frames.filter((f) => f.event === null);

beforeEach(() => {
  resetConnectionRegistry();
  broker = fakeBroker();
});

afterEach(async () => {
  for (const a of openStreams.splice(0)) a.abort();
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
});

describe('read:activity opens the global lifecycle feed', () => {
  it('(a) a read:activity principal can open a mux connection that subscribes global', async () => {
    const res = await request(makeApp(principal([...PHONE])))
      .post('/api/stream/connections')
      .send({ subs: [{ scope: 'chat', id: 'c1' }, { scope: 'global' }] });

    expect(res.status).toBe(201);
    expect(res.body.connectionId).toEqual(expect.any(String));
  });

  it('(c) a principal with neither scope still gets 403, now naming the refused sub', async () => {
    const res = await request(makeApp(principal([...LEGACY_PHONE])))
      .post('/api/stream/connections')
      .send({ subs: [{ scope: 'chat', id: 'c1' }, { scope: 'global' }] });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSUFFICIENT_SCOPE');
    // The lesser scope is the one reported — a pairing UI acting on this
    // should ask for `read:activity`, not for admin.
    expect(res.body.error.requiredScopes).toEqual(['read:activity']);
    expect(res.body.error.sub).toEqual({ scope: 'global', id: 'all' });
  });

  it('(c) the follow-up /subs endpoint refuses global the same way, with `sub`', async () => {
    const app = makeApp(principal([...LEGACY_PHONE]));
    const base = await listen(app);
    const created = await request(app)
      .post('/api/stream/connections')
      .send({ subs: [{ scope: 'chat', id: 'c1' }] });
    const stream = await attach(base, created.body.connectionId as string);
    await vi.waitFor(() => expect(hello(stream.frames)).toBeDefined());

    const res = await request(app)
      .post(`/api/stream/connections/${created.body.connectionId as string}/subs`)
      .send({ add: [{ scope: 'global' }] });

    expect(res.status).toBe(403);
    expect(res.body.error.sub).toEqual({ scope: 'global', id: 'all' });
    expect(res.body.error.requiredScopes).toEqual(['read:activity']);
  });

  it('(c) the single-scope endpoint carries `sub` too', async () => {
    const res = await request(makeApp(principal([...LEGACY_PHONE]))).get('/api/stream?scope=global');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSUFFICIENT_SCOPE');
    expect(res.body.error.sub).toEqual({ scope: 'global', id: 'all' });
  });

  it('(b) a read:activity subscriber receives chat.created but NOT harness.token published to global', async () => {
    const app = makeApp(principal([...PHONE]));
    const base = await listen(app);
    const created = await request(app)
      .post('/api/stream/connections')
      // No client filter at all — the restriction must not depend on one.
      .send({ subs: [{ scope: 'global' }] });
    const stream = await attach(base, created.body.connectionId as string);
    await vi.waitFor(() => expect(hello(stream.frames)).toBeDefined());
    expect(hello(stream.frames)!.data['active']).toEqual(['global:all']);

    // The fake broker filters nothing, so every one of these reaches the
    // route's handler. Only the lifecycle kind may reach the socket.
    broker.emit('global', 'all', 'harness.token', { text: 'secret transcript' });
    broker.emit('global', 'all', 'stage_run.queued', { stageRunId: 's1' });
    broker.emit('global', 'all', 'chat.question.asked', { question: 'also content' });
    broker.emit('global', 'all', 'chat.created', { chatId: 'c9', name: 'New chat' });
    broker.emit('global', 'all', 'harness.token', { text: 'more transcript' });

    await vi.waitFor(() => expect(dataFrames(stream.frames).length).toBeGreaterThan(0));
    // Give any leaked frame a chance to arrive before asserting it did not.
    await new Promise((r) => setTimeout(r, 50));

    const kinds = dataFrames(stream.frames).map((f) => f.data['k']);
    expect(kinds).toEqual(['chat.created']);
    expect(JSON.stringify(stream.frames)).not.toContain('secret transcript');

    // And the broker was asked for the lifecycle families up front, so replay
    // does not walk every row only to have it dropped here.
    const opts = broker.subscribeOptions.get('global:all')!;
    expect(opts['kindPrefixes']).toEqual(expect.arrayContaining(['chat.', 'workflow_run.', 'automation_execution.']));
  });

  it('(b) a client filter cannot widen a read:activity subscription past lifecycle kinds', async () => {
    const app = makeApp(principal([...PHONE]));
    const base = await listen(app);
    const created = await request(app)
      .post('/api/stream/connections')
      .send({ subs: [{ scope: 'global', filter: ['harness.', 'chat.'] }] });
    const stream = await attach(base, created.body.connectionId as string);
    await vi.waitFor(() => expect(hello(stream.frames)).toBeDefined());

    broker.emit('global', 'all', 'harness.token', { text: 'nope' });
    broker.emit('global', 'all', 'chat.archived', { chatId: 'c1' });
    await vi.waitFor(() => expect(dataFrames(stream.frames).length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 50));

    expect(dataFrames(stream.frames).map((f) => f.data['k'])).toEqual(['chat.archived']);
  });

  it('(b) the same narrowing applies to a global sub added through /subs', async () => {
    const app = makeApp(principal([...PHONE]));
    const base = await listen(app);
    const created = await request(app)
      .post('/api/stream/connections')
      .send({ subs: [{ scope: 'chat', id: 'c1' }] });
    const stream = await attach(base, created.body.connectionId as string);
    await vi.waitFor(() => expect(hello(stream.frames)).toBeDefined());

    const added = await request(app)
      .post(`/api/stream/connections/${created.body.connectionId as string}/subs`)
      .send({ add: [{ scope: 'global' }] });
    expect(added.status).toBe(202);
    await vi.waitFor(() =>
      expect(stream.frames.find((f) => f.event === 'subs')?.data['active']).toContain('global:all'),
    );

    broker.emit('global', 'all', 'harness.token', { text: 'nope' });
    broker.emit('global', 'all', 'workflow_run.completed', { workflowRunId: 'r1' });
    await vi.waitFor(() => expect(dataFrames(stream.frames).length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 50));

    expect(dataFrames(stream.frames).map((f) => f.data['k'])).toEqual(['workflow_run.completed']);
  });

  it('(d) an admin:settings subscriber still receives everything on global', async () => {
    const app = makeApp(principal([...ADMIN]));
    const base = await listen(app);
    const created = await request(app)
      .post('/api/stream/connections')
      .send({ subs: [{ scope: 'global' }] });
    const stream = await attach(base, created.body.connectionId as string);
    await vi.waitFor(() => expect(hello(stream.frames)).toBeDefined());

    broker.emit('global', 'all', 'harness.token', { text: 'visible to admin' });
    broker.emit('global', 'all', 'chat.created', { chatId: 'c9' });
    await vi.waitFor(() => expect(dataFrames(stream.frames).length).toBe(2));

    expect(dataFrames(stream.frames).map((f) => f.data['k'])).toEqual(['harness.token', 'chat.created']);
    // No filter was imposed on the admin.
    expect(broker.subscribeOptions.get('global:all')!['kindPrefixes']).toBeUndefined();
  });

  it('the single-scope endpoint narrows a read:activity reader the same way', async () => {
    const app = makeApp(principal([...PHONE]));
    const base = await listen(app);
    const abort = new AbortController();
    openStreams.push(abort);
    const res = await fetch(`${base}/api/stream?scope=global`, {
      headers: { accept: 'text/event-stream' },
      signal: abort.signal,
    });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(broker.handlers.get('global:all')?.size ?? 0).toBeGreaterThan(0));

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
        }
      } catch {
        /* aborted */
      }
    })();

    broker.emit('global', 'all', 'harness.token', { text: 'secret transcript' });
    broker.emit('global', 'all', 'chat.deleted', { chatId: 'c1' });
    await vi.waitFor(() => expect(text).toContain('chat.deleted'));
    await new Promise((r) => setTimeout(r, 50));

    expect(text).not.toContain('secret transcript');
    expect(text).not.toContain('harness.token');
  });

  it('every lifecycle kind survives the gate (the allowlist is the whole set, not a subset of it)', async () => {
    const app = makeApp(principal([...PHONE]));
    const base = await listen(app);
    const created = await request(app)
      .post('/api/stream/connections')
      .send({ subs: [{ scope: 'global' }] });
    const stream = await attach(base, created.body.connectionId as string);
    await vi.waitFor(() => expect(hello(stream.frames)).toBeDefined());

    for (const kind of LIFECYCLE_EVENT_KINDS) broker.emit('global', 'all', kind, {});
    await vi.waitFor(() => expect(dataFrames(stream.frames).length).toBe(LIFECYCLE_EVENT_KINDS.size));
  });
});
