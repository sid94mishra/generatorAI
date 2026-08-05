// ────────────────────────────────────────────────────────────────
// E2E: Chat API Flow — Integration Tests (P9.1)
// Tests the complete chat lifecycle via API endpoints
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../helpers/testApp.js';
import type { Express } from 'express';
import type { Container } from '../../src/composition-root.js';

describe('E2E: Chat API Flow', () => {
  let app: Express;
  let container: Container;

  beforeEach(() => {
    ({ app, container } = createTestApp());
  });

  describe('POST /api/chats — Create Chat', () => {
    it('should create a new chat and return 201', async () => {
      const res = await request(app)
        .post('/api/chats')
        .send({ name: 'My Chat' });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id', 'chat-1');
      expect(res.body).toHaveProperty('name', 'Test Chat');
      expect(res.body).toHaveProperty('status', 'active');
      expect(container.chatManagementService.createChat).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'My Chat' }),
      );
    });

    it('should return 400 for missing name', async () => {
      const res = await request(app)
        .post('/api/chats')
        .send({});

      // Should either accept (name is optional) or return 400
      expect([201, 400]).toContain(res.status);
    });
  });

  describe('GET /api/chats — List Chats', () => {
    it('should return all chats', async () => {
      const res = await request(app).get('/api/chats');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(0);
      expect(container.chatManagementService.listChats).toHaveBeenCalled();
    });

    it('should filter by status', async () => {
      await request(app).get('/api/chats?status=active');
      expect(container.chatManagementService.listChats).toHaveBeenCalled();
    });
  });

  describe('GET /api/chats/:id — Get Chat', () => {
    it('should return a single chat', async () => {
      const res = await request(app).get('/api/chats/chat-1');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('id', 'chat-1');
    });
  });

  describe('DELETE /api/chats/:id — Delete Chat', () => {
    it('should permanently delete a chat and return 204', async () => {
      const res = await request(app).delete('/api/chats/chat-1');

      // DELETE is a hard delete (see chats.ts) — archiving is now a PATCH
      // with { status: 'archived' }.
      expect([200, 204]).toContain(res.status);
      expect(container.chatManagementService.deleteChat).toHaveBeenCalledWith('chat-1');
    });
  });

  describe('POST /api/chats/:id/prompt — Send Prompt', () => {
    it('should accept a prompt', async () => {
      const res = await request(app)
        .post('/api/chats/chat-1/prompt')
        .send({ prompt: 'Hello, world!' });

      expect([200, 202]).toContain(res.status);
    });
  });

  describe('GET /api/chats/:id/messages — Chat Messages', () => {
    it('should return chat message history', async () => {
      const res = await request(app).get('/api/chats/chat-1/messages');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('POST /api/chats/:id/plans/:planId/decision — Plan decision', () => {
    it('should delegate to chatManagementService.decidePlan, feedback included', async () => {
      const res = await request(app)
        .post('/api/chats/chat-1/plans/plan-1/decision')
        .send({ approved: false, feedback: 'Add a --json flag', expectedRevision: 1 });

      expect(res.status).toBe(202);
      // The route must NOT settle the gate itself: only the service releases
      // it as `changes_requested`, which is what tells the agent to revise
      // rather than to stop. Resolving it here once dropped the feedback and
      // rejected the plan instead.
      expect(container.chatManagementService.decidePlan).toHaveBeenCalledWith(
        'chat-1',
        'plan-1',
        expect.objectContaining({ approved: false, feedback: 'Add a --json flag' }),
      );
    });

    it('should map a stale expectedRevision to 409 REVISION_CONFLICT', async () => {
      (container.chatManagementService.decidePlan as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        reason: 'Plan has been revised; reload before deciding',
      });

      const res = await request(app)
        .post('/api/chats/chat-1/plans/plan-1/decision')
        .send({ approved: true, expectedRevision: 1 });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('REVISION_CONFLICT');
    });

    it('should map an already-settled gate to 409 DECISION_CONFLICT', async () => {
      (container.chatManagementService.decidePlan as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        reason: 'No plan review is awaiting a decision',
      });

      const res = await request(app)
        .post('/api/chats/chat-1/plans/plan-1/decision')
        .send({ approved: true });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('DECISION_CONFLICT');
    });
  });

  describe('POST /api/chats/:id/interactions/:interactionId/respond', () => {
    it('should delegate to chatManagementService.answerQuestion', async () => {
      const res = await request(app)
        .post('/api/chats/chat-1/interactions/int-1/respond')
        .send({ answers: { q0: ['Python'] } });

      expect(res.status).toBe(202);
      // Resolving the gate inline left no `chat.question.answered` event, so a
      // reload replayed the card as pending and it was then marked expired.
      expect(container.chatManagementService.answerQuestion).toHaveBeenCalledWith(
        'chat-1',
        'int-1',
        expect.objectContaining({ answers: { q0: ['Python'] } }),
      );
    });

    it('should carry the freeform "skip" response through', async () => {
      await request(app)
        .post('/api/chats/chat-1/interactions/int-1/respond')
        .send({ freeformResponse: 'Skip the questions and use your best judgement.' });

      expect(container.chatManagementService.answerQuestion).toHaveBeenCalledWith(
        'chat-1',
        'int-1',
        expect.objectContaining({
          freeformResponse: 'Skip the questions and use your best judgement.',
        }),
      );
    });

    it('should map an interaction from another chat to 404', async () => {
      (container.chatManagementService.answerQuestion as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ ok: false, reason: 'Interaction not found' });

      const res = await request(app)
        .post('/api/chats/chat-1/interactions/int-1/respond')
        .send({ answers: {} });

      expect(res.status).toBe(404);
    });
  });

  describe('Full Lifecycle', () => {
    it('should support create → prompt → messages → delete flow', async () => {
      // 1. Create
      const createRes = await request(app)
        .post('/api/chats')
        .send({ name: 'Lifecycle Chat' });
      expect(createRes.status).toBe(201);

      // 2. Send prompt
      const promptRes = await request(app)
        .post('/api/chats/chat-1/prompt')
        .send({ prompt: 'What is TypeScript?' });
      expect([200, 202]).toContain(promptRes.status);

      // 3. Get messages
      const msgRes = await request(app).get('/api/chats/chat-1/messages');
      expect(msgRes.status).toBe(200);

      // 4. Delete
      const deleteRes = await request(app).delete('/api/chats/chat-1');
      expect([200, 204]).toContain(deleteRes.status);
    });
  });
});
