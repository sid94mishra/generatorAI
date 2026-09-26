// ────────────────────────────────────────────────────────────────
// OrchestratorService — G-20 background-task cancel attribution.
//
// DockTasks shows "Cancelled · by you at 14:09". Pinned here:
//   - the Tasks panel's cancel is `user`, the orchestrator-stop cascade is
//     `orchestrator`, Stop inside the worker chat (a bare `harness.cancelled`)
//     is `user`;
//   - the attribution rides on the parent's `chat.background_task.status` and
//     `…completed` events, the list and the stored row, and survives the
//     abort's own `harness.cancelled` / `harness.idle`;
//   - the first attribution wins; a follow-up turn clears it.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it, vi } from 'vitest';
import type { ChatManagementService } from '../src/services/ChatManagementService.js';
import { OrchestratorService, DEFAULT_ORCHESTRATOR_CONFIG } from '../src/services/orchestrator/OrchestratorService.js';
import { EventBus } from '../src/events/EventBus.js';
import { MockChatRepository } from './MockRepositories.js';
import type { ISessionRepository, IChatMessageRepository } from '../src/domain/ports/IRepositories.js';
import type { IAgentHarness } from '../src/domain/ports/IAgentHarness.js';
import type { AgentEvent, Chat, ChatMessage, Session, TaskBrief } from '@generatorai/shared';

const PARENT = 'parent-1';
const PARENT_SESSION = 'parent-1-session';
const BRIEF = (taskName: string): TaskBrief => ({ taskName, objective: 'test objective' }) as unknown as TaskBrief;
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

async function makeHarness() {
  const chatRepo = new MockChatRepository();
  const eventBus = new EventBus();
  await chatRepo.create({
    id: PARENT,
    name: 'Orchestrator',
    sessionId: PARENT_SESSION,
    status: 'active',
    orchestratorMode: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Chat);

  let counter = 0;
  // The worker chat is persisted, as the real ChatManagementService does, so
  // the stored attribution can be read back.
  const cms = {
    async createChat(opts: { name: string }) {
      counter += 1;
      const id = `worker-${counter}`;
      const chat = {
        id,
        sessionId: `${id}-session`,
        name: opts.name,
        status: 'active',
        tags: [],
        parentChatId: PARENT,
        backgroundTask: { orchestratorChatId: PARENT, taskName: opts.name, status: 'spawned' },
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as Chat;
      await chatRepo.create(chat);
      return chat;
    },
    sendPrompt: vi.fn(async () => {}),
    // A real abort makes the worker's provider report `cancelled` then `idle`.
    cancelTurn: vi.fn(async (chatId: string) => {
      await eventBus.emit(`${chatId}-session`, { kind: 'harness.cancelled', data: { reason: 'user_abort' } } as AgentEvent);
      await eventBus.emit(`${chatId}-session`, { kind: 'harness.idle', data: {} } as AgentEvent);
    }),
    getStreamingChatIds: () => [],
  } as unknown as ChatManagementService;

  const orchestrator = new OrchestratorService(
    chatRepo,
    {
      async getById(id: string) {
        return { id, status: 'active' } as Session;
      },
    } as unknown as ISessionRepository,
    {
      async getByChatId() {
        return [{ id: 'm', role: 'assistant', content: 'done', createdAt: new Date() } as ChatMessage];
      },
    } as unknown as IChatMessageRepository,
    { getModels: async () => [], hasLiveConversation: () => false, destroyConversation: async () => {} } as unknown as IAgentHarness,
    eventBus,
    { ...DEFAULT_ORCHESTRATOR_CONFIG, defaultWorkerModel: 'test-model', warmFirst: false, workerReleaseGraceMs: 5 },
  );
  orchestrator.setChatManagementService(cms);

  const parentEvents: AgentEvent[] = [];
  eventBus.subscribe(PARENT_SESSION, (e) => parentEvents.push(e as unknown as AgentEvent));
  const taskEvents = (kind: string, taskId: string) =>
    parentEvents.filter((e) => e.kind === kind && (e.data as { taskId?: string }).taskId === taskId).map((e) => e.data as Record<string, unknown>);

  return { orchestrator, chatRepo, eventBus, cms, taskEvents };
}

describe('G-20 cancel attribution', () => {
  it('a Tasks-panel cancel is the user’s, on the status event, the completion, the list and the row', async () => {
    const h = await makeHarness();
    const spawned = await h.orchestrator.spawnBackgroundAgent(PARENT, BRIEF('audit'));
    const taskId = spawned.taskId!;
    const before = Date.now();

    const result = await h.orchestrator.cancelBackgroundAgent(taskId, 'user');
    await tick();

    expect(result?.cancelledBy).toBe('user');
    expect(result!.cancelledAt).toBeGreaterThanOrEqual(before);
    expect(h.taskEvents('chat.background_task.status', taskId).at(-1)).toMatchObject({
      status: 'cancelled',
      cancelledBy: 'user',
      cancelledAt: result!.cancelledAt,
    });
    // The abort's own harness.cancelled + idle keep the attribution.
    expect(h.taskEvents('chat.background_task.completed', taskId).at(-1)).toMatchObject({
      status: 'cancelled',
      cancelledBy: 'user',
      cancelledAt: result!.cancelledAt,
    });
    const [row] = await h.orchestrator.listBackgroundAgents(PARENT);
    expect(row).toMatchObject({ taskId, status: 'cancelled', cancelledBy: 'user', cancelledAt: result!.cancelledAt });
    expect((await h.chatRepo.getById(taskId)).backgroundTask).toMatchObject({
      status: 'cancelled',
      cancelledBy: 'user',
      cancelledAt: result!.cancelledAt,
    });
  });

  it('stopping the orchestrator attributes its running workers to the orchestrator', async () => {
    const h = await makeHarness();
    const a = (await h.orchestrator.spawnBackgroundAgent(PARENT, BRIEF('a'))).taskId!;
    const b = (await h.orchestrator.spawnBackgroundAgent(PARENT, BRIEF('b'))).taskId!;

    const stopped = await h.orchestrator.cancelWorkersForParent(PARENT, 'orchestrator stopped');
    await tick();

    expect(stopped).toEqual([a, b]);
    for (const id of [a, b]) {
      expect(h.taskEvents('chat.background_task.completed', id).at(-1)).toMatchObject({
        status: 'cancelled',
        cancelledBy: 'orchestrator',
      });
      expect((await h.chatRepo.getById(id)).backgroundTask?.cancelledBy).toBe('orchestrator');
    }
  });

  it('Stop pressed inside the worker chat is the user’s', async () => {
    const h = await makeHarness();
    const taskId = (await h.orchestrator.spawnBackgroundAgent(PARENT, BRIEF('w'))).taskId!;
    await h.eventBus.emit(`${taskId}-session`, { kind: 'harness.cancelled', data: { reason: 'user_abort' } } as AgentEvent);
    await h.eventBus.emit(`${taskId}-session`, { kind: 'harness.idle', data: {} } as AgentEvent);
    await tick();
    expect(h.taskEvents('chat.background_task.completed', taskId).at(-1)).toMatchObject({
      status: 'cancelled',
      cancelledBy: 'user',
    });
  });

  it('keeps the first attribution; a follow-up turn clears it', async () => {
    const h = await makeHarness();
    const taskId = (await h.orchestrator.spawnBackgroundAgent(PARENT, BRIEF('w'))).taskId!;
    const first = await h.orchestrator.cancelBackgroundAgent(taskId, 'user');
    const again = await h.orchestrator.cancelBackgroundAgent(taskId, 'orchestrator');
    expect(again).toEqual(first);
    // Only one status event for the change to cancelled.
    expect(h.taskEvents('chat.background_task.status', taskId).filter((d) => d['status'] === 'cancelled')).toHaveLength(1);

    await h.orchestrator.sendToBackgroundAgent(taskId, 'try again');
    const running = h.taskEvents('chat.background_task.status', taskId).at(-1)!;
    expect(running).toMatchObject({ status: 'running' });
    expect(running).not.toHaveProperty('cancelledBy');
    const [row] = await h.orchestrator.listBackgroundAgents(PARENT);
    expect(row).not.toHaveProperty('cancelledBy');
    expect((await h.chatRepo.getById(taskId)).backgroundTask).not.toHaveProperty('cancelledBy');

    // The follow-up finishing normally is not a cancellation any more.
    await h.eventBus.emit(`${taskId}-session`, { kind: 'harness.idle', data: {} } as AgentEvent);
    await tick();
    expect(h.taskEvents('chat.background_task.completed', taskId).at(-1)).toMatchObject({ status: 'needs_review' });
  });

  it('returns null for an unknown task', async () => {
    const h = await makeHarness();
    expect(await h.orchestrator.cancelBackgroundAgent('nope', 'user')).toBeNull();
  });
});
