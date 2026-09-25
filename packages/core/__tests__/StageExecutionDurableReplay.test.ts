// ────────────────────────────────────────────────────────────────
// W22 — the effect sandwich on the real stage turn path.
//
// `withEffect()` shipped with ZERO production callers. The consequence was
// concrete and is what these tests pin: `StartupRecoveryService` resets an
// interrupted stage to `pending`, `executeStage` re-enters from the top, and
// before this change every prompt of a half-finished stage was re-sent to the
// model and every tool call it had already made ran again.
//
// Everything here runs against the REAL `DurableExecutionEngine` over REAL
// in-memory SQLite through the REAL repositories — the journal is the thing
// under test, so faking it would test nothing.
//
// △ A crash is simulated by making the turn HANG and then abandoning the
// `executeStage` frame, not by throwing. A throw is a stage FAILURE: it runs
// the catch block, which retries or finalises and reclaims the journal. A
// killed process runs none of that, and "the journal is left mid-flight" is
// precisely the state the sandwich has to recover from.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createDB, migrateDB, EntryRepository, RegisterRepository } from '@generatorai/db';
import {
  StageExecutionService,
  STAGE_OUTPUT_ARTIFACT,
} from '../src/services/StageExecutionService.js';
import { DurableExecutionEngine } from '../src/services/DurableExecutionEngine.js';
import { StartupRecoveryService } from '../src/services/StartupRecoveryService.js';
import { AgentResolver } from '../src/services/AgentResolver.js';
import {
  MockStageRunRepository,
  MockStageDefinitionRepository,
  MockWorkflowDefinitionRepository,
  MockWorkflowRunRepository,
  createFakeWorkspaceManager,
} from './MockRepositories.js';
import type { HitlService } from '../src/services/HitlService.js';
import { EventBus } from '../src/events/EventBus.js';
import type { IChatMessageRepository, ISessionRepository } from '../src/domain/ports/IRepositories.js';
import type { IWorkflowRunRepository } from '../src/domain/ports/IWorkflowRunRepository.js';
import type { SessionAllocator } from '../src/services/SessionAllocator.js';
import type { HookExecutor } from '../src/services/HookExecutor.js';
import type { IAgentHarness } from '../src/domain/ports/IAgentHarness.js';
import type {
  StageRun,
  StageDefinition,
  ChatMessage,
  Session,
  ILogger,
  WorkflowRun,
} from '@generatorai/shared';

// ── Doubles ──────────────────────────────────────────────────────

function mockLogger(): ILogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as ILogger;
}

/** Read-only tool surface → `replayPolicyForToolGroups` yields 'safe'. */
const READ_ONLY_GROUPS = {
  browser: false, widgets: false, extensionAuthoring: false, orchestration: false,
  fileRead: true, fileWrite: false, shell: false, web: true,
};

/**
 * Records every prompt it is handed, and can be told to hang forever on the
 * Nth one — the closest a unit test gets to "the process was killed
 * mid-turn", because nothing after that point in `executeStage` ever runs.
 */
class RecordingHarness {
  readonly prompts: string[] = [];
  /** 1-based index of the prompt that should never return. 0 = none. */
  hangOnPrompt = 0;
  /** 1-based index of the prompt that should throw. 0 = none. */
  failOnPrompt = 0;
  private n = 0;

  async sendPromptAndWait(_conversationId: string, prompt: string): Promise<{ content: string }> {
    this.n += 1;
    this.prompts.push(prompt);
    if (this.hangOnPrompt === this.n) return new Promise<never>(() => undefined);
    if (this.failOnPrompt === this.n) throw new Error('turn failed');
    return { content: `answer-${this.n}` };
  }

  async sendPrompt(conversationId: string, prompt: string): Promise<void> {
    await this.sendPromptAndWait(conversationId, prompt);
  }

  onConversationEvent(): () => void {
    return () => undefined;
  }
}

function harnessPort(rec: RecordingHarness): IAgentHarness {
  return rec as unknown as IAgentHarness;
}

function createMessageRepo(): IChatMessageRepository & { rows: ChatMessage[] } {
  const rows: ChatMessage[] = [];
  const repo = {
    rows,
    create: vi.fn(async (msg: ChatMessage) => { rows.push({ ...msg }); return { ...msg }; }),
    getBySessionId: vi.fn(async () => rows),
    getByChatId: vi.fn(async () => []),
    deleteBySession: vi.fn(async () => {}),
  };
  return repo as unknown as IChatMessageRepository & { rows: ChatMessage[] };
}

/**
 * A restart destroys the in-process session, and `StartupRecoveryService`
 * nulls `stage_runs.session_id` so the relaunch allocates a fresh one. The
 * allocator therefore hands out a NEW conversation id per "boot", which is
 * what makes the replay-recap path reachable.
 */
function createSessionAllocator(boot: { n: number }): SessionAllocator {
  return {
    allocateSession: vi.fn(async (): Promise<Session> => ({
      id: `ses-${boot.n}`,
      name: 'session',
      status: 'running',
      conversationId: `conv-${boot.n}`,
      tags: [],
      requiresCodebase: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    releaseSession: vi.fn(async () => {}),
    releaseAll: vi.fn(async () => {}),
    getSessionById: vi.fn(async () => null),
  } as unknown as SessionAllocator;
}

function createHookExecutor(): HookExecutor {
  return {
    executePhase: vi.fn(async () => ({ shouldContinue: true, mergedResult: {} })),
  } as unknown as HookExecutor;
}

function makeStageDef(prompts: string[], opts?: Partial<StageDefinition>): StageDefinition {
  return {
    id: 'sd-1',
    workflowDefinitionId: 'def-1',
    name: 'Stage One',
    order: 0,
    prompts: prompts.map((text, i) => ({ text, label: `p${i}` })),
    variables: {},
    hooks: [],
    // Default is 1 in-process retry with a 3 s backoff; tests that want a
    // retry ask for it explicitly, and the rest must not get one silently.
    retryPolicy: { maxRetries: 0, backoffMs: 1, backoffMultiplier: 1 },
    createdAt: new Date(),
    ...opts,
  } as StageDefinition;
}

function makeStageRun(id = 'sr-1'): StageRun {
  return {
    id,
    workflowRunId: 'run-1',
    stageDefinitionId: 'sd-1',
    name: 'Stage One',
    status: 'pending',
    currentStep: 0,
    totalSteps: 1,
    retryCount: 0,
    createdAt: new Date(),
  };
}

/** Only the stage's own prompts — excludes the internal summary/recap turns. */
function stagePrompts(rec: RecordingHarness): string[] {
  return rec.prompts.filter(
    (p) => !p.startsWith('Provide a concise summary') && !p.includes('ALREADY COMPLETED'),
  );
}

/** Wait until the harness has been handed `n` prompts (or give up). */
async function untilPrompts(rec: RecordingHarness, n: number): Promise<void> {
  for (let i = 0; i < 500 && rec.prompts.length < n; i += 1) {
    await new Promise((r) => setTimeout(r, 2));
  }
  expect(rec.prompts.length).toBeGreaterThanOrEqual(n);
}

// ── Fixture ──────────────────────────────────────────────────────

interface Fixture {
  service: StageExecutionService;
  harness: RecordingHarness;
  stageRunRepo: MockStageRunRepository;
  stageDefRepo: MockStageDefinitionRepository;
  messageRepo: ReturnType<typeof createMessageRepo>;
  entryRepo: EntryRepository;
  boot: { n: number };
}

describe('W22 — effect sandwich on the stage turn path', () => {
  let db: ReturnType<typeof createDB>;
  let entryRepo: EntryRepository;
  let registerRepo: RegisterRepository;
  let engine: DurableExecutionEngine;

  beforeEach(() => {
    db = createDB(':memory:');
    migrateDB(db);
    entryRepo = new EntryRepository(db);
    registerRepo = new RegisterRepository(db);
    engine = new DurableExecutionEngine(registerRepo, entryRepo, mockLogger());
  });

  /**
   * `durable: false` reproduces the pre-fix behaviour exactly (no engine
   * wired), so every replay assertion has a control it fails against.
   */
  function fixture(opts: { durable: boolean; toolGroups?: Record<string, boolean> }): Fixture {
    const boot = { n: 1 };
    const harness = new RecordingHarness();
    const stageRunRepo = new MockStageRunRepository();
    const stageDefRepo = new MockStageDefinitionRepository();
    const messageRepo = createMessageRepo();

    const service = new StageExecutionService(
      stageRunRepo,
      stageDefRepo,
      messageRepo,
      harnessPort(harness),
      new EventBus(),
      createSessionAllocator(boot),
      createHookExecutor(),
      createFakeWorkspaceManager(),
      new MockWorkflowDefinitionRepository(),
      new MockWorkflowRunRepository(),
      {} as HitlService,
    );
    if (opts.durable) service.setDurableEngine(engine);
    if (opts.toolGroups) {
      // `resolveStageAgent` returns `AgentResolver.empty()` when no agent is
      // bound, whose groups are the permissive platform defaults. Overriding
      // the projection is how a test says "this stage is read-only".
      const empty = AgentResolver.empty();
      vi.spyOn(
        service as unknown as { resolveStageAgent: () => Promise<unknown> },
        'resolveStageAgent',
      ).mockResolvedValue({
        ...empty,
        toolPolicy: { ...empty.toolPolicy, groups: opts.toolGroups },
      });
    }
    return { service, harness, stageRunRepo, stageDefRepo, messageRepo, entryRepo, boot };
  }

  /**
   * Restart the process by running the REAL `StartupRecoveryService` over the
   * interrupted stage.
   *
   * △ This used to hand-write what recovery was *assumed* to do — including
   * `currentStep: 0`, which `resetForRetry` does NOT do. That fabrication made
   * the headline exit-criterion assertion pass for a reason production never
   * supplies: with `currentStep` left at the interrupted step, `executeStage`
   * skips the earlier prompts by the step counter rather than replaying them
   * out of the journal, so no recap is ever built and a fresh conversation is
   * handed prompt N with no memory of 1..N-1. Driving the real service is the
   * only way these tests can claim anything about a real restart.
   */
  async function simulateRestart(f: Fixture, stageRunId: string): Promise<StageRun> {
    const workflowRunRepo = {
      getByStatus: async (statuses: string[]) =>
        statuses.includes('running')
          ? [{ id: 'run-1', status: 'running' } as unknown as WorkflowRun]
          : [],
      updateStatus: async () => {},
      update: async () => ({}) as WorkflowRun,
    } as unknown as IWorkflowRunRepository;

    const sessionRepo = {
      getByStatus: async () => [],
      updateStatus: async () => {},
    } as unknown as ISessionRepository;

    const recovery = new StartupRecoveryService(
      sessionRepo,
      { resumeConversation: async () => {}, destroyConversation: async () => {} } as unknown as IAgentHarness,
      new EventBus(),
      mockLogger(),
      workflowRunRepo,
      f.stageRunRepo,
      undefined,
      undefined,
      // DUR-06 — a re-drive IS wired in production, so recovery resets the
      // stage and hands it back to the scheduler rather than parking the run.
      // The test drives `executeStage` itself in place of the scheduler.
      async () => {},
    );
    recovery.setDurableEngine(engine);
    await recovery.recover();

    f.boot.n += 1;
    f.harness.hangOnPrompt = 0;
    f.harness.prompts.length = 0;
    return f.stageRunRepo.getById(stageRunId);
  }

  // ── The exit criterion ────────────────────────────────────────

  it('does NOT re-send a settled prompt after a restart (the W22 exit criterion)', async () => {
    const f = fixture({ durable: true, toolGroups: READ_ONLY_GROUPS });
    await f.stageDefRepo.create(makeStageDef(['step one', 'step two']));
    const sr = makeStageRun();
    await f.stageRunRepo.create(sr);

    // Boot 1: prompt one settles; prompt two is in flight when we "die".
    f.harness.hangOnPrompt = 2;
    void f.service.executeStage(sr, 'run-1', 'per-stage');
    await untilPrompts(f.harness, 2);

    // Boot 2: re-entry from the top of executeStage.
    const revived = await simulateRestart(f, sr.id);
    await f.service.executeStage(revived, 'run-1', 'per-stage');

    // Prompt one is answered out of the journal, not re-sent.
    expect(stagePrompts(f.harness).filter((p) => p.startsWith('step one'))).toEqual([]);
    // Prompt two never settled, and this stage is read-only, so it re-runs.
    expect(stagePrompts(f.harness).filter((p) => p.startsWith('step two'))).toHaveLength(1);
  });

  it('CONTROL: without the durable engine the same restart re-sends prompt one', async () => {
    const f = fixture({ durable: false, toolGroups: READ_ONLY_GROUPS });
    await f.stageDefRepo.create(makeStageDef(['step one', 'step two']));
    const sr = makeStageRun();
    await f.stageRunRepo.create(sr);

    f.harness.hangOnPrompt = 2;
    void f.service.executeStage(sr, 'run-1', 'per-stage');
    await untilPrompts(f.harness, 2);

    const revived = await simulateRestart(f, sr.id);
    await f.service.executeStage(revived, 'run-1', 'per-stage');

    // This is the defect, reproduced: the first step runs a second time.
    expect(stagePrompts(f.harness).filter((p) => p.startsWith('step one'))).toHaveLength(1);
  });

  it('re-seeds the fresh conversation with the replayed turns exactly once', async () => {
    const f = fixture({ durable: true, toolGroups: READ_ONLY_GROUPS });
    await f.stageDefRepo.create(makeStageDef(['step one', 'step two']));
    const sr = makeStageRun();
    await f.stageRunRepo.create(sr);

    f.harness.hangOnPrompt = 2;
    void f.service.executeStage(sr, 'run-1', 'per-stage');
    await untilPrompts(f.harness, 2);

    const revived = await simulateRestart(f, sr.id);
    await f.service.executeStage(revived, 'run-1', 'per-stage');

    const recaps = f.harness.prompts.filter((p) => p.includes('ALREADY COMPLETED'));
    expect(recaps).toHaveLength(1);
    // The recap carries the replayed turn's instruction and its answer, so
    // the agent is not handed step two with no memory of step one.
    expect(recaps[0]).toContain('step one');
    expect(recaps[0]).toContain('answer-1');
  });

  it('does not duplicate the chat history of a replayed turn', async () => {
    const f = fixture({ durable: true, toolGroups: READ_ONLY_GROUPS });
    await f.stageDefRepo.create(makeStageDef(['step one', 'step two']));
    const sr = makeStageRun();
    await f.stageRunRepo.create(sr);

    f.harness.hangOnPrompt = 2;
    void f.service.executeStage(sr, 'run-1', 'per-stage');
    await untilPrompts(f.harness, 2);

    const revived = await simulateRestart(f, sr.id);
    await f.service.executeStage(revived, 'run-1', 'per-stage');

    const stepOneRows = f.messageRepo.rows.filter(
      (m) => m.role === 'user' && m.content.startsWith('step one'),
    );
    expect(stepOneRows).toHaveLength(1);
  });

  // ── Per-tool ReplayPolicy ─────────────────────────────────────

  it('replay:safe re-runs the turn that was in flight (read-only stage)', async () => {
    const f = fixture({ durable: true, toolGroups: READ_ONLY_GROUPS });
    await f.stageDefRepo.create(makeStageDef(['only step']));
    const sr = makeStageRun();
    await f.stageRunRepo.create(sr);

    f.harness.hangOnPrompt = 1;
    void f.service.executeStage(sr, 'run-1', 'per-stage');
    await untilPrompts(f.harness, 1);

    const revived = await simulateRestart(f, sr.id);
    await f.service.executeStage(revived, 'run-1', 'per-stage');

    // Nothing this stage could have done is irreversible, so the interrupted
    // turn re-runs — that is what `safe` means.
    expect(stagePrompts(f.harness).filter((p) => p.startsWith('only step'))).toHaveLength(1);
  });

  it('replay:never does NOT re-run the turn that was in flight (mutating stage)', async () => {
    // No toolGroups override → platform defaults include fileWrite + shell.
    const f = fixture({ durable: true });
    await f.stageDefRepo.create(makeStageDef(['only step']));
    const sr = makeStageRun();
    await f.stageRunRepo.create(sr);

    f.harness.hangOnPrompt = 1;
    void f.service.executeStage(sr, 'run-1', 'per-stage');
    await untilPrompts(f.harness, 1);

    const revived = await simulateRestart(f, sr.id);
    await f.service.executeStage(revived, 'run-1', 'per-stage');

    // Whatever it had already written to the workspace must not be written
    // twice, so the turn is skipped rather than repeated.
    expect(stagePrompts(f.harness).filter((p) => p.startsWith('only step'))).toEqual([]);
  });

  // ── The operation-id epoch: a retry must NOT replay ───────────

  it('an in-process retry gets a fresh epoch and re-runs the work', async () => {
    const f = fixture({ durable: true });
    await f.stageDefRepo.create(
      makeStageDef(['only step'], {
        retryPolicy: { maxRetries: 1, backoffMs: 1, backoffMultiplier: 1 },
      } as Partial<StageDefinition>),
    );
    const sr = makeStageRun();
    await f.stageRunRepo.create(sr);

    // The first attempt fails after committing intent. `retryStage` bumps
    // `retryCount`, which changes the operation-id epoch — without that, the
    // retry would be answered by the `replay: never` synthetic result and the
    // stage would "retry" by doing nothing at all.
    f.harness.failOnPrompt = 1;
    await f.service.executeStage(sr, 'run-1', 'per-stage');

    expect(stagePrompts(f.harness).filter((p) => p.startsWith('only step'))).toHaveLength(2);
  });

  // ── X-25 artifact channel ─────────────────────────────────────

  it('writes the stage result to the durable artifact channel and seals it', async () => {
    const f = fixture({ durable: true });
    await f.stageDefRepo.create(makeStageDef(['only step']));
    const sr = makeStageRun();
    await f.stageRunRepo.create(sr);

    await f.service.executeStage(sr, 'run-1', 'per-stage');

    const artifact = f.entryRepo.getArtifact('stage_run', sr.id, STAGE_OUTPUT_ARTIFACT);
    expect(artifact).toBeDefined();
    expect(artifact!.complete).toBe(true);
    expect(artifact!.meta).toMatchObject({ stageRunId: sr.id, workflowRunId: 'run-1' });
  });

  // ── X-13 session lineage, written from the live path ──────────

  it('records one lineage link per session the stage speaks through', async () => {
    const f = fixture({ durable: true, toolGroups: READ_ONLY_GROUPS });
    await f.stageDefRepo.create(makeStageDef(['step one', 'step two']));
    const sr = makeStageRun();
    await f.stageRunRepo.create(sr);

    f.harness.hangOnPrompt = 2;
    void f.service.executeStage(sr, 'run-1', 'per-stage');
    await untilPrompts(f.harness, 2);

    const revived = await simulateRestart(f, sr.id);
    await f.service.executeStage(revived, 'run-1', 'per-stage');

    const chain = entryRepo
      .getArtifact('stage_run', sr.id, 'session-lineage')!
      .text.split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as { event: string; conversationId?: string });

    // Two allocations means the conversation was replaced — which is exactly
    // the fact "why did it forget X?" needs, and which nothing recorded before.
    const allocated = chain.filter((e) => e.event === 'allocated');
    expect(allocated).toHaveLength(2);
    expect(allocated[0]!.conversationId).toBe('conv-1');
    expect(allocated[1]!.conversationId).toBe('conv-2');
    // The `lost` link between them is written by StartupRecoveryService and
    // appears only because this restart is the real one — the hand-written
    // stand-in this test used to call never produced it, so the middle of the
    // chain (the half that carries the REASON) was never exercised at all.
    expect(chain.map((e) => e.event)).toEqual(['allocated', 'lost', 'allocated']);
  });

  // ── B2 — recovery must actually rewind the step counter ───────

  it('StartupRecoveryService rewinds currentStep so the journal decides what replays', async () => {
    const f = fixture({ durable: true, toolGroups: READ_ONLY_GROUPS });
    await f.stageDefRepo.create(makeStageDef(['step one', 'step two']));
    const sr = makeStageRun();
    await f.stageRunRepo.create(sr);

    f.harness.hangOnPrompt = 2;
    void f.service.executeStage(sr, 'run-1', 'per-stage');
    await untilPrompts(f.harness, 2);

    // Mid-flight the row records step 1. `resetForRetry` alone leaves it there,
    // and `executeStage` would then start its loop at 1 — skipping step 0 by
    // the counter instead of replaying it out of the journal, which is the
    // ONLY thing that builds the recap for the fresh conversation.
    expect((await f.stageRunRepo.getById(sr.id)).currentStep).toBe(1);

    const revived = await simulateRestart(f, sr.id);
    expect(revived.currentStep).toBe(0);
  });

  // ── B1 — pause → resume must run the continuation turn ────────

  it('pause→resume runs the continuation turn on a mutating stage (not a synthetic skip)', async () => {
    // No toolGroups override → platform defaults include fileWrite + shell,
    // so the turn's replay policy is `never`. That is exactly the stage class
    // where the journal used to answer the resume with a synthetic settlement.
    const f = fixture({ durable: true });
    await f.stageDefRepo.create(makeStageDef(['only step']));
    const sr = makeStageRun();
    await f.stageRunRepo.create(sr);

    // The turn is in flight — intent committed, nothing settled — when the
    // operator pauses.
    f.harness.hangOnPrompt = 1;
    void f.service.executeStage(sr, 'run-1', 'per-stage');
    await untilPrompts(f.harness, 1);
    await f.stageRunRepo.updateStatus(sr.id, 'paused');

    // …and resumes. `resumeStage` re-enters `executeStage` with the resume
    // context, which turns the step's prompt into the continuation prompt.
    f.harness.hangOnPrompt = 0;
    f.harness.prompts.length = 0;
    const paused = await f.stageRunRepo.getById(sr.id);
    await f.service.executeStage(
      paused, 'run-1', 'per-stage', undefined, undefined, undefined,
      { resumeFromPause: true, continuationNeeded: true },
    );

    // Without this the stage "completes" on a truncated answer: the operation
    // id is unchanged, so `withEffect` writes a synthetic settlement, the turn
    // is skipped, and — because the skip is itself durable — every later
    // resume replays it.
    expect(
      f.harness.prompts.filter((p) => p.startsWith('Continue from where you left off')),
    ).toHaveLength(1);
    expect((await f.stageRunRepo.getById(sr.id)).status).toBe('completed');
  });

  it('pause→resume stays correct on the SECOND cycle (the skip was durable)', async () => {
    const f = fixture({ durable: true });
    await f.stageDefRepo.create(makeStageDef(['only step']));
    const sr = makeStageRun();
    await f.stageRunRepo.create(sr);

    // `hangOnPrompt` counts prompts handed to the harness overall, so each
    // cycle names the next one.
    //
    // Cycle 1 — the step's own turn hangs, then the operator pauses.
    f.harness.hangOnPrompt = 1;
    void f.service.executeStage(sr, 'run-1', 'per-stage');
    await untilPrompts(f.harness, 1);
    await f.stageRunRepo.updateStatus(sr.id, 'paused');

    // Cycle 2 — resume; the CONTINUATION turn hangs, and it is paused too.
    f.harness.hangOnPrompt = 2;
    void f.service.executeStage(
      await f.stageRunRepo.getById(sr.id),
      'run-1', 'per-stage', undefined, undefined, undefined,
      { resumeFromPause: true, continuationNeeded: true },
    );
    await untilPrompts(f.harness, 2);
    await f.stageRunRepo.updateStatus(sr.id, 'paused');
    f.harness.prompts.length = 0;

    // Third entry: the continuation must STILL reach the model. The original
    // defect was self-perpetuating — the synthetic settlement it wrote made
    // every subsequent resume skip too.
    f.harness.hangOnPrompt = 0;
    const paused = await f.stageRunRepo.getById(sr.id);
    await f.service.executeStage(
      paused, 'run-1', 'per-stage', undefined, undefined, undefined,
      { resumeFromPause: true, continuationNeeded: true },
    );

    expect(
      f.harness.prompts.filter((p) => p.startsWith('Continue from where you left off')),
    ).toHaveLength(1);
    expect((await f.stageRunRepo.getById(sr.id)).status).toBe('completed');
  });

  // ── B3 — a sealed artifact must not outlive the attempt ───────

  it('a post-completion validation retry appends to the stage artifact instead of being swallowed', async () => {
    const f = fixture({ durable: true });
    await f.stageDefRepo.create(makeStageDef(['only step']));
    const sr = makeStageRun();
    await f.stageRunRepo.create(sr);

    // Attempt 0 completes and SEALS the artifact.
    await f.service.executeStage(sr, 'run-1', 'per-stage');
    const sealed = f.entryRepo.getArtifact('stage_run', sr.id, STAGE_OUTPUT_ARTIFACT)!;
    expect(sealed.complete).toBe(true);
    const attemptOneText = sealed.text;

    // `WorkflowRunService.retryStageAfterValidation` rejects that output and
    // re-executes the SAME stage run (same id → same artifact scope) with a
    // fresh validation epoch.
    // (the status/step flip is what `retryStageAfterValidation` does before
    // handing the run back to `executeStage` on its full-restart branch)
    await f.stageRunRepo.update(sr.id, {
      status: 'queued',
      currentStep: 0,
      completedAt: undefined,
    });
    await f.stageRunRepo.incrementRetryCount(sr.id);
    const retried = await f.stageRunRepo.getById(sr.id);
    await f.service.executeStage(retried, 'run-1', 'per-stage', undefined, {
      __validationFeedback: 'no summary of the work was produced',
      __validationRetryAttempt: '1',
    });

    const after = f.entryRepo.getArtifact('stage_run', sr.id, STAGE_OUTPUT_ARTIFACT)!;
    // Every append in the second attempt returned null against the sealed row,
    // so successors reading the durable channel (WorkflowRunService prefers it
    // over `outputText`) were handed the output validation had just rejected.
    expect(after.text.length).toBeGreaterThan(attemptOneText.length);
    expect(after.text).toContain('answer-4');
  });

  // ── B4 — the journal outlives the terminal status write ───────

  it('releases the journal only AFTER the completed status is written', async () => {
    const f = fixture({ durable: true });
    await f.stageDefRepo.create(makeStageDef(['only step']));
    const sr = makeStageRun();
    await f.stageRunRepo.create(sr);

    const order: string[] = [];
    vi.spyOn(engine, 'releaseJournal').mockImplementation(() => { order.push('releaseJournal'); });
    const realUpdate = f.stageRunRepo.update.bind(f.stageRunRepo);
    vi.spyOn(f.stageRunRepo, 'update').mockImplementation(async (id, patch) => {
      if (patch.status === 'completed') order.push('status:completed');
      return realUpdate(id, patch);
    });

    await f.service.executeStage(sr, 'run-1', 'per-stage');

    // A crash in the reversed window re-runs the final prompt and every tool
    // call it made: the journal that would have replayed it is already gone,
    // while the row still says `running` so recovery relaunches the stage.
    expect(order).toEqual(['status:completed', 'releaseJournal']);
  });

  it('releases the journal only AFTER the failed status is written', async () => {
    const f = fixture({ durable: true });
    await f.stageDefRepo.create(makeStageDef(['only step']));
    const sr = makeStageRun();
    await f.stageRunRepo.create(sr);

    const order: string[] = [];
    vi.spyOn(engine, 'releaseJournal').mockImplementation(() => { order.push('releaseJournal'); });
    const realUpdate = f.stageRunRepo.update.bind(f.stageRunRepo);
    vi.spyOn(f.stageRunRepo, 'update').mockImplementation(async (id, patch) => {
      if (patch.status === 'failed') order.push('status:failed');
      return realUpdate(id, patch);
    });

    f.harness.failOnPrompt = 1;
    await f.service.executeStage(sr, 'run-1', 'per-stage');

    expect(order).toEqual(['status:failed', 'releaseJournal']);
  });

  it('reclaims the step journal at stage completion but keeps the artifact', async () => {
    const f = fixture({ durable: true });
    await f.stageDefRepo.create(makeStageDef(['only step']));
    const sr = makeStageRun();
    await f.stageRunRepo.create(sr);

    await f.service.executeStage(sr, 'run-1', 'per-stage');

    // §3.4 "retention that fires": nothing but the artifact survives a
    // terminal stage. Before this pass `deleteByScope` had zero callers and
    // the journal grew by one register + one entry per turn, forever.
    const remaining = entryRepo.listByScope('stage_run', sr.id);
    expect(remaining.every((e) => e.kind === 'artifact')).toBe(true);
    expect(registerRepo.listByScope('stage_run', sr.id)).toEqual([]);
    expect(entryRepo.getArtifact('stage_run', sr.id, STAGE_OUTPUT_ARTIFACT)).toBeDefined();
  });
});
