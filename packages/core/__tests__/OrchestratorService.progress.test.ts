// ────────────────────────────────────────────────────────────────
// OrchestratorService — live worker progress on the PARENT chat scope.
//
// A background worker is a separate chat with a separate session, so the
// orchestrator's own stream carried nothing between "spawned" and
// "completed" — minutes of silence in the transcript while several workers
// were doing real work. `chat.background_task.progress` is what fills that
// gap, and it is throttled because a worker streaming tokens would otherwise
// put hundreds of events a second onto the parent's SSE connection.
//
// Run against the code without the throttle, the "at most one per window"
// test fails with one event per token — the predicted reason.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it, vi } from 'vitest';
import type { ChatManagementService } from '../src/services/ChatManagementService.js';
import {
  OrchestratorService,
  DEFAULT_ORCHESTRATOR_CONFIG,
  type OrchestratorConfig,
} from '../src/services/orchestrator/OrchestratorService.js';
import { EventBus } from '../src/events/EventBus.js';
import { MockChatRepository } from './MockRepositories.js';
import type { ISessionRepository, IChatMessageRepository } from '../src/domain/ports/IRepositories.js';
import type { IAgentHarness } from '../src/domain/ports/IAgentHarness.js';
import type { AgentEvent, Chat, ChatMessage, Session, TaskBrief } from '@generatorai/shared';

type ProgressEvent = Extract<AgentEvent, { kind: 'chat.background_task.progress' }>;

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
      return [{ id: 'm', role: 'assistant', content: 'done', createdAt: new Date() } as ChatMessage];
    },
    async countByChatId() { return 0; },
    async deleteBySession() {},
  };
}

function fakeChatManagementService(): ChatManagementService {
  let counter = 0;
  return {
    async createChat(opts: { name: string }) {
      counter += 1;
      const id = `worker-${counter}`;
      return { id, sessionId: `${id}-session`, name: opts.name } as unknown as Chat;
    },
    sendPrompt: vi.fn(async () => {}),
    async cancelTurn() {},
  } as unknown as ChatManagementService;
}

const BRIEF = (taskName: string): TaskBrief => ({ taskName, objective: 'test objective' } as unknown as TaskBrief);
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function makeHarness(config: Partial<OrchestratorConfig> = {}) {
  const chatRepo = new MockChatRepository();
  const eventBus = new EventBus();
  const parentChatId = 'parent-1';
  const parentSessionId = 'parent-1-session';
  await chatRepo.create({
    id: parentChatId,
    name: 'Orchestrator',
    sessionId: parentSessionId,
    status: 'active',
    orchestratorMode: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Chat);

  const harness = {
    getModels: async () => [],
    hasLiveConversation: () => false,
    destroyConversation: async () => {},
  } as unknown as IAgentHarness;

  const orchestrator = new OrchestratorService(
    chatRepo,
    fakeSessionRepo(),
    fakeMessageRepo(),
    harness,
    eventBus,
    {
      ...DEFAULT_ORCHESTRATOR_CONFIG,
      defaultWorkerModel: 'test-model',
      warmFirst: false,
      workerReleaseGraceMs: 5,
      ...config,
    },
  );
  orchestrator.setChatManagementService(fakeChatManagementService());

  // Everything the PARENT would see on its own stream.
  const seen: AgentEvent[] = [];
  eventBus.subscribe(parentSessionId, (e) => { seen.push(e as AgentEvent); }, 'test-parent-watch');

  const progress = (): ProgressEvent[] =>
    seen.filter((e): e is ProgressEvent => e.kind === 'chat.background_task.progress');

  return { orchestrator, eventBus, parentChatId, seen, progress };
}

describe('OrchestratorService — chat.background_task.progress', () => {
  it('emits on the parent scope with the worker’s current tool, count and start time', async () => {
    const h = await makeHarness();
    const spawned = await h.orchestrator.spawnBackgroundAgent(h.parentChatId, BRIEF('research'));
    const workerSession = `${spawned.taskId}-session`;

    await h.eventBus.emit(workerSession, {
      kind: 'harness.tool_start',
      data: { tool: 'Bash', args: {}, callId: 'c1' },
    });

    const events = h.progress();
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toMatchObject({
      chatId: h.parentChatId,
      parentChatId: h.parentChatId,
      taskId: spawned.taskId,
      taskName: 'research',
      status: 'running',
      currentStep: 'Bash',
      toolCalls: 1,
    });
    expect(events[0]!.data.startedAt).toBeGreaterThan(0);
  });

  it('reports thinking and writing from reasoning deltas and tokens', async () => {
    const h = await makeHarness();
    const spawned = await h.orchestrator.spawnBackgroundAgent(h.parentChatId, BRIEF('think'));
    const workerSession = `${spawned.taskId}-session`;

    await h.eventBus.emit(workerSession, { kind: 'harness.reasoning_delta', data: { text: 'hmm' } });
    expect(h.progress().at(-1)!.data.currentStep).toBe('thinking');

    // Past the throttle window so the next delta is admitted.
    await tick(520);
    await h.eventBus.emit(workerSession, { kind: 'harness.token', data: { text: 'hello' } });
    expect(h.progress().at(-1)!.data.currentStep).toBe('writing');
  });

  it('throttles token traffic to at most one event per window', async () => {
    const h = await makeHarness();
    const spawned = await h.orchestrator.spawnBackgroundAgent(h.parentChatId, BRIEF('chatty'));
    const workerSession = `${spawned.taskId}-session`;

    for (let i = 0; i < 50; i += 1) {
      await h.eventBus.emit(workerSession, { kind: 'harness.token', data: { text: 'x' } });
    }
    // 50 tokens inside one 500 ms window is one event, not fifty.
    expect(h.progress()).toHaveLength(1);
  });

  it('never throttles a tool start — it is the most informative thing a worker does', async () => {
    const h = await makeHarness();
    const spawned = await h.orchestrator.spawnBackgroundAgent(h.parentChatId, BRIEF('busy'));
    const workerSession = `${spawned.taskId}-session`;

    for (const tool of ['Read', 'Grep', 'Bash']) {
      await h.eventBus.emit(workerSession, { kind: 'harness.tool_start', data: { tool, args: {}, callId: tool } });
    }
    const events = h.progress();
    expect(events.map((e) => e.data.currentStep)).toEqual(['Read', 'Grep', 'Bash']);
    expect(events.at(-1)!.data.toolCalls).toBe(3);
  });

  it('emits a final, unthrottled progress event on idle and clears the step line', async () => {
    const h = await makeHarness();
    const spawned = await h.orchestrator.spawnBackgroundAgent(h.parentChatId, BRIEF('final'));
    const workerSession = `${spawned.taskId}-session`;

    await h.eventBus.emit(workerSession, { kind: 'harness.token', data: { text: 'partial' } });
    const beforeIdle = h.progress().length;
    await h.eventBus.emit(workerSession, { kind: 'harness.idle', data: {} });

    const events = h.progress();
    // The idle emit is immediate even though the token one just fired.
    expect(events.length).toBe(beforeIdle + 1);
    const last = events.at(-1)!;
    expect(last.data.currentStep).toBeUndefined();
    expect(last.data.status).toBe('needs_review');
  });

  it('truncates the assistant text excerpt', async () => {
    const h = await makeHarness();
    const spawned = await h.orchestrator.spawnBackgroundAgent(h.parentChatId, BRIEF('verbose'));
    const workerSession = `${spawned.taskId}-session`;

    await h.eventBus.emit(workerSession, {
      kind: 'harness.message_complete',
      data: { content: 'A'.repeat(5_000) },
    });
    const text = h.progress().at(-1)!.data.lastText ?? '';
    expect(text.length).toBeLessThanOrEqual(240);
  });

  it('still emits spawned and completed alongside progress', async () => {
    const h = await makeHarness();
    const spawned = await h.orchestrator.spawnBackgroundAgent(h.parentChatId, BRIEF('lifecycle'));
    await h.eventBus.emit(`${spawned.taskId}-session`, { kind: 'harness.idle', data: {} });
    // The completion emit is fire-and-forget inside the idle handler.
    await tick(10);
    const kinds = h.seen.map((e) => e.kind);
    expect(kinds).toContain('chat.background_task.spawned');
    expect(kinds).toContain('chat.background_task.completed');
  });
});
