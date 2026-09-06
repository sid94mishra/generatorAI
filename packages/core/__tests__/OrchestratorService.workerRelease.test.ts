// ────────────────────────────────────────────────────────────────
// OrchestratorService — a finished worker releases its harness runtime.
//
// A worker is a single-purpose chat. On the persistent-session Claude
// provider each chat is a ~230 MB CLI process, and nothing released it when
// the worker went idle: the process outlived the orchestration by the whole
// idle window (and, until the provider fix that shipped with this, forever).
// Measured live: eight ~230 MB `claude.exe` children of one developer server.
//
// The release is deferred by a short grace window so an immediate review
// round (`sendToBackgroundAgent`) reuses the warm process.
//
// Run against the code without `scheduleWorkerRelease`, the first test fails
// on `destroyConversation` never being called — the predicted reason.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it, vi } from 'vitest';
import type { ChatManagementService } from '../src/services/ChatManagementService.js';
import { OrchestratorService, DEFAULT_ORCHESTRATOR_CONFIG, type OrchestratorConfig } from '../src/services/orchestrator/OrchestratorService.js';
import { EventBus } from '../src/events/EventBus.js';
import { MockChatRepository } from './MockRepositories.js';
import type { ISessionRepository, IChatMessageRepository } from '../src/domain/ports/IRepositories.js';
import type { IAgentHarness } from '../src/domain/ports/IAgentHarness.js';
import type { Chat, ChatMessage, Session, TaskBrief } from '@generatorai/shared';

function fakeSessionRepo(): ISessionRepository {
  return {
    async create(s) { return s; },
    async getById(id) { return { id, status: 'active', conversationId: `${id}-conv` } as unknown as Session; },
    async getAll() { return []; },
    async getByStatus() { return []; },
    async countByStatus() { return 0; },
    async getByOwner() { return []; },
    async update(id, u) { return { id, ...u } as Session; },
    async updateStatus() {},
    async delete() {},
  };
}

function fakeMessageRepo(): IChatMessageRepository {
  return {
    async create(m) { return m; },
    async getBySessionId() { return []; },
    async getBySessionAndStageRunId() { return []; },
    async getByChatId() {
      return [{ id: 'm', role: 'assistant', content: 'Done.\n<TASK_RESULT>\n{"summary":"ok"}\n</TASK_RESULT>', createdAt: new Date() } as ChatMessage];
    },
    async countByChatId() { return 0; },
    async deleteBySession() {},
  };
}

function fakeHarness(live: Set<string>) {
  const destroyConversation = vi.fn(async (id: string) => { live.delete(id); });
  const harness = {
    getModels: async () => [],
    hasLiveConversation: (id: string) => live.has(id),
    destroyConversation,
  } as unknown as IAgentHarness;
  return { harness, destroyConversation };
}

function fakeChatManagementService(sendPrompt = vi.fn(async () => {})) {
  let counter = 0;
  const svc = {
    async createChat(opts: { name: string }) {
      counter += 1;
      const id = `worker-${counter}`;
      return { id, sessionId: `${id}-session`, name: opts.name } as unknown as Chat;
    },
    sendPrompt,
    async cancelTurn() {},
  } as unknown as ChatManagementService;
  return { svc, sendPrompt };
}

const BRIEF = (taskName: string): TaskBrief => ({ taskName, objective: 'test objective' } as unknown as TaskBrief);
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function makeHarness(config: Partial<OrchestratorConfig> = {}) {
  const chatRepo = new MockChatRepository();
  const eventBus = new EventBus();
  const parentChatId = 'parent-1';
  await chatRepo.create({
    id: parentChatId,
    name: 'Orchestrator',
    sessionId: 'parent-1-session',
    status: 'active',
    orchestratorMode: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Chat);
  const live = new Set<string>();
  const { harness, destroyConversation } = fakeHarness(live);
  const orchestrator = new OrchestratorService(
    chatRepo,
    fakeSessionRepo(),
    fakeMessageRepo(),
    harness,
    eventBus,
    { ...DEFAULT_ORCHESTRATOR_CONFIG, defaultWorkerModel: 'test-model', warmFirst: false, workerReleaseGraceMs: 30, ...config },
  );
  const cms = fakeChatManagementService();
  orchestrator.setChatManagementService(cms.svc);
  return { orchestrator, eventBus, parentChatId, live, destroyConversation };
}

describe('OrchestratorService — worker runtime release', () => {
  it('destroys the harness conversation of a finished worker after the grace window', async () => {
    const h = await makeHarness();
    const spawned = await h.orchestrator.spawnBackgroundAgent(h.parentChatId, BRIEF('research'));
    expect(spawned.ok).toBe(true);
    const conversationId = `${spawned.taskId}-session-conv`;
    h.live.add(conversationId);

    await h.eventBus.emit(`${spawned.taskId}-session`, { kind: 'harness.idle', data: {} });
    await tick(10);
    // Inside the grace window the process is kept.
    expect(h.destroyConversation).not.toHaveBeenCalled();

    await tick(60);
    expect(h.destroyConversation).toHaveBeenCalledWith(conversationId);
    expect(h.live.has(conversationId)).toBe(false);
  });

  it('a review follow-up inside the grace window keeps the process, and release re-arms on the next idle', async () => {
    const h = await makeHarness();
    const spawned = await h.orchestrator.spawnBackgroundAgent(h.parentChatId, BRIEF('review-me'));
    const taskId = spawned.taskId!;
    const conversationId = `${taskId}-session-conv`;
    h.live.add(conversationId);

    await h.eventBus.emit(`${taskId}-session`, { kind: 'harness.idle', data: {} });
    await tick(10);
    const followup = await h.orchestrator.sendToBackgroundAgent(taskId, 'please expand section 2');
    expect(followup.ok).toBe(true);

    await tick(60);
    // The pending release was cancelled by the follow-up.
    expect(h.destroyConversation).not.toHaveBeenCalled();

    await h.eventBus.emit(`${taskId}-session`, { kind: 'harness.idle', data: {} });
    await tick(70);
    expect(h.destroyConversation).toHaveBeenCalledTimes(1);
    expect(h.destroyConversation).toHaveBeenCalledWith(conversationId);
  });

  it('does nothing for a worker whose conversation is no longer live', async () => {
    const h = await makeHarness();
    const spawned = await h.orchestrator.spawnBackgroundAgent(h.parentChatId, BRIEF('gone'));
    // Not added to `live` — already evicted by the provider.
    await h.eventBus.emit(`${spawned.taskId}-session`, { kind: 'harness.idle', data: {} });
    await tick(70);
    expect(h.destroyConversation).not.toHaveBeenCalled();
  });
});
