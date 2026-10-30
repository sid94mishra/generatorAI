// ────────────────────────────────────────────────────────────────
// GET /chats (chat list v2, G-02) — the wire query as the route reads it,
// and the bulk archive / delete routes.
//
// The route validates and hands a typed request to `ChatListService`; paging,
// filtering and the row summaries are tested against a real database in
// `src/__tests__/chatList.test.ts`. Here: every filter the clients send is
// read (the pre-v2 route silently dropped `limit` and the CLI's status flag,
// so `chat list --limit 3` returned 343 rows), and nonsense is refused rather
// than ignored.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Container } from '../../src/composition-root.js';
import { createTestApp } from '../helpers/testApp.js';

type Mock = ReturnType<typeof vi.fn>;

describe('GET /chats — the query the clients send', () => {
  let app: Express;
  let container: Container;
  const list = (): Mock => container.chatListService.list as unknown as Mock;

  beforeEach(() => {
    ({ app, container } = createTestApp());
  });

  it('defaults: activity sort, 50 rows, no workers', async () => {
    const res = await request(app).get('/api/chats');
    expect(res.status).toBe(200);
    expect(list()).toHaveBeenCalledWith(
      expect.objectContaining({ sort: 'activity', limit: 50, workers: false, projectIds: [], states: [] }),
    );
  });

  it('reads every filter, repeated ones as lists', async () => {
    const res = await request(app).get(
      '/api/chats?status=archived&projectId=p1&projectId=p2&agentRef=global:reviewer&tag=a&tag=b' +
        '&state=needs_you&state=failed&q=%20deploy%20&sort=name&cursor=abc&limit=10&workers=true',
    );
    expect(res.status).toBe(200);
    expect(list()).toHaveBeenCalledWith({
      status: 'archived',
      projectIds: ['p1', 'p2'],
      agentRefs: ['global:reviewer'],
      tags: ['a', 'b'],
      states: ['needs_you', 'failed'],
      q: 'deploy',
      sort: 'name',
      cursor: 'abc',
      limit: 10,
      workers: true,
    });
  });

  it('clamps `limit` to the maximum page size', async () => {
    await request(app).get('/api/chats?limit=5000');
    expect(list()).toHaveBeenCalledWith(expect.objectContaining({ limit: 200 }));
  });

  it.each([
    ['limit=0', '`limit`'],
    ['limit=abc', '`limit`'],
    ['status=deleted', '`status`'],
    ['state=paused', '`state`'],
    ['sort=size', '`sort`'],
    ['workers=yes', '`workers`'],
    ['status=active&status=archived', '`status`'],
  ])('refuses %s rather than ignoring it', async (query, mentions) => {
    const res = await request(app).get(`/api/chats?${query}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toContain(mentions);
    expect(list()).not.toHaveBeenCalled();
  });

  it('answers the page envelope with each row decorated for the wire', async () => {
    list().mockResolvedValueOnce({
      items: [
        {
          chat: {
            id: 'c1',
            sessionId: 's1',
            name: 'Upgrade deps',
            status: 'active',
            tags: [],
            conversationSeed: 'server-internal digest',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          summary: { lastActivityAt: '2026-09-26T09:00:00.000Z', changes: { files: 2, additions: 10, deletions: 3 } },
        },
      ],
      nextCursor: 'next',
      total: 7,
      counts: { all: 9, active: 7, archived: 2 },
    });
    const res = await request(app).get('/api/chats?status=active&limit=1');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ nextCursor: 'next', total: 7, counts: { all: 9, active: 7, archived: 2 } });
    expect(res.body.items[0]).toMatchObject({
      id: 'c1',
      summary: { changes: { files: 2, additions: 10, deletions: 3 } },
    });
    // The synthetic-rewind seed never leaves the server.
    expect(res.body.items[0].conversationSeed).toBeUndefined();
  });
});

describe('POST /chats/archive and /chats/delete — bulk actions', () => {
  let app: Express;
  let container: Container;

  beforeEach(() => {
    ({ app, container } = createTestApp());
  });

  it('archives each id once and reports per-id outcomes', async () => {
    const getById = container.chatEntityRepo.getById as unknown as Mock;
    getById.mockImplementation(async (id: string) => {
      if (id === 'missing') {
        const { NotFoundError } = await import('@generatorai/shared');
        throw new NotFoundError('Chat', id);
      }
      return { id, sessionId: `s-${id}`, name: id, status: id === 'old' ? 'archived' : 'active', tags: [] };
    });
    const res = await request(app).post('/api/chats/archive').send({ ids: ['a', 'a', 'old', 'missing'] });
    expect(res.status).toBe(200);
    expect(res.body.succeeded).toEqual(['a', 'old']);
    expect(res.body.failed).toEqual([{ id: 'missing', code: 'NOT_FOUND', message: 'Chat not found: missing' }]);
    // Already archived: not archived again.
    expect(container.chatManagementService.archiveChat).toHaveBeenCalledTimes(1);
    expect(container.chatManagementService.archiveChat).toHaveBeenCalledWith('a');
  });

  it('deletes each id and keeps going past a failure', async () => {
    const deleteChat = container.chatManagementService.deleteChat as unknown as Mock;
    deleteChat.mockImplementation(async (id: string) => {
      if (id === 'b') throw Object.assign(new Error('workspace busy'), { code: 'CHAT_BUSY' });
    });
    const res = await request(app).post('/api/chats/delete').send({ ids: ['a', 'b', 'c'] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      succeeded: ['a', 'c'],
      failed: [{ id: 'b', code: 'CHAT_BUSY', message: 'workspace busy' }],
    });
  });

  it.each([{}, { ids: [] }, { ids: [''] }, { ids: 'a' }, { ids: Array.from({ length: 201 }, (_, i) => `c${i}`) }])(
    'refuses a malformed body %#',
    async (body) => {
      const res = await request(app).post('/api/chats/delete').send(body);
      expect(res.status).toBe(400);
      expect(container.chatManagementService.deleteChat).not.toHaveBeenCalled();
    },
  );
});
