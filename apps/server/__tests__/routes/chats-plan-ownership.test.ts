// ────────────────────────────────────────────────────────────────
// Review 6.1 — cross-chat plan access.
//
// The plan routes carry a header stating that "every handler below verifies
// the plan/interaction actually belongs to the `:id` chat. That ownership
// check is the only thing preventing cross-chat mutation." Five of the seven
// handlers did not perform it: they looked the plan up by id alone and never
// compared it to the chat in the URL.
//
// That made it a real data leak rather than a theoretical one, because
// `read:chats`/`write:chats` is the DEFAULT grant for every paired device,
// phones included. Anyone holding it could read another chat's plan, comment
// on it, overwrite its content, or export it to a workspace.
//
// The mock plan belongs to `chat-1`, so every request below asks a DIFFERENT
// chat for it. Each must 404 — not 403, which would confirm the plan exists.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp } from '../helpers/testApp.js';

describe('plan routes reject a plan belonging to another chat', () => {
  let app: Express;

  beforeEach(() => {
    ({ app } = createTestApp());
  });

  const OTHER = 'chat-someone-else';

  it('GET /chats/:id/plans/:planId', async () => {
    const res = await request(app).get(`/api/chats/${OTHER}/plans/plan-1`);
    expect(res.status).toBe(404);
  });

  it('GET /chats/:id/plans/:planId/content', async () => {
    const res = await request(app).get(`/api/chats/${OTHER}/plans/plan-1/content`);
    expect(res.status).toBe(404);
  });

  it('PUT /chats/:id/plans/:planId/content', async () => {
    const res = await request(app)
      .put(`/api/chats/${OTHER}/plans/plan-1/content`)
      .send({ content: '# overwritten', expectedRevision: 1 });
    expect(res.status).toBe(404);
  });

  it('POST /chats/:id/plans/:planId/comments', async () => {
    const res = await request(app)
      .post(`/api/chats/${OTHER}/plans/plan-1/comments`)
      // A well-formed body on purpose: schema validation runs first, and a
      // 400 would prove nothing about the ownership check.
      .send({ body: 'leaked', revision: 1 });
    expect(res.status).toBe(404);
  });

  it('POST /chats/:id/plans/:planId/save-to-workspace', async () => {
    const res = await request(app).post(`/api/chats/${OTHER}/plans/plan-1/save-to-workspace`).send({});
    expect(res.status).toBe(404);
  });

  it('still serves the plan to the chat that owns it', async () => {
    const res = await request(app).get('/api/chats/chat-1/plans/plan-1');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'plan-1', chatId: 'chat-1' });
  });
});
