// ────────────────────────────────────────────────────────────────
// POST /api/chats + PATCH /api/chats/:id — the per-chat agent-native
// source-control option.
//
// The persistence is the repository's job; these pin the HTTP contract:
// the option reaches the service/repository intact, bad shapes are refused
// with the route's `VALIDATION_ERROR` envelope, the three flags are
// normalised UPWARD rather than rejected, and the field survives the
// response projection that strips the server-internal `conversationSeed`.
// ────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

import { createChatApiRoutes } from '../routes/chats.js';

const createChat = vi.fn();
const update = vi.fn();
const getById = vi.fn();

function makeApp() {
  const container = {
    chatManagementService: { createChat },
    chatEntityRepo: { getById, update },
    workspaceManager: { getExecutionWorkspace: vi.fn(async () => null) },
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

/** What `createChat` was called with, for the single call under test. */
function createdWith(): Record<string, unknown> {
  return createChat.mock.calls[0]![0] as Record<string, unknown>;
}

beforeEach(() => {
  createChat.mockReset();
  update.mockReset();
  getById.mockReset();
  createChat.mockImplementation(async (params: Record<string, unknown>) => ({
    id: 'c1',
    name: params['name'],
    sessionId: 's1',
    tags: [],
    status: 'active',
    sourceControl: params['sourceControl'],
    conversationSeed: 'SECRET',
  }));
  update.mockImplementation(async (_id: string, updates: Record<string, unknown>) => ({
    id: 'c1',
    name: 'x',
    sessionId: 's1',
    tags: [],
    status: 'active',
    ...updates,
  }));
});

describe('POST /api/chats — sourceControl', () => {
  it('passes the option through to the service and returns it', async () => {
    const res = await request(makeApp())
      .post('/api/chats')
      .send({ name: 'x', sourceControl: { autoCommit: true, autoPush: false, autoPullRequest: false, base: 'main', draft: true } });

    expect(res.status).toBe(201);
    expect(createdWith()['sourceControl']).toEqual({
      autoCommit: true,
      autoPush: false,
      autoPullRequest: false,
      base: 'main',
      draft: true,
    });
    // Survives the projection that strips the server-internal seed.
    expect(res.body.sourceControl).toEqual(createdWith()['sourceControl']);
    expect(res.body.conversationSeed).toBeUndefined();
  });

  it('leaves the option off entirely when it is not asked for', async () => {
    const res = await request(makeApp()).post('/api/chats').send({ name: 'x' });
    expect(res.status).toBe(201);
    expect(createdWith()['sourceControl']).toBeUndefined();
  });

  it('defaults missing flags to false when the object is present', async () => {
    await request(makeApp()).post('/api/chats').send({ name: 'x', sourceControl: { autoCommit: true } });
    expect(createdWith()['sourceControl']).toEqual({ autoCommit: true, autoPush: false, autoPullRequest: false });
  });

  it('normalises the flags upward: a PR implies a push implies a commit', async () => {
    await request(makeApp())
      .post('/api/chats')
      .send({ name: 'x', sourceControl: { autoPullRequest: true } });
    expect(createdWith()['sourceControl']).toMatchObject({ autoCommit: true, autoPush: true, autoPullRequest: true });

    createChat.mockClear();
    await request(makeApp()).post('/api/chats').send({ name: 'x', sourceControl: { autoPush: true } });
    expect(createdWith()['sourceControl']).toMatchObject({ autoCommit: true, autoPush: true, autoPullRequest: false });
  });

  it.each([
    ['a non-object', 'always'],
    ['an array', [{ autoCommit: true }]],
    ['a non-boolean flag', { autoCommit: 'yes' }],
    ['a non-boolean autoPush', { autoPush: 1 }],
    ['an empty base', { autoCommit: true, base: '   ' }],
    ['a non-string base', { autoCommit: true, base: 7 }],
    ['a non-boolean draft', { autoPullRequest: true, draft: 'yes' }],
  ])('refuses %s with VALIDATION_ERROR', async (_label, sourceControl) => {
    const res = await request(makeApp()).post('/api/chats').send({ name: 'x', sourceControl });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(createChat).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/chats/:id — sourceControl', () => {
  it('persists the option and answers with the updated chat', async () => {
    const res = await request(makeApp())
      .patch('/api/chats/c1')
      .send({ sourceControl: { autoCommit: true, autoPush: true, autoPullRequest: false } });

    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith('c1', {
      sourceControl: { autoCommit: true, autoPush: true, autoPullRequest: false },
    });
    expect(res.body.sourceControl).toEqual({ autoCommit: true, autoPush: true, autoPullRequest: false });
  });

  it('normalises upward on update too', async () => {
    await request(makeApp()).patch('/api/chats/c1').send({ sourceControl: { autoPullRequest: true, base: 'main' } });
    expect(update.mock.calls[0]![1]).toMatchObject({
      sourceControl: { autoCommit: true, autoPush: true, autoPullRequest: true, base: 'main' },
    });
  });

  it('null turns the option back off', async () => {
    await request(makeApp()).patch('/api/chats/c1').send({ sourceControl: null });
    expect(update.mock.calls[0]![1]).toMatchObject({ sourceControl: null });
  });

  it('a PATCH that does not mention it leaves it untouched', async () => {
    await request(makeApp()).patch('/api/chats/c1').send({ name: 'renamed' });
    expect(update.mock.calls[0]![1]).not.toHaveProperty('sourceControl');
  });

  it('refuses a bad shape with VALIDATION_ERROR and writes nothing', async () => {
    const res = await request(makeApp()).patch('/api/chats/c1').send({ sourceControl: { autoCommit: 'yes' } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(update).not.toHaveBeenCalled();
  });
});
