import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createReviewRoutes } from '../routes/review.js';
import type { Container } from '../composition-root.js';

function setup() {
  const threads = [
    { id: 'one', workspaceId: 'workspace', repoAlias: 'main' },
    { id: 'two', workspaceId: 'workspace', repoAlias: 'api' },
    { id: 'three', workspaceId: 'workspace', repoAlias: 'main' },
  ];
  const markSubmitted = vi.fn();
  const getLatest = vi.fn(async (_workspace: string, alias: string) => ({ id: `checkpoint-${alias}` }));
  const sendPrompt = vi.fn(async () => {});
  const app = express();
  app.use(express.json());
  app.use('/workspaces/:id/review', createReviewRoutes({
    reviewThreadService: {
      buildSubmission: async () => ({ prompt: 'Review this', threadIds: threads.map(t => t.id), reviewRound: 1 }),
      getThread: async (id: string) => threads.find(t => t.id === id),
      markSubmitted,
    },
    checkpointService: { getLatest },
    chatManagementService: { sendPrompt },
    workflowRunService: { command: async () => ({ ok: true }) },
    logger: { info: vi.fn() },
  } as unknown as Container));
  return { app, markSubmitted, getLatest, sendPrompt };
}

const body = { threadIds: ['one', 'two', 'three'], target: { kind: 'chat', chatId: 'chat' } };

describe('review submission checkpoints', () => {
  it('anchors each repository batch to its own submission checkpoint', async () => {
    const { app, markSubmitted, getLatest } = setup();
    await request(app).post('/workspaces/workspace/review/submit').send(body).expect(200);
    expect(getLatest.mock.calls).toEqual([['workspace', 'main'], ['workspace', 'api']]);
    expect(markSubmitted.mock.calls).toEqual([
      [['one', 'three'], 1, undefined, 'checkpoint-main'],
      [['two'], 1, undefined, 'checkpoint-api'],
    ]);
  });
  it('does not consume feedback when delivery fails', async () => {
    const { app, sendPrompt, markSubmitted } = setup();
    sendPrompt.mockRejectedValueOnce(new Error('Provider unavailable'));
    await request(app).post('/workspaces/workspace/review/submit').send(body).expect(500);
    expect(markSubmitted).not.toHaveBeenCalled();
  });
  it('preview does not deliver or mutate review state', async () => {
    const { app, sendPrompt, markSubmitted } = setup();
    await request(app).post('/workspaces/workspace/review/submit').send({ ...body, preview: true }).expect(200);
    expect(sendPrompt).not.toHaveBeenCalled();
    expect(markSubmitted).not.toHaveBeenCalled();
  });
});
