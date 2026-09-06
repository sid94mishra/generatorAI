// ────────────────────────────────────────────────────────────────
// Found by driving the terminal client against a live server.
//
// `generatorai chat list --limit 3` returned 343 rows, and `--status archived`
// returned active chats. Both flags are documented, both are sent by the
// shared client — and this route read neither: it looked only for `status`
// while the client sends `archived`, and it ignored `limit` entirely. So every
// client also paid for the whole table on every list.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Container } from '../../src/composition-root.js';
import { createTestApp } from '../helpers/testApp.js';

function chat(id: string, status: 'active' | 'archived') {
  return { id, name: id, status, sessionId: `s-${id}`, createdAt: new Date(), updatedAt: new Date() };
}

describe('GET /chats — filters the caller actually sends', () => {
  let app: Express;
  let container: Container;

  beforeEach(() => {
    ({ app, container } = createTestApp());
    (container.chatManagementService.listChats as ReturnType<typeof vi.fn>).mockImplementation(
      async () => [chat('a', 'active'), chat('b', 'active'), chat('c', 'active'), chat('d', 'active')],
    );
  });

  it('honours `limit`', async () => {
    const res = await request(app).get('/api/chats?limit=2');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('rejects a nonsense `limit` rather than ignoring it', async () => {
    const res = await request(app).get('/api/chats?limit=0');
    expect(res.status).toBe(400);
  });

  it('maps `archived=true` onto the archived status filter', async () => {
    await request(app).get('/api/chats?archived=true');
    expect(container.chatManagementService.listChats).toHaveBeenCalledWith('archived', undefined);
  });

  it('maps `archived=false` onto the active status filter', async () => {
    await request(app).get('/api/chats?archived=false');
    expect(container.chatManagementService.listChats).toHaveBeenCalledWith('active', undefined);
  });

  it('still accepts the explicit `status` spelling, which wins', async () => {
    await request(app).get('/api/chats?status=archived&archived=false');
    expect(container.chatManagementService.listChats).toHaveBeenCalledWith('archived', undefined);
  });
});
