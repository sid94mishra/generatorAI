// ────────────────────────────────────────────────────────────────
// POST /api/chats/:id/cancel — the two-phase Stop body reaches the service.
//
// Web and mobile both compute `{budgetSeconds, force}` from `StopController`
// and used to send `{}`; the route ignored the body regardless, so a "forced"
// second press was the first press again. These tests pin the body down.
// ────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

import { createChatApiRoutes } from '../routes/chats.js';

const cancelTurn = vi.fn(async () => undefined);

function makeApp() {
  const container = {
    chatManagementService: { cancelTurn },
    artifactService: {},
    eventBus: { emit: vi.fn(), emitGlobal: vi.fn() },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    planService: undefined,
    agentInteractionService: undefined,
  };
  const app = express();
  app.use(express.json());
  app.use('/api/chats', createChatApiRoutes(container as never));
  return app;
}

beforeEach(() => {
  cancelTurn.mockClear();
});

describe('POST /api/chats/:id/cancel', () => {
  it('a bare POST with no body is a graceful cancel', async () => {
    const res = await request(makeApp()).post('/api/chats/c1/cancel');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'cancelled', force: false });
    expect(cancelTurn).toHaveBeenCalledWith('c1', {});
  });

  it('passes force and budgetSeconds through, clamping the budget to [0.5, 60]', async () => {
    const app = makeApp();

    const forced = await request(app).post('/api/chats/c1/cancel').send({ force: true, budgetSeconds: 15 });
    expect(forced.status).toBe(200);
    expect(forced.body).toEqual({ status: 'cancelled', force: true });
    expect(cancelTurn).toHaveBeenLastCalledWith('c1', { force: true, budgetSeconds: 15 });

    await request(app).post('/api/chats/c1/cancel').send({ budgetSeconds: 600 });
    expect(cancelTurn).toHaveBeenLastCalledWith('c1', { budgetSeconds: 60 });

    await request(app).post('/api/chats/c1/cancel').send({ budgetSeconds: 0 });
    expect(cancelTurn).toHaveBeenLastCalledWith('c1', { budgetSeconds: 0.5 });
  });

  it('rejects a malformed body instead of guessing', async () => {
    const res = await request(makeApp()).post('/api/chats/c1/cancel').send({ force: 'yes' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(cancelTurn).not.toHaveBeenCalled();
  });
});
