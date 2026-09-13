// ────────────────────────────────────────────────────────────────
// OrchestratorService — W24 termination guards (the arbiter).
//
// First-ever test coverage for `OrchestratorService` (confirmed zero prior
// tests during the review pass this file was written in). Covers the 3
// conditions the arbiter (`evaluateTermination`, private — exercised only
// through the public `spawnBackgroundAgent` API) is meant to combine:
//   1. Time budget
//   2. Wave cap
//   3. Convergence — previously undeliverable: `TaskResultDigestSchema` had
//      no `converged` field, so nothing a worker returned could ever satisfy
//      `convergenceThreshold`. This file also proves wave-state persistence
//      (migration v41) survives a simulated restart (a FRESH
//      `OrchestratorService` sharing only the chat repository).
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import type { ChatManagementService } from '../src/services/ChatManagementService.js';
import { OrchestratorService, DEFAULT_ORCHESTRATOR_CONFIG, type OrchestratorConfig } from '../src/services/orchestrator/OrchestratorService.js';
import { EventBus } from '../src/events/EventBus.js';
import { MockChatRepository } from './MockRepositories.js';
import type { ISessionRepository, IChatMessageRepository } from '../src/domain/ports/IRepositories.js';
import type { IAgentHarness } from '../src/domain/ports/IAgentHarness.js';
import type { Chat, ChatMessage, Session, TaskBrief } from '@generatorai/shared';

// ── Minimal fakes for the dependencies spawnBackgroundAgent touches ──

function fakeSessionRepo(): ISessionRepository {
  return {
    async create(s) { return s; },
    async getById(id) { return { id, status: 'active' } as Session; },
    async getAll() { return []; },
    async getByStatus() { return []; },
    async countByStatus() { return 0; },
    async getByOwner() { return []; },
    async update(id, u) { return { id, ...u } as Session; },
    async updateStatus() {},
    async delete() {},
  };
}

/** Assistant message carrying a <TASK_RESULT> digest, as a worker would end its turn. */
function digestMessage(json: Record<string, unknown>): ChatMessage {
  return {
    id: `msg-${Math.random()}`,
    role: 'assistant',
    content: `Done.\n<TASK_RESULT>\n${JSON.stringify(json)}\n</TASK_RESULT>`,
    createdAt: new Date(),
  } as ChatMessage;
}

/** messageRepo.getByChatId returns whatever digest this test registered for a taskId. */
function fakeMessageRepo(digestsByTaskId: Map<string, Record<string, unknown>>): IChatMessageRepository {
  return {
    async create(m) { return m; },
    async getBySessionId() { return []; },
    async getBySessionAndStageRunId() { return []; },
    async getByChatId(chatId) {
      const digest = digestsByTaskId.get(chatId);
      return digest ? [digestMessage(digest)] : [];
    },
    async countByChatId() { return 0; },
    async deleteBySession() {},
  };
}

/** Only `getModels()` could ever be called (skipped entirely when config.defaultWorkerModel is set). */
function fakeHarness(): IAgentHarness {
  return { getModels: async () => [] } as unknown as IAgentHarness;
}

/** Deterministic worker chatId/sessionId so tests can drive events without reaching into service internals. */
function fakeChatManagementService(): ChatManagementService {
  let counter = 0;
  return {
    async createChat(opts: { name: string }) {
      counter += 1;
      const id = `worker-${counter}`;
      return { id, sessionId: `${id}-session`, name: opts.name } as unknown as Chat;
    },
    async sendPrompt() { /* fire-and-forget in real code; no-op here */ },
    async cancelTurn() {},
  } as unknown as ChatManagementService;
}

interface Harness {
  orchestrator: OrchestratorService;
  chatRepo: MockChatRepository;
  eventBus: EventBus;
  digests: Map<string, Record<string, unknown>>;
  parentChatId: string;
}

async function makeHarness(config: Partial<OrchestratorConfig> = {}, chatRepo = new MockChatRepository()): Promise<Harness> {
  const eventBus = new EventBus();
  const digests = new Map<string, Record<string, unknown>>();
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

  const orchestrator = new OrchestratorService(
    chatRepo,
    fakeSessionRepo(),
    fakeMessageRepo(digests),
    fakeHarness(),
    eventBus,
    { ...DEFAULT_ORCHESTRATOR_CONFIG, defaultWorkerModel: 'test-model', warmFirst: false, ...config },
  );
  orchestrator.setChatManagementService(fakeChatManagementService());

  return { orchestrator, chatRepo, eventBus, digests, parentChatId };
}

const BRIEF = (taskName: string): TaskBrief => ({ taskName, objective: 'test objective' } as unknown as TaskBrief);

/** Spawn a worker, feed it a digest, and drive it to idle so wave bookkeeping settles. */
async function spawnAndFinish(h: Harness, taskName: string, digest: Record<string, unknown>) {
  const result = await h.orchestrator.spawnBackgroundAgent(h.parentChatId, BRIEF(taskName));
  expect(result.ok).toBe(true);
  const taskId = result.taskId!;
  h.digests.set(taskId, digest);
  await h.eventBus.emit(`${taskId}-session`, { kind: 'harness.idle', data: {} });
  // onWorkerEvent's idle handling does a couple of fire-and-forget awaits
  // (updateBackgroundTaskStatus, writeScratchpad, emitToParent) — yield once.
  await new Promise((r) => setTimeout(r, 10));
  return taskId;
}

describe('OrchestratorService — W24 termination guards (the arbiter)', () => {
  it('allows the first spawn even with convergenceThreshold=1 (nothing to converge on yet)', async () => {
    const h = await makeHarness({ convergenceThreshold: 1.0 });
    const result = await h.orchestrator.spawnBackgroundAgent(h.parentChatId, BRIEF('task-1'));
    expect(result.ok).toBe(true);
  });

  it('convergence: refuses a second wave once every worker in the current wave reports converged:true', async () => {
    const h = await makeHarness({ convergenceThreshold: 1.0 });
    await spawnAndFinish(h, 'task-1', { status: 'completed', converged: true });

    const second = await h.orchestrator.spawnBackgroundAgent(h.parentChatId, BRIEF('task-2'));
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/Convergence threshold met/);
  });

  it('convergence: status:"completed" alone does NOT count — a second wave stays reachable under the shipped default', async () => {
    // The defect this replaces: the guard also counted any worker whose digest
    // merely PARSED as `completed`, which `buildDigest` returns for every
    // worker that is not running or failed. Under the shipped default of 1.0
    // that fired the moment wave 1 stopped running, so a second wave was
    // structurally unreachable and `maxWaves` / `timeBudgetMs` were config no
    // orchestration could ever reach. Convergence is a claim the worker makes.
    const h = await makeHarness({ convergenceThreshold: 1.0 });
    await spawnAndFinish(h, 'task-1', { status: 'completed' }); // no `converged` field at all

    const second = await h.orchestrator.spawnBackgroundAgent(h.parentChatId, BRIEF('task-2'));
    expect(second.ok).toBe(true);
  });

  it('convergence: a cancelled worker never counts as converged, even with converged:true in its digest', async () => {
    // `buildDigest` maps a cancelled worker to status `completed`, so the old
    // rule counted a cancelled wave as a converged one and terminated the
    // whole orchestration on it.
    const h = await makeHarness({ convergenceThreshold: 1.0 });
    const first = await h.orchestrator.spawnBackgroundAgent(h.parentChatId, BRIEF('task-1'));
    h.digests.set(first.taskId!, { status: 'completed', converged: true });
    await h.orchestrator.cancelBackgroundAgent(first.taskId!);

    const second = await h.orchestrator.spawnBackgroundAgent(h.parentChatId, BRIEF('task-2'));
    expect(second.ok).toBe(true);
  });

  it('convergence is scoped to the CURRENT wave, not every worker ever spawned', async () => {
    const h = await makeHarness({ convergenceThreshold: 1.0, maxWaves: 5 });
    // Wave 1: two workers, neither converged — so wave 2 is allowed.
    const w1a = await h.orchestrator.spawnBackgroundAgent(h.parentChatId, BRIEF('w1a'));
    const w1b = await h.orchestrator.spawnBackgroundAgent(h.parentChatId, BRIEF('w1b'));
    h.digests.set(w1a.taskId!, { status: 'partial', converged: false });
    h.digests.set(w1b.taskId!, { status: 'partial', converged: false });
    await h.eventBus.emit(`${w1a.taskId}-session`, { kind: 'harness.idle', data: {} });
    await h.eventBus.emit(`${w1b.taskId}-session`, { kind: 'harness.idle', data: {} });
    await new Promise((r) => setTimeout(r, 10));

    // Wave 2: one worker, converged.
    const w2 = await h.orchestrator.spawnBackgroundAgent(h.parentChatId, BRIEF('w2'));
    expect(w2.ok).toBe(true);
    h.digests.set(w2.taskId!, { status: 'completed', converged: true });
    await h.eventBus.emit(`${w2.taskId}-session`, { kind: 'harness.idle', data: {} });
    await new Promise((r) => setTimeout(r, 10));

    // Current wave (2) is 1/1 converged → stop. Computed over ALL workers it
    // would be 1/3 and a third wave would be allowed.
    const w3 = await h.orchestrator.spawnBackgroundAgent(h.parentChatId, BRIEF('w3'));
    expect(w3.ok).toBe(false);
    expect(w3.error).toMatch(/wave 2 converged/);
  });

  it('wave counting is independent of warmFirst — parallel spawns are ONE wave', async () => {
    // The wave counter used the presence of `waveWarmup` as its "new wave"
    // signal, and that map is only populated when `warmFirst` is on. With
    // `warmFirst: false` every individual spawn counted as a wave, so
    // `maxWaves` silently became a worker cap N times tighter than configured.
    const h = await makeHarness({ maxWaves: 2, convergenceThreshold: 0, warmFirst: false });
    for (const name of ['a', 'b', 'c']) {
      const result = await h.orchestrator.spawnBackgroundAgent(h.parentChatId, BRIEF(name));
      expect(result.ok).toBe(true); // all three join wave 1
    }
  });

  it('convergence: does NOT block the next wave when a worker reports converged:false / still partial', async () => {
    const h = await makeHarness({ convergenceThreshold: 1.0 });
    await spawnAndFinish(h, 'task-1', { status: 'partial', converged: false });

    const second = await h.orchestrator.spawnBackgroundAgent(h.parentChatId, BRIEF('task-2'));
    expect(second.ok).toBe(true);
  });

  it('convergence: a threshold below 1.0 tolerates some non-converged workers', async () => {
    const h = await makeHarness({ convergenceThreshold: 0.5 });
    // Both spawned in the SAME wave (before either finishes) — a threshold
    // check runs on every spawn attempt, so spawning them one-at-a-time with
    // task-1 already converged would trip the gate before task-2 could ever
    // be created.
    const first = await h.orchestrator.spawnBackgroundAgent(h.parentChatId, BRIEF('task-1'));
    const second = await h.orchestrator.spawnBackgroundAgent(h.parentChatId, BRIEF('task-2'));
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    h.digests.set(first.taskId!, { status: 'completed', converged: true });
    h.digests.set(second.taskId!, { status: 'partial', converged: false });
    await h.eventBus.emit(`${first.taskId}-session`, { kind: 'harness.idle', data: {} });
    await h.eventBus.emit(`${second.taskId}-session`, { kind: 'harness.idle', data: {} });
    await new Promise((r) => setTimeout(r, 10));

    // 1/2 = 0.5 → meets a 0.5 threshold.
    const third = await h.orchestrator.spawnBackgroundAgent(h.parentChatId, BRIEF('task-3'));
    expect(third.ok).toBe(false);
    expect(third.error).toMatch(/Convergence threshold met/);
  });

  it('convergenceThreshold=0 disables the convergence guard entirely', async () => {
    const h = await makeHarness({ convergenceThreshold: 0 });
    await spawnAndFinish(h, 'task-1', { status: 'completed', converged: true });
    const second = await h.orchestrator.spawnBackgroundAgent(h.parentChatId, BRIEF('task-2'));
    expect(second.ok).toBe(true);
  });

  it('time budget: refuses a spawn once the wall-clock budget is exhausted', async () => {
    const h = await makeHarness({ timeBudgetMs: 10, convergenceThreshold: 0 });
    await h.orchestrator.spawnBackgroundAgent(h.parentChatId, BRIEF('task-1')); // starts the clock
    await new Promise((r) => setTimeout(r, 30));
    const second = await h.orchestrator.spawnBackgroundAgent(h.parentChatId, BRIEF('task-2'));
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/Time budget exhausted/);
  });

  it('wave cap: refuses a new wave once maxWaves is reached', async () => {
    const h = await makeHarness({ maxWaves: 1, convergenceThreshold: 0 });
    await spawnAndFinish(h, 'task-1', { status: 'completed' }); // wave 1

    const second = await h.orchestrator.spawnBackgroundAgent(h.parentChatId, BRIEF('task-2'));
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/Wave limit reached/);
  });

  it('W24 — wave state persists to the DB and survives a simulated restart (fresh service instance)', async () => {
    const chatRepo = new MockChatRepository();
    const h = await makeHarness({ maxWaves: 5, convergenceThreshold: 0 }, chatRepo);
    await spawnAndFinish(h, 'task-1', { status: 'completed' }); // wave 1

    const persisted = await chatRepo.getOrchestratorWaveState(h.parentChatId);
    expect(persisted).not.toBeNull();
    expect(persisted!.waveCount).toBe(1);

    // "Restart": a brand-new OrchestratorService sharing only the DB (chatRepo).
    const eventBus2 = new EventBus();
    const digests2 = new Map<string, Record<string, unknown>>();
    const restarted = new OrchestratorService(
      chatRepo,
      fakeSessionRepo(),
      fakeMessageRepo(digests2),
      fakeHarness(),
      eventBus2,
      { ...DEFAULT_ORCHESTRATOR_CONFIG, defaultWorkerModel: 'test-model', warmFirst: false, maxWaves: 1, convergenceThreshold: 0 },
    );
    restarted.setChatManagementService(fakeChatManagementService());

    // maxWaves=1 and wave 1 already happened (per the DB) — the restarted
    // instance must refuse a new wave, proving it rehydrated waveCount=1
    // from the DB rather than starting fresh at 0.
    const afterRestart = await restarted.spawnBackgroundAgent(h.parentChatId, BRIEF('task-2'));
    expect(afterRestart.ok).toBe(false);
    expect(afterRestart.error).toMatch(/Wave limit reached/);
  });

  it('a NEW user request on the same chat starts a fresh budget: convergence, wave cap and clock reset once the orchestrator has answered', async () => {
    const chatRepo = new MockChatRepository();
    const h = await makeHarness({ maxWaves: 1, convergenceThreshold: 1 }, chatRepo);
    await spawnAndFinish(h, 'task-1', { status: 'completed', converged: true }); // wave 1, converged
    // Same request: both the wave cap and convergence refuse a second wave.
    const sameRequest = await h.orchestrator.spawnBackgroundAgent(h.parentChatId, BRIEF('task-2'));
    expect(sameRequest.ok).toBe(false);

    // The orchestrator finishes its turn → the request is over.
    await h.eventBus.emit('parent-1-session', { kind: 'harness.idle', data: {} } as never);
    await new Promise((r) => setTimeout(r, 20));
    expect(await chatRepo.getOrchestratorWaveState(h.parentChatId)).toBeNull();

    // The user's next request may spawn again, and it is wave 1 of a new budget.
    const nextRequest = await h.orchestrator.spawnBackgroundAgent(h.parentChatId, BRIEF('task-3'));
    expect(nextRequest.ok).toBe(true);
    expect((await chatRepo.getOrchestratorWaveState(h.parentChatId))?.waveCount).toBe(1);
  });

  it('the worker cap counts CONCURRENT workers, not every worker the chat ever had', async () => {
    const chatRepo = new MockChatRepository();
    const h = await makeHarness({ maxWorkers: 2, convergenceThreshold: 0, maxWaves: 10 }, chatRepo);
    await spawnAndFinish(h, 'task-1', { status: 'completed' });
    await spawnAndFinish(h, 'task-2', { status: 'completed' });
    // Two finished workers are on the record; a third may still start.
    const third = await h.orchestrator.spawnBackgroundAgent(h.parentChatId, BRIEF('task-3'));
    expect(third.ok).toBe(true);
    // task-3 is running: with a cap of 2 a fourth running one is fine, a fifth is not.
    const fourth = await h.orchestrator.spawnBackgroundAgent(h.parentChatId, BRIEF('task-4'));
    expect(fourth.ok).toBe(true);
    const fifth = await h.orchestrator.spawnBackgroundAgent(h.parentChatId, BRIEF('task-5'));
    expect(fifth.ok).toBe(false);
    expect(fifth.error).toMatch(/Worker limit reached/);
  });

  it('cancelWorkersForParent stops every running worker and does not re-prompt the orchestrator', async () => {
    const h = await makeHarness({ convergenceThreshold: 0 });
    const a = await h.orchestrator.spawnBackgroundAgent(h.parentChatId, BRIEF('task-a'));
    const b = await h.orchestrator.spawnBackgroundAgent(h.parentChatId, BRIEF('task-b'));
    expect(a.ok && b.ok).toBe(true);
    const stopped = await h.orchestrator.cancelWorkersForParent(h.parentChatId, 'orchestrator stopped');
    expect(stopped.sort()).toEqual([a.taskId, b.taskId].sort());
    const list = await h.orchestrator.listBackgroundAgents(h.parentChatId);
    expect(list.map((t) => t.status)).toEqual(['cancelled', 'cancelled']);
    // The workers' own idle events arrive afterwards; the orchestrator must not be nudged.
    const sent: string[] = [];
    (h.orchestrator as unknown as { chatManagementService: { sendPrompt: (id: string, p: string) => Promise<void> } }).chatManagementService.sendPrompt =
      async (_id: string, p: string) => { sent.push(p); };
    await h.eventBus.emit(`${a.taskId}-session`, { kind: 'harness.cancelled', data: { reason: 'user_abort' } });
    await h.eventBus.emit(`${a.taskId}-session`, { kind: 'harness.idle', data: {} });
    await h.eventBus.emit(`${b.taskId}-session`, { kind: 'harness.cancelled', data: { reason: 'user_abort' } });
    await h.eventBus.emit(`${b.taskId}-session`, { kind: 'harness.idle', data: {} });
    // The nudge is deferred 2 s after the last worker settles; outwait it.
    await new Promise((r) => setTimeout(r, 2_300));
    expect(sent).toHaveLength(0);
  }, 10_000);

  it('a stopped worker that idles twice releases its wave slot once, so the wave waits for the others', async () => {
    const h = await makeHarness({ convergenceThreshold: 0 });
    const a = await h.orchestrator.spawnBackgroundAgent(h.parentChatId, BRIEF('task-a'));
    const b = await h.orchestrator.spawnBackgroundAgent(h.parentChatId, BRIEF('task-b'));
    expect(a.ok && b.ok).toBe(true);
    const sent: string[] = [];
    (h.orchestrator as unknown as { chatManagementService: { sendPrompt: (id: string, p: string) => Promise<void> } }).chatManagementService.sendPrompt =
      async (_id: string, p: string) => { sent.push(p); };
    // Cancel ONE worker from the panel: the provider's cancelled+idle, then
    // the chat service's own idle for the same turn.
    await h.orchestrator.cancelBackgroundAgent(a.taskId);
    await h.eventBus.emit(`${a.taskId}-session`, { kind: 'harness.cancelled', data: { reason: 'user_abort' } });
    await h.eventBus.emit(`${a.taskId}-session`, { kind: 'harness.idle', data: {} });
    await h.eventBus.emit(`${a.taskId}-session`, { kind: 'harness.idle', data: {} });
    await new Promise((r) => setTimeout(r, 2_300));
    expect(sent).toHaveLength(0);
    // The other worker finishing is what settles the wave.
    await h.eventBus.emit(`${b.taskId}-session`, { kind: 'harness.message_complete', data: { content: '<TASK_RESULT>{"summary":"done"}</TASK_RESULT>' } });
    await h.eventBus.emit(`${b.taskId}-session`, { kind: 'harness.idle', data: {} });
    await new Promise((r) => setTimeout(r, 2_300));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/Every background agent in the current wave has finished/);
  }, 15_000);

  it('a worker the DB still calls running after a restart is reported failed, not running forever', async () => {
    const chatRepo = new MockChatRepository();
    await chatRepo.create({
      id: 'parent-x', name: 'Orchestrator', sessionId: 'parent-x-session', status: 'active', orchestratorMode: true,
      createdAt: new Date(), updatedAt: new Date(),
    } as unknown as Chat);
    await chatRepo.create({
      id: 'worker-stale', name: 'stale', sessionId: 'worker-stale-session', status: 'active', parentChatId: 'parent-x',
      backgroundTask: { orchestratorChatId: 'parent-x', taskName: 'stale', status: 'running' },
      createdAt: new Date(), updatedAt: new Date(),
    } as unknown as Chat);
    const fresh = new OrchestratorService(
      chatRepo, fakeSessionRepo(), fakeMessageRepo(new Map()), fakeHarness(), new EventBus(),
      { ...DEFAULT_ORCHESTRATOR_CONFIG, defaultWorkerModel: 'test-model', warmFirst: false },
    );
    fresh.setChatManagementService(fakeChatManagementService());
    const list = await fresh.listBackgroundAgents('parent-x');
    expect(list).toEqual([expect.objectContaining({ taskId: 'worker-stale', status: 'failed' })]);
    expect((await chatRepo.getById('worker-stale')).backgroundTask?.status).toBe('failed');
  });

  it('disposeForParent clears the persisted wave state (archive path)', async () => {
    const chatRepo = new MockChatRepository();
    const h = await makeHarness({ convergenceThreshold: 0 }, chatRepo);
    await spawnAndFinish(h, 'task-1', { status: 'completed' });
    expect(await chatRepo.getOrchestratorWaveState(h.parentChatId)).not.toBeNull();

    h.orchestrator.disposeForParent(h.parentChatId);
    await new Promise((r) => setTimeout(r, 10)); // the DB clear is fire-and-forget

    expect(await chatRepo.getOrchestratorWaveState(h.parentChatId)).toBeNull();
  });
});
