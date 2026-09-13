// ────────────────────────────────────────────────────────────────
// POST /api/chats/:id/rewind, POST /api/chats/:id/fork, GET /api/chats/:id/transcript
//
// The service does the work; these pin the HTTP contract: validation, the
// coded errors (CHAT_BUSY → 409, NOT_FOUND → 404), the 201 on fork with the
// internal `conversationSeed` stripped, and the markdown rendering.
// ────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

import { createChatApiRoutes } from '../routes/chats.js';

const rewindChat = vi.fn();
const forkChat = vi.fn();
const getTranscript = vi.fn();
const getById = vi.fn();

function makeApp() {
  const container = {
    chatManagementService: { rewindChat, forkChat, getTranscript },
    chatEntityRepo: { getById },
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

function coded(code: string, message = code): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

beforeEach(() => {
  rewindChat.mockReset();
  forkChat.mockReset();
  getTranscript.mockReset();
  getById.mockReset();
});

describe('POST /api/chats/:id/rewind', () => {
  it('passes turnId and scope through and answers the service result', async () => {
    rewindChat.mockResolvedValue({ chatId: 'c1', turnId: 't2', scope: 'all', prompt: 'q2', conversation: 'native' });
    const res = await request(makeApp()).post('/api/chats/c1/rewind').send({ turnId: 't2', scope: 'all' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ turnId: 't2', prompt: 'q2', conversation: 'native' });
    expect(rewindChat).toHaveBeenCalledWith('c1', 't2', 'all');
  });

  it('defaults the scope to all', async () => {
    rewindChat.mockResolvedValue({ chatId: 'c1', turnId: 't2', scope: 'all', conversation: 'skipped' });
    await request(makeApp()).post('/api/chats/c1/rewind').send({ turnId: 't2' });
    expect(rewindChat).toHaveBeenCalledWith('c1', 't2', 'all');
  });

  it('rejects a missing turnId or an unknown scope', async () => {
    const app = makeApp();
    expect((await request(app).post('/api/chats/c1/rewind').send({})).status).toBe(400);
    expect((await request(app).post('/api/chats/c1/rewind').send({ turnId: 't', scope: 'files' })).status).toBe(400);
    expect(rewindChat).not.toHaveBeenCalled();
  });

  it('maps CHAT_BUSY to 409 and NOT_FOUND to 404', async () => {
    const app = makeApp();
    rewindChat.mockRejectedValueOnce(coded('CHAT_BUSY', 'still generating'));
    const busy = await request(app).post('/api/chats/c1/rewind').send({ turnId: 't2' });
    expect(busy.status).toBe(409);
    expect(busy.body.error).toEqual({ code: 'CHAT_BUSY', message: 'still generating' });

    rewindChat.mockRejectedValueOnce(coded('NOT_FOUND', 'no such turn'));
    const missing = await request(app).post('/api/chats/c1/rewind').send({ turnId: 'nope' });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
  });
});

describe('POST /api/chats/:id/fork', () => {
  it('answers 201 with the new chat, minus the server-internal seed', async () => {
    forkChat.mockResolvedValue({
      chat: { id: 'c2', name: 'x (fork)', sessionId: 's2', forkedFromChatId: 'c1', conversationSeed: 'SECRET', tags: [], status: 'active' },
      turnId: 't3',
      conversation: 'synthetic',
    });
    const res = await request(makeApp()).post('/api/chats/c1/fork').send({ turnId: 't3', name: 'branch' });
    expect(res.status).toBe(201);
    expect(res.body.chat.id).toBe('c2');
    expect(res.body.chat.conversationSeed).toBeUndefined();
    expect(res.body.conversation).toBe('synthetic');
    expect(forkChat).toHaveBeenCalledWith('c1', { turnId: 't3', name: 'branch' });
  });

  it('a bare POST forks after the last turn', async () => {
    forkChat.mockResolvedValue({ chat: { id: 'c2', tags: [], status: 'active' }, conversation: 'native' });
    const res = await request(makeApp()).post('/api/chats/c1/fork');
    expect(res.status).toBe(201);
    expect(forkChat).toHaveBeenCalledWith('c1', {});
  });

  it('maps CHAT_BUSY to 409', async () => {
    forkChat.mockRejectedValueOnce(coded('CHAT_BUSY'));
    const res = await request(makeApp()).post('/api/chats/c1/fork').send({});
    expect(res.status).toBe(409);
  });
});

describe('GET /api/chats/:id/transcript', () => {
  const rows = [
    { id: 'm1', chatId: 'c1', sessionId: 's1', role: 'user', content: 'Add a README', timestamp: new Date('2026-09-13T10:00:00Z'), metadata: { turnId: 't1' } },
    {
      id: 'm2', chatId: 'c1', sessionId: 's1', role: 'assistant', content: 'Done.', timestamp: new Date('2026-09-13T10:00:05Z'),
      metadata: { turnId: 't1', toolCalls: [{ id: '1', tool: 'Write', args: { file_path: 'README.md' }, status: 'complete', fileOp: { additions: 3, deletions: 0 } }] },
    },
  ];

  it('returns every message as JSON by default', async () => {
    getById.mockResolvedValue({ id: 'c1', name: 'Docs', tags: [], status: 'active' });
    getTranscript.mockResolvedValue(rows);
    const res = await request(makeApp()).get('/api/chats/c1/transcript');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Docs');
    expect(res.body.messages).toHaveLength(2);
  });

  it('renders markdown on request', async () => {
    getById.mockResolvedValue({ id: 'c1', name: 'Docs', tags: [], status: 'active' });
    getTranscript.mockResolvedValue(rows);
    const res = await request(makeApp()).get('/api/chats/c1/transcript?format=markdown');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/markdown/);
    expect(res.text).toContain('# Docs');
    expect(res.text).toContain('## You');
    expect(res.text).toContain('Add a README');
    expect(res.text).toContain('`Write` README.md (+3 −0)');
    expect(res.text).toContain('Done.');
  });
});
