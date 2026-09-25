// ────────────────────────────────────────────────────────────────
// StageExecutionService — step timeout defaults, timer cleanup, abort
// signal threading, and the liveness heartbeat (WS-D1 / FEAT-3 hardening).
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StageExecutionService } from '../src/services/StageExecutionService.js';
import { RunDefinitionReader } from '../src/services/definitions/RunDefinitionReader.js';
import {
  MockStageRunRepository,
  MockWorkflowDefinitionStore,
  MockWorkflowRunRepository,
  createFakeWorkspaceManager,
  createTestComposer,
  seedDefinition,
  testGraph,
} from './MockRepositories.js';
import type { HitlService } from '../src/services/HitlService.js';
import { MockCopilotPort } from './MockAgentHarness.js';
import { EventBus } from '../src/events/EventBus.js';
import type { IChatMessageRepository } from '../src/domain/ports/IRepositories.js';
import type { SessionAllocator } from '../src/services/SessionAllocator.js';
import type { HookExecutor } from '../src/services/HookExecutor.js';
import type { StageRun, ChatMessage, Session } from '@generatorai/shared';

// ── Helpers (mirrors StageExecutionService.test.ts) ──

function createMockMessageRepo(): IChatMessageRepository {
  const messages: ChatMessage[] = [];
  return {
    create: vi.fn(async (msg: ChatMessage) => { messages.push({ ...msg }); return { ...msg }; }),
    getBySessionId: vi.fn(async () => messages),
    getBySessionAndStageRunId: vi.fn(async () => messages),
    getByChatId: vi.fn(async () => []),
    deleteBySession: vi.fn(async () => {}),
  } as unknown as IChatMessageRepository;
}

function createMockSessionAllocator(): SessionAllocator {
  const fakeSession: Session = {
    id: 'ses-1',
    name: 'Mock Session',
    status: 'running',
    conversationId: 'conv-1',
    tags: [],
    requiresCodebase: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return {
    allocateSession: vi.fn(async (_run: string, _stage: string, _mode: string, build: (id: { sessionId: string; conversationId: string; op: 'create' }) => Promise<unknown>) => {
      await build({ sessionId: fakeSession.id, conversationId: fakeSession.conversationId!, op: 'create' });
      return fakeSession;
    }),
    releaseSession: vi.fn(async () => {}),
    rememberProviderSession: vi.fn(async () => {}),
    releaseAll: vi.fn(async () => {}),
    getSessionById: vi.fn(async () => fakeSession),
  } as unknown as SessionAllocator;
}

function createMockHookExecutor(): HookExecutor {
  return {
    executePhase: vi.fn(async () => ({ shouldContinue: true, mergedResult: {} })),
  } as unknown as HookExecutor;
}

function makeStageRun(
  id: string,
  stageKey: string,
  status: StageRun['status'] = 'pending',
): StageRun {
  return {
    id,
    workflowRunId: 'run-1',
    stageKey,
    name: `SR ${stageKey}`,
    status,
    currentStep: 0,
    totalSteps: 1,
    retryCount: 0,
    version: 0,
    createdAt: new Date(),
  };
}

/** A retry policy with no retries: a failure is immediate and terminal. */
const NO_RETRY = { maxAttempts: 1, initialDelayMs: 0, backoffMultiplier: 1 };

describe('StageExecutionService — step timeouts, abort signal, and heartbeat', () => {
  let service: StageExecutionService;
  let stageRunRepo: MockStageRunRepository;
  let definitionStore: MockWorkflowDefinitionStore;
  let runRepo: MockWorkflowRunRepository;
  let messageRepo: ReturnType<typeof createMockMessageRepo>;
  let copilot: MockCopilotPort;
  let eventBus: EventBus;
  let sessionAllocator: ReturnType<typeof createMockSessionAllocator>;
  let hookExecutor: ReturnType<typeof createMockHookExecutor>;

  beforeEach(() => {
    stageRunRepo = new MockStageRunRepository();
    definitionStore = new MockWorkflowDefinitionStore();
    runRepo = new MockWorkflowRunRepository(stageRunRepo);
    messageRepo = createMockMessageRepo();
    copilot = new MockCopilotPort();
    eventBus = new EventBus();
    sessionAllocator = createMockSessionAllocator();
    hookExecutor = createMockHookExecutor();

    service = new StageExecutionService(
      stageRunRepo,
      new RunDefinitionReader(definitionStore),
      messageRepo,
      copilot,
      eventBus,
      sessionAllocator,
      hookExecutor,
      createFakeWorkspaceManager(),
      runRepo,
      {} as HitlService,
      createTestComposer(copilot),
    );
  });

  /** Publish a one-stage definition and pin run 'run-1' to it. */
  async function seedStage(key: string, extra: Record<string, unknown> = {}): Promise<void> {
    const graph = testGraph([{ key, prompts: [{ label: 'P1', text: 'Go' }], ...extra }]);
    const { definitionId, versionId } = await seedDefinition(definitionStore, graph);
    const now = new Date();
    await runRepo.create({
      id: 'run-1', workflowDefinitionId: definitionId, definitionVersionId: versionId, name: 'Run',
      status: 'running', sessionMode: 'single', variables: {}, createdAt: now, updatedAt: now,
    });
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── task 1: default timeout ──

  it('applies the documented default timeout when the stage sets none', async () => {
    vi.useFakeTimers();
    service.setDefaultStageTimeoutMs(50);

    // No retry so the failure is immediate and terminal — isolates the
    // assertion to "did the default timeout fire" rather than retry timing.
    await seedStage('sd_default', { retry: NO_RETRY });
    const sr = makeStageRun('sr-default', 'sd_default');
    await stageRunRepo.create(sr);

    // Never resolves on its own — only a timeout (or an abort) settles it.
    copilot.sendPromptAndWait = vi.fn(() => new Promise(() => {}));

    const p = service.executeStage(sr, 'run-1', 'single');
    await vi.advanceTimersByTimeAsync(60);
    await p;

    const updated = await stageRunRepo.getById('sr-default');
    expect(updated.status).toBe('failed');
    expect(updated.error).toContain('timed out after 50ms');
  });

  // ── task 2: timer cleared on success ──

  it('clears the timeout timer once a timed step succeeds', async () => {
    vi.useFakeTimers();
    // single session mode: skips the unrelated releaseSessionSafe() timer
    // (a separate, pre-existing fire-and-forget 10s race) so the pending
    // timer count reflects only what withStageTimeout/startHeartbeat set.
    await seedStage('sd_clear', { timeouts: { attemptMs: 5_000 } });
    const sr = makeStageRun('sr-clear', 'sd_clear');
    await stageRunRepo.create(sr);

    await service.executeStage(sr, 'run-1', 'single');

    const updated = await stageRunRepo.getById('sr-clear');
    expect(updated.status).toBe('completed');
    // No timer (timeout deadline or heartbeat interval) should still be
    // pending once the stage has finished successfully.
    expect(vi.getTimerCount()).toBe(0);
  });

  // ── task 3: timeout actually aborts the underlying call ──

  it('aborts the underlying harness call when the deadline fires', async () => {
    vi.useFakeTimers();
    // Use the DEFAULT timeout path (no explicit `timeouts.attemptMs`) rather
    // than an explicit one: an explicit `attemptMs` is floored at MIN_TIMEOUT_MS
    // (1000ms), so a small explicit value here would silently become 1000ms
    // and this test would need to advance ~1s instead of exercising the
    // fast path.
    service.setDefaultStageTimeoutMs(50);
    await seedStage('sd_abort', { retry: NO_RETRY });
    const sr = makeStageRun('sr-abort', 'sd_abort');
    await stageRunRepo.create(sr);

    let capturedSignal: AbortSignal | undefined;
    copilot.sendPromptAndWait = vi.fn((
      _conversationId: string,
      _prompt: string,
      _attachments?: unknown,
      signal?: AbortSignal,
    ) => {
      capturedSignal = signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted by signal')));
      });
    });

    const p = service.executeStage(sr, 'run-1', 'single');
    await vi.advanceTimersByTimeAsync(60);
    await p;

    // The proof that matters for task 3: the underlying call was actually
    // told to stop, not merely abandoned.
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(true);
    const updated = await stageRunRepo.getById('sr-abort');
    expect(updated.status).toBe('failed');
    // `abort()` fires its listeners synchronously, before the deadline's own
    // `reject(HarnessTimeoutError)` runs — so the harness call's own
    // abort-triggered rejection typically wins the `Promise.race` over the
    // timeout error itself. Either is proof the deadline fired.
    expect(updated.error).toMatch(/timed out after 50ms|aborted by signal/);
  });

  // ── task 4 (write side): heartbeat beats while running, stops after ──

  it('beats stage_runs.heartbeat_at roughly every heartbeatIntervalMs while running, and stops on completion', async () => {
    vi.useFakeTimers();
    service.setHeartbeatIntervalMs(10);

    await seedStage('sd_hb');
    const sr = makeStageRun('sr-hb', 'sd_hb');
    await stageRunRepo.create(sr);

    const heartbeatSpy = vi.spyOn(stageRunRepo, 'heartbeat');

    // Only the FIRST sendPromptAndWait call (the stage's own prompt) hangs;
    // every later call (output-retry / summary) resolves immediately so the
    // stage can complete once we release the first one.
    let releaseFirstCall: ((v: { content: string }) => void) | undefined;
    let callIndex = 0;
    copilot.sendPromptAndWait = vi.fn(() => {
      callIndex += 1;
      if (callIndex === 1) {
        return new Promise<{ content: string }>((resolve) => { releaseFirstCall = resolve; });
      }
      return Promise.resolve({ content: 'ok, done here' });
    });

    const p = service.executeStage(sr, 'run-1', 'single');

    // While the step is still in flight: the synchronous "beat once at
    // start" plus several 10ms interval ticks.
    await vi.advanceTimersByTimeAsync(35);
    expect(heartbeatSpy.mock.calls.length).toBeGreaterThanOrEqual(2);

    // Let the step (and the rest of the stage) finish. No further fake-timer
    // advancement is needed: everything left (message persistence, output
    // validation, summary, artifact writes) resolves via microtasks/real IO,
    // not via `setTimeout`, in single-session mode.
    releaseFirstCall?.({ content: 'ok, done here' });
    await p;

    const updated = await stageRunRepo.getById('sr-hb');
    expect(updated.status).toBe('completed');

    // The interval must be cleared — no further beats after completion.
    const callsAtCompletion = heartbeatSpy.mock.calls.length;
    await vi.advanceTimersByTimeAsync(50);
    expect(heartbeatSpy.mock.calls.length).toBe(callsAtCompletion);
  });

  // ── task 4 (write side): abortStage cancels the tracked in-flight turn ──

  it('abortStage cancels the tracked AbortController for a stuck stage', async () => {
    await seedStage('sd_reap', {
      timeouts: { attemptMs: 60_000 }, // long enough that only abortStage() ends the call
      retry: NO_RETRY,
    });
    const sr = makeStageRun('sr-reap', 'sd_reap');
    await stageRunRepo.create(sr);

    let capturedSignal: AbortSignal | undefined;
    copilot.sendPromptAndWait = vi.fn((
      _conversationId: string,
      _prompt: string,
      _attachments?: unknown,
      signal?: AbortSignal,
    ) => {
      capturedSignal = signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted by reaper')));
      });
    });

    const p = service.executeStage(sr, 'run-1', 'single');
    // Give executeStage a tick to reach the timed call and register the
    // AbortController before the reaper aborts it.
    await new Promise((r) => setTimeout(r, 10));
    expect(capturedSignal?.aborted).toBe(false);

    await service.abortStage('sr-reap', 'reconciler: heartbeat stale');

    await p;
    expect(capturedSignal?.aborted).toBe(true);
  });
});
