// ────────────────────────────────────────────────────────────────
// StageExecutionService — step timeout defaults, timer cleanup, abort
// signal threading, and the liveness heartbeat (WS-D1 / FEAT-3 hardening).
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StageExecutionService } from '../src/services/StageExecutionService.js';
import {
  MockStageRunRepository,
  MockStageDefinitionRepository,
  MockWorkflowDefinitionRepository,
  MockWorkflowRunRepository,
  createFakeWorkspaceManager,
} from './MockRepositories.js';
import type { HitlService } from '../src/services/HitlService.js';
import { MockCopilotPort } from './MockAgentHarness.js';
import { EventBus } from '../src/events/EventBus.js';
import type { IChatMessageRepository } from '../src/domain/ports/IRepositories.js';
import type { SessionAllocator } from '../src/services/SessionAllocator.js';
import type { HookExecutor } from '../src/services/HookExecutor.js';
import type { StageRun, StageDefinition, ChatMessage, Session } from '@generatorai/shared';

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
    allocateSession: vi.fn(async () => fakeSession),
    releaseSession: vi.fn(async () => {}),
    releaseAll: vi.fn(async () => {}),
    getSessionById: vi.fn(async () => fakeSession),
  } as unknown as SessionAllocator;
}

function createMockHookExecutor(): HookExecutor {
  return {
    executePhase: vi.fn(async () => ({ shouldContinue: true, mergedResult: {} })),
  } as unknown as HookExecutor;
}

function makeStageDef(
  id: string,
  prompts: StageDefinition['prompts'],
  opts?: Partial<StageDefinition>,
): StageDefinition {
  return {
    id,
    workflowDefinitionId: 'def-1',
    name: `Stage ${id}`,
    order: 0,
    prompts,
    variables: {},
    hooks: [],
    createdAt: new Date(),
    ...opts,
  };
}

function makeStageRun(
  id: string,
  stageDefId: string,
  status: StageRun['status'] = 'pending',
): StageRun {
  return {
    id,
    workflowRunId: 'run-1',
    stageDefinitionId: stageDefId,
    name: `SR ${stageDefId}`,
    status,
    currentStep: 0,
    totalSteps: 1,
    retryCount: 0,
    createdAt: new Date(),
  };
}

describe('StageExecutionService — step timeouts, abort signal, and heartbeat', () => {
  let service: StageExecutionService;
  let stageRunRepo: MockStageRunRepository;
  let stageDefRepo: MockStageDefinitionRepository;
  let messageRepo: ReturnType<typeof createMockMessageRepo>;
  let copilot: MockCopilotPort;
  let eventBus: EventBus;
  let sessionAllocator: ReturnType<typeof createMockSessionAllocator>;
  let hookExecutor: ReturnType<typeof createMockHookExecutor>;

  beforeEach(() => {
    stageRunRepo = new MockStageRunRepository();
    stageDefRepo = new MockStageDefinitionRepository();
    messageRepo = createMockMessageRepo();
    copilot = new MockCopilotPort();
    eventBus = new EventBus();
    sessionAllocator = createMockSessionAllocator();
    hookExecutor = createMockHookExecutor();

    service = new StageExecutionService(
      stageRunRepo,
      stageDefRepo,
      messageRepo,
      copilot,
      eventBus,
      sessionAllocator,
      hookExecutor,
      createFakeWorkspaceManager(),
      new MockWorkflowDefinitionRepository(),
      new MockWorkflowRunRepository(),
      {} as HitlService,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── task 1: default timeout ──

  it('applies the documented default timeout when the stage sets none', async () => {
    vi.useFakeTimers();
    service.setDefaultStageTimeoutMs(50);

    const sDef = makeStageDef('sd-default', [
      { label: 'P1', text: 'Go', waitForCompletion: true },
    ], {
      // No retry so the failure is immediate and terminal — isolates the
      // assertion to "did the default timeout fire" rather than retry timing.
      retryPolicy: { maxRetries: 0, backoffMs: 0, backoffMultiplier: 1 },
    });
    await stageDefRepo.create(sDef);
    const sr = makeStageRun('sr-default', 'sd-default');
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
    const sDef = makeStageDef('sd-clear', [
      { label: 'P1', text: 'Go', waitForCompletion: true },
    ], { timeoutMs: 5_000 });
    await stageDefRepo.create(sDef);
    const sr = makeStageRun('sr-clear', 'sd-clear');
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
    // Use the DEFAULT timeout path (no explicit `timeoutMs`) rather than an
    // explicit one: an explicit `timeoutMs` is floored at MIN_TIMEOUT_MS
    // (1000ms), so a small explicit value here would silently become 1000ms
    // and this test would need to advance ~1s instead of exercising the
    // fast path.
    service.setDefaultStageTimeoutMs(50);
    const sDef = makeStageDef('sd-abort', [
      { label: 'P1', text: 'Go', waitForCompletion: true },
    ], {
      retryPolicy: { maxRetries: 0, backoffMs: 0, backoffMultiplier: 1 },
    });
    await stageDefRepo.create(sDef);
    const sr = makeStageRun('sr-abort', 'sd-abort');
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

    const sDef = makeStageDef('sd-hb', [
      { label: 'P1', text: 'Go', waitForCompletion: true },
    ]);
    await stageDefRepo.create(sDef);
    const sr = makeStageRun('sr-hb', 'sd-hb');
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
    const sDef = makeStageDef('sd-reap', [
      { label: 'P1', text: 'Go', waitForCompletion: true },
    ], {
      timeoutMs: 60_000, // long enough that only abortStage() ends the call
      retryPolicy: { maxRetries: 0, backoffMs: 0, backoffMultiplier: 1 },
    });
    await stageDefRepo.create(sDef);
    const sr = makeStageRun('sr-reap', 'sd-reap');
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
