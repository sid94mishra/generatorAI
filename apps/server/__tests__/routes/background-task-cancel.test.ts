// ────────────────────────────────────────────────────────────────
// G-20 — POST /chats/:id/background-tasks/:taskId/cancel and the list, over a
// REAL OrchestratorService on a real temp SQLite database.
//
// Pinned: the route attributes the cancel to the user and answers who/when;
// the list and the stored worker row carry the same attribution; the
// orchestrator's chat stream gets `chat.background_task.status` with it; an
// unknown task is 404.
// ────────────────────────────────────────────────────────────────

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORCHESTRATOR_CONFIG, EventBus, OrchestratorService } from '@generatorai/core';
import type { ChatManagementService, IAgentHarness } from '@generatorai/core';
import { closeDB, createDB, DrizzleChatRepository, migrateDB, sessions, type AppDatabase } from '@generatorai/db';
import type { AgentEvent, Chat, TaskBrief } from '@generatorai/shared';

import { createApp } from '../../src/app.js';
import { createMockContainer } from '../helpers/testApp.js';

const PARENT = 'orch-1';
const PARENT_SESSION = 'orch-1-session';

let dir: string;
let db: AppDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'generatorai-g20-route-'));
  db = createDB(join(dir, 'server.db'));
  migrateDB(db);
});

afterEach(() => {
  closeDB(db);
  rmSync(dir, { recursive: true, force: true });
});

async function setup() {
  const chatRepo = new DrizzleChatRepository(db);
  const eventBus = new EventBus();
  const now = new Date();
  await db.insert(sessions).values({ id: PARENT_SESSION, name: 'o', status: 'active', createdAt: now, updatedAt: now });
  await chatRepo.create({
    id: PARENT,
    name: 'Orchestrator',
    sessionId: PARENT_SESSION,
    tags: [],
    status: 'active',
    orchestratorMode: true,
    createdAt: now,
    updatedAt: now,
  } as Chat);

  let n = 0;
  const cms = {
    async createChat(opts: { name: string }) {
      n += 1;
      const id = `worker-${n}`;
      await db.insert(sessions).values({ id: `${id}-session`, name: id, status: 'active', createdAt: now, updatedAt: now });
      return chatRepo.create({
        id,
        name: opts.name,
        sessionId: `${id}-session`,
        tags: [],
        status: 'active',
        parentChatId: PARENT,
        backgroundTask: { orchestratorChatId: PARENT, taskName: opts.name, status: 'spawned' },
        createdAt: now,
        updatedAt: now,
      } as Chat);
    },
    sendPrompt: vi.fn(async () => {}),
    cancelTurn: vi.fn(async (chatId: string) => {
      await eventBus.emit(`${chatId}-session`, { kind: 'harness.cancelled', data: { reason: 'user_abort' } } as AgentEvent);
      await eventBus.emit(`${chatId}-session`, { kind: 'harness.idle', data: {} } as AgentEvent);
    }),
    getStreamingChatIds: () => [],
  } as unknown as ChatManagementService;

  const orchestratorService = new OrchestratorService(
    chatRepo,
    { getById: async (id: string) => ({ id, status: 'active' }) } as never,
    { getByChatId: async () => [] } as never,
    { getModels: async () => [], hasLiveConversation: () => false, destroyConversation: async () => {} } as unknown as IAgentHarness,
    eventBus,
    { ...DEFAULT_ORCHESTRATOR_CONFIG, defaultWorkerModel: 'faux-model', warmFirst: false, workerReleaseGraceMs: 5 },
  );
  orchestratorService.setChatManagementService(cms);

  const container = createMockContainer();
  (container as unknown as { orchestratorService: OrchestratorService }).orchestratorService = orchestratorService;
  const app = createApp(container);

  const stream: AgentEvent[] = [];
  eventBus.subscribe(PARENT_SESSION, (e) => stream.push(e as unknown as AgentEvent));
  const spawned = await orchestratorService.spawnBackgroundAgent(PARENT, {
    taskName: 'audit deps',
    objective: 'x',
  } as unknown as TaskBrief);
  return { app, chatRepo, stream, taskId: spawned.taskId! };
}

describe('G-20 background-task cancel route', () => {
  it('attributes the cancel to the user on the response, the list, the row and the stream', async () => {
    const { app, chatRepo, stream, taskId } = await setup();
    const before = Date.now();

    const res = await request(app).post(`/api/chats/${PARENT}/background-tasks/${taskId}/cancel`).expect(202);
    expect(res.body).toMatchObject({ ok: true, taskId, cancelledBy: 'user' });
    expect(res.body.cancelledAt).toBeGreaterThanOrEqual(before);

    const list = await request(app).get(`/api/chats/${PARENT}/background-tasks`).expect(200);
    expect(list.body.tasks).toEqual([
      expect.objectContaining({ taskId, status: 'cancelled', cancelledBy: 'user', cancelledAt: res.body.cancelledAt }),
    ]);

    const row = await chatRepo.getById(taskId);
    expect(row.backgroundTask).toMatchObject({ status: 'cancelled', cancelledBy: 'user', cancelledAt: res.body.cancelledAt });

    const status = stream.filter((e) => e.kind === 'chat.background_task.status' && e.data.status === 'cancelled');
    expect(status.map((e) => e.data)).toEqual([
      expect.objectContaining({ taskId, cancelledBy: 'user', cancelledAt: res.body.cancelledAt }),
    ]);
  });

  it('404s an unknown task', async () => {
    const { app } = await setup();
    const res = await request(app).post(`/api/chats/${PARENT}/background-tasks/nope/cancel`).expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
