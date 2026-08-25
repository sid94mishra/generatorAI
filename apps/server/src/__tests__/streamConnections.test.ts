// ────────────────────────────────────────────────────────────────
// W48 — route-level coverage for the multiplexed stream's control plane.
//
// Everything else touching this endpoint tests the connection/registry
// CLASSES directly (`muxConnection.test.ts`). What was missing, per the
// architecture audit, is a test that actually goes through
// `POST /api/stream/connections` and `POST /api/stream/connections/:id/subs`
// as an HTTP client would — auth checks, body validation, and the two
// responses' shapes are only real if something exercises the route itself.
// ────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

import type { Principal } from '@generatorai/auth';

import { createUnifiedStreamRoutes } from '../routes/stream.js';
import {
  MAX_CONNECTIONS_PER_PRINCIPAL,
  MAX_SUBS_PER_CONNECTION,
  getConnection,
  resetConnectionRegistry,
} from '../streaming/streamConnectionRegistry.js';

function principal(overrides: Partial<Principal> = {}): Principal {
  return {
    type: 'paired-device',
    id: 'device:d1',
    scopes: ['read:chats', 'write:chats'],
    transport: 'lan',
    credentialKind: 'access-token',
    ...overrides,
  };
}

/** Minimal container: only what `createUnifiedStreamRoutes` actually reads. */
function makeApp(currentPrincipal: Principal | undefined) {
  const container = {
    streamBroker: { subscribe: vi.fn(), publish: vi.fn() },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    config: { streaming: { heartbeatIntervalMs: 20_000 } },
    security: {
      auth: {
        issueStreamTicket: vi.fn(async () => ({ ticket: 'tkt-1', expiresAt: Date.now() + 30_000 })),
      },
    },
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.principal = currentPrincipal;
    next();
  });
  app.use('/api/stream', createUnifiedStreamRoutes(container as never));
  return app;
}

beforeEach(() => {
  resetConnectionRegistry();
});

describe('POST /api/stream/connections', () => {
  it('requires a credential', async () => {
    const res = await request(makeApp(undefined))
      .post('/api/stream/connections')
      .send({ subs: [{ scope: 'chat', id: 'c1' }] });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('MISSING_CREDENTIAL');
  });

  it('refuses a stream-ticket principal from minting another connection (no chaining)', async () => {
    const res = await request(makeApp(principal({ credentialKind: 'stream-ticket' })))
      .post('/api/stream/connections')
      .send({ subs: [{ scope: 'chat', id: 'c1' }] });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('TICKET_CHAINING_FORBIDDEN');
  });

  it('rejects an empty or missing subs array', async () => {
    const app = makeApp(principal());
    const empty = await request(app).post('/api/stream/connections').send({ subs: [] });
    const missing = await request(app).post('/api/stream/connections').send({});

    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('MISSING_SUBS');
    expect(missing.status).toBe(400);
  });

  it('rejects a sub with an invalid scope', async () => {
    const res = await request(makeApp(principal()))
      .post('/api/stream/connections')
      .send({ subs: [{ scope: 'not-a-real-scope', id: 'c1' }] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_SUB');
  });

  it('opens a connection and returns a connection-bound ticket', async () => {
    const res = await request(makeApp(principal()))
      .post('/api/stream/connections')
      .send({ subs: [{ scope: 'chat', id: 'c1' }, { scope: 'run', id: 'r1' }] });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      connectionId: expect.any(String),
      ticket: 'tkt-1',
      maxSubscriptions: MAX_SUBS_PER_CONNECTION,
    });
    expect(res.headers['cache-control']).toBe('no-store');
    // The connection genuinely exists in the registry the GET handler reads.
    expect(getConnection(res.body.connectionId)).toBeDefined();
  });

  it('enforces the per-principal connection cap with 429 + Retry-After', async () => {
    const app = makeApp(principal());
    for (let i = 0; i < MAX_CONNECTIONS_PER_PRINCIPAL; i += 1) {
      const ok = await request(app).post('/api/stream/connections').send({ subs: [{ scope: 'chat', id: `c${i}` }] });
      expect(ok.status).toBe(201);
    }

    const over = await request(app).post('/api/stream/connections').send({ subs: [{ scope: 'chat', id: 'over' }] });
    expect(over.status).toBe(429);
    expect(over.body.error.code).toBe('CONNECTION_CAP_EXCEEDED');
    expect(over.headers['retry-after']).toBe('5');

    // A different principal is unaffected — N-11's whole point.
    const other = await request(makeApp(principal({ id: 'device:d2' })))
      .post('/api/stream/connections')
      .send({ subs: [{ scope: 'chat', id: 'c1' }] });
    expect(other.status).toBe(201);
  });

  it('enforces the per-connection subscription cap', async () => {
    const subs = Array.from({ length: MAX_SUBS_PER_CONNECTION + 1 }, (_, i) => ({ scope: 'chat', id: `c${i}` }));
    const res = await request(makeApp(principal())).post('/api/stream/connections').send({ subs });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TOO_MANY_SUBSCRIPTIONS');
  });
});

describe('POST /api/stream/connections/:id/subs', () => {
  it('requires a credential', async () => {
    const res = await request(makeApp(undefined)).post('/api/stream/connections/whatever/subs').send({});
    expect(res.status).toBe(401);
  });

  it('answers 404 for both an unknown id and someone else\'s connection (no oracle)', async () => {
    const owner = principal({ id: 'device:owner' });
    const app = makeApp(owner);
    const created = await request(app)
      .post('/api/stream/connections')
      .send({ subs: [{ scope: 'chat', id: 'c1' }] });
    const connectionId = created.body.connectionId as string;

    const unknown = await request(makeApp(owner)).post('/api/stream/connections/does-not-exist/subs').send({});
    const wrongPrincipal = await request(makeApp(principal({ id: 'device:someone-else' })))
      .post(`/api/stream/connections/${connectionId}/subs`)
      .send({});

    expect(unknown.status).toBe(404);
    expect(wrongPrincipal.status).toBe(404);
    expect(unknown.body.error.code).toBe(wrongPrincipal.body.error.code);
  });

  it('refuses to mutate before the connection has been attached via GET', async () => {
    const app = makeApp(principal());
    const created = await request(app).post('/api/stream/connections').send({ subs: [{ scope: 'chat', id: 'c1' }] });

    const res = await request(app)
      .post(`/api/stream/connections/${created.body.connectionId as string}/subs`)
      .send({ add: [{ scope: 'run', id: 'r1' }] });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONNECTION_NOT_ATTACHED');
  });

  it('rejects an invalid `add` sub before ever touching onMutate', async () => {
    const app = makeApp(principal());
    const created = await request(app).post('/api/stream/connections').send({ subs: [{ scope: 'chat', id: 'c1' }] });

    const res = await request(app)
      .post(`/api/stream/connections/${created.body.connectionId as string}/subs`)
      .send({ add: [{ scope: 'nonsense', id: 'x' }] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_SUB');
  });

  it('accepts a well-formed mutation once attached, answering 202 without waiting on it', async () => {
    const app = makeApp(principal());
    const created = await request(app).post('/api/stream/connections').send({ subs: [{ scope: 'chat', id: 'c1' }] });
    const connectionId = created.body.connectionId as string;

    let resolveMutate: () => void = () => undefined;
    const mutateStarted = new Promise<void>((resolve) => {
      const record = getConnection(connectionId);
      if (!record) throw new Error('connection missing');
      record.onMutate = (_add, _remove) => {
        resolve();
        return new Promise<void>((r) => {
          resolveMutate = r;
        });
      };
    });

    const res = await request(app)
      .post(`/api/stream/connections/${connectionId}/subs`)
      .send({ add: [{ scope: 'run', id: 'r1' }], remove: ['chat:c1'] });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true });
    // The response did not wait on the mutation itself (§5.9.2 ④).
    await mutateStarted;
    resolveMutate();
  });
});
