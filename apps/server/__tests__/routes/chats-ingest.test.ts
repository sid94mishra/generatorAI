// ────────────────────────────────────────────────────────────────
// POST /chats/ingest — "Send to agent" from the OS share sheet (mobile MG-09, M9-08).
// One request: an existing chat or a new one, the note / text / URL as the prompt, attachments as artifacts, and an
// Idempotency-Key so a retried share is not sent twice.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Container } from '../../src/composition-root.js';
import { createTestApp } from '../helpers/testApp.js';

type Mock = ReturnType<typeof vi.fn>;

describe('POST /chats/ingest', () => {
  let app: Express;
  let container: Container;

  beforeEach(() => {
    ({ app, container } = createTestApp());
  });

  it('requires an Idempotency-Key', async () => {
    const res = await request(app).post('/api/chats/ingest').field('target', JSON.stringify({ chatId: 'chat-1' })).field('text', 'hi');
    expect(res.status).toBe(400);
    expect(container.chatManagementService.sendPrompt).not.toHaveBeenCalled();
  });

  it('refuses a malformed target and an empty share', async () => {
    const bad = await request(app).post('/api/chats/ingest').set('Idempotency-Key', 'k1').field('target', '{"chat":"x"}').field('text', 'hi');
    expect(bad.status).toBe(400);
    const empty = await request(app).post('/api/chats/ingest').set('Idempotency-Key', 'k2').field('target', JSON.stringify({ chatId: 'chat-1' }));
    expect(empty.status).toBe(400);
    expect(container.chatManagementService.sendPrompt).not.toHaveBeenCalled();
  });

  it('sends the note, text and URL with the files to an existing chat', async () => {
    const res = await request(app)
      .post('/api/chats/ingest')
      .set('Idempotency-Key', 'k3')
      .field('target', JSON.stringify({ chatId: 'chat-1' }))
      .field('note', 'Check this log')
      .field('url', 'https://example.com/run/1')
      .attach('attachments', Buffer.from('log line'), { filename: 'ci.log', contentType: 'text/plain' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ chatId: 'chat-1', created: false });
    expect(container.chatManagementService.createChat).not.toHaveBeenCalled();
    expect(container.artifactService.createArtifact).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'sess-1', name: 'ci.log' }));
    const [chatId, prompt, refs] = (container.chatManagementService.sendPrompt as unknown as Mock).mock.calls[0]!;
    expect(chatId).toBe('chat-1');
    expect(prompt).toBe('Check this log\n\nhttps://example.com/run/1');
    expect(refs).toEqual([expect.objectContaining({ type: 'file', displayName: 'ci.log', artifactId: 'art-2' })]);
  });

  it('creates a new chat named from the share, in the gated permission mode', async () => {
    const res = await request(app)
      .post('/api/chats/ingest')
      .set('Idempotency-Key', 'k4')
      .field('target', JSON.stringify({ newChat: { agentRef: 'user:bug-fixer' } }))
      .attach('attachments', Buffer.from('x'), { filename: 'trace.txt', contentType: 'text/plain' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ chatId: 'chat-1', created: true });
    const params = (container.chatManagementService.createChat as unknown as Mock).mock.calls[0]![0];
    expect(params).toMatchObject({ name: 'Shared file: trace.txt', agentRef: 'user:bug-fixer', harnessConfig: { availableTools: ['*'], streaming: true } });
    expect((container.chatManagementService.sendPrompt as unknown as Mock).mock.calls[0]![1]).toBe('Shared file: trace.txt');
  });

  it('refuses a busy chat before storing anything', async () => {
    (container.chatManagementService.isTurnActive as unknown as Mock).mockReturnValue(true);
    const res = await request(app).post('/api/chats/ingest').set('Idempotency-Key', 'k5').field('target', JSON.stringify({ chatId: 'chat-1' })).field('text', 'hi');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CHAT_BUSY');
    expect(container.artifactService.createArtifact).not.toHaveBeenCalled();
  });

  it('replays a retried share without sending it again', async () => {
    const seen = new Map<string, string>();
    (container as unknown as { idempotencyService: unknown }).idempotencyService = {
      run: async (opts: { key: string; scope: string }, execute: () => Promise<{ executionId: string; value: unknown }>) => {
        const id = seen.get(`${opts.scope}/${opts.key}`);
        if (id) return { replayed: true, executionId: id };
        const r = await execute();
        seen.set(`${opts.scope}/${opts.key}`, r.executionId);
        return { replayed: false, executionId: r.executionId, value: r.value };
      },
    };
    const send = () => request(app).post('/api/chats/ingest').set('Idempotency-Key', 'same').field('target', JSON.stringify({ chatId: 'chat-1' })).field('text', 'once');
    expect((await send()).status).toBe(201);
    const again = await send();
    expect(again.status).toBe(200);
    expect(again.headers['x-idempotent-replay']).toBe('true');
    expect(again.body).toEqual({ chatId: 'chat-1', created: false });
    expect(container.chatManagementService.sendPrompt).toHaveBeenCalledTimes(1);
  });
});
