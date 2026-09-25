// ────────────────────────────────────────────────────────────────
// WorkflowRunService — workflow run lifecycle management (v2)
// Orchestrates DAGScheduler + StageExecutionService.
// ────────────────────────────────────────────────────────────────

import type {
  WorkflowRun,
  WorkflowRunStatus,
  StageRun,
  CreateWorkflowRunParams,
  ILogger,
} from '@generatorai/shared';
import { FORBIDDEN_VARIABLE_NAME_PATTERN, type AgentStage, type SessionSpec, type WorkflowGraph } from '@generatorai/workflow-spec';
import type { TerminalRunStatus } from './DAGScheduler.js';
import type { Semaphore } from '../utils/Semaphore.js';
import type { AdmissionController, AdmissionTicket } from './AdmissionController.js';
import { generateId, withSpan, getMeter, ValidationError } from '@generatorai/shared';
import * as path from 'node:path';

// ── OTel Metrics ──
const meter = getMeter('core.workflow');
const runCounter = meter.createCounter('workflow.runs.total', {
  description: 'Total workflow runs created',
});
const runDuration = meter.createHistogram('workflow.run.duration_ms', {
  description: 'Duration of workflow runs in milliseconds',
  unit: 'ms',
});
const activeRuns = meter.createUpDownCounter('workflow.active_runs', {
  description: 'Number of currently active workflow runs',
});
import type { IWorkflowRunRepository } from '../domain/ports/IWorkflowRunRepository.js';
import type { IStageRunRepository } from '../domain/ports/IStageRunRepository.js';
import type { RunDefinitionReader } from './definitions/RunDefinitionReader.js';
import { templateScope } from './definitions/runScope.js';
import type { WorkflowDefinitionService } from './WorkflowDefinitionService.js';
import type { EventBus } from '../events/EventBus.js';
import type { DAGScheduler } from './DAGScheduler.js';
import type { StageExecutionService } from './StageExecutionService.js';
import { STAGE_OUTPUT_ARTIFACT } from './StageExecutionService.js';
import type { DurableExecutionEngine } from './DurableExecutionEngine.js';
import type { SessionAllocator } from './SessionAllocator.js';
import type { WorkspaceManager } from './WorkspaceManager.js';
import type { ResultValidator } from './ResultValidator.js';
import type { WorktreeService } from './WorktreeService.js';
import type { IProjectCodebaseRepository } from '../domain/ports/IProjectCodebaseRepository.js';
import type { DAG } from '../domain/dag/types.js';
import { WorkflowRunStateMachine } from '../domain/state-machines/WorkflowRunStateMachine.js';
import type { HookExecutor, HookContext } from './HookExecutor.js';
import type { WorkflowHookDefinition } from '@generatorai/shared';

/**
 * WS-D1 — variables that describe WHERE a run executed rather than WHAT it
 * was asked to do. A retry must not inherit them: `startRun` provisions a
 * fresh workspace only when the directory keys are absent, and the worktree
 * paths point into the ancestor's (possibly reaped) checkout.
 */
const EXECUTION_CONTEXT_KEYS = new Set([
  '__workingDirectory',
  '__artifactsDirectory',
  '__workspaceId',
  '__workflowRunId',
]);
/** The engine's record of the run's codebase checkouts (`run.codebases`). */
const WORKTREE_VARIABLE_PATTERN = /^repo_(path|branch)_/;

/** v1 retry numbers from a v2 retry policy (attempts include the first). */
function retryNumbers(stage: AgentStage): { maxRetries: number; backoffMs: number; backoffMultiplier: number } {
  return {
    maxRetries: Math.max(0, (stage.retry?.maxAttempts ?? 1) - 1),
    backoffMs: stage.retry?.initialDelayMs ?? 3000,
    backoffMultiplier: stage.retry?.backoffMultiplier ?? 1,
  };
}

export function stripExecutionContext(
  variables: Record<string, unknown>,
): { variables: Record<string, unknown>; dropped: string[] } {
  const kept: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(variables)) {
    if (EXECUTION_CONTEXT_KEYS.has(key) || WORKTREE_VARIABLE_PATTERN.test(key)) {
      dropped.push(key);
    } else {
      kept[key] = value;
    }
  }
  return { variables: kept, dropped };
}

const UNREACHABLE_STAGE_MESSAGE = 'Skipped — no incoming edge or run condition was satisfied';

export class WorkflowRunService {
  /** Track stage run IDs already processed to prevent duplicate handling */
  private processedStageRuns = new Set<string>();
  /**
   * W18 / P1-18 — process-wide reconciler replaces per-run polling intervals.
   *
   * Previously each active run created one `setInterval(3000)`, so 22 live
   * runs produced ~200 no-op DB queries every 3 s. A single reconciler ticks
   * once per interval and iterates over all active runs in sequence. The total
   * query rate is identical but timer handles drop from O(N runs) → O(1).
   *
   * The reconciler is started on the first `startPolling()` call and stopped
   * when the last run is removed. `interval.unref()` prevents it from keeping
   * the process alive after graceful shutdown.
   */
  private reconcilerInterval: ReturnType<typeof setInterval> | undefined;
  /** Run IDs currently tracked by the reconciler (was: pollingIntervals.keys()). */
  private activeRunIds = new Set<string>();
  /** Runs whose reconcile tick is currently executing — prevents overlapping ticks
   *  (a tick that runs validation + backoff can exceed the 3s interval). */
  private pollInFlight = new Set<string>();
  /** Per-run EventBus unsubscribe handles for event-driven DAG routing. */
  private eventUnsubscribers = new Map<string, () => void>();
  /** Optional hook executor for workflow-level lifecycle hooks */
  private hookExecutor?: HookExecutor;
  /**
   * WS-D1 — stage liveness policy. The executor beats every
   * `heartbeatIntervalMs`; a `queued`/`running` stage whose last beat is
   * older than `heartbeatIntervalMs * staleMultiplier` is failed by the
   * reconciler through the normal `onStageFailed` path, so downstream
   * stages are reconciled exactly as for any other failure. This is the one
   * reaper that still works when the process running the stage is gone.
   * `reconcileIntervalMs` is the tick of the process-wide reconciler.
   */
  private heartbeatPolicy = {
    heartbeatIntervalMs: 10_000,
    staleMultiplier: 3,
    reconcileIntervalMs: 3_000,
  };

  /** WS-D1 — test timing seam for stage liveness (see `heartbeatPolicy`); nothing in production configures it. */
  setHeartbeatPolicy(policy: Partial<typeof this.heartbeatPolicy>): void {
    this.heartbeatPolicy = { ...this.heartbeatPolicy, ...policy };
  }

  private get heartbeatStaleAfterMs(): number {
    return this.heartbeatPolicy.heartbeatIntervalMs * this.heartbeatPolicy.staleMultiplier;
  }

  constructor(
    private runRepo: IWorkflowRunRepository,
    private stageRunRepo: IStageRunRepository,
    /** The graph of each run's pinned definition version. */
    private definitions: RunDefinitionReader,
    /** Resolves which version a new run pins. */
    private definitionService: WorkflowDefinitionService,
    private eventBus: EventBus,
    private dagScheduler: DAGScheduler,
    private stageExecutionService: StageExecutionService,
    private sessionAllocator: SessionAllocator,
    /** Every run gets an execution workspace (`workflow_run` owner). */
    private workspaceManager: WorkspaceManager,
    /**
     * W18 — every stage launch goes through the `ordinary` lane, so bulk
     * runs cannot crowd out interactive chat turns.
     */
    private admissionController: AdmissionController,
    private logger?: ILogger,
    /**
     * Optional concurrency limiter (P1#7). When supplied, every stage launch
     * acquires a permit before executing, bounding how many harness
     * subprocesses spawn at once so a small self-hosted instance isn't
     * overwhelmed by a wide DAG fan-out. Omitted ⇒ unlimited (tests).
     */
    private stageSemaphore?: Semaphore,
  ) {}

  /** Worktree service for codebase isolation — late-wired (constructed after this service). */
  private worktreeService?: WorktreeService;
  /** Resolves a project's codebases for worktree creation. */
  private codebaseRepo?: IProjectCodebaseRepository;

  /** Late-wire worktree service (set after construction when DI order requires it). */
  setWorktreeService(wts: WorktreeService, cbRepo: IProjectCodebaseRepository): void {
    this.worktreeService = wts;
    this.codebaseRepo = cbRepo;
  }

  /** Late-wire hook executor for workflow-level lifecycle hooks. */
  setHookExecutor(he: HookExecutor): void {
    this.hookExecutor = he;
  }

  /** Late-wire result validator (so each stage's `output.rules` run in the
   *  DAG flow without a hard dependency on WorkflowOrchestrator). */
  setResultValidator(rv: ResultValidator): void {
    this.resultValidator = rv;
  }

  private resultValidator?: ResultValidator;

  /**
   * W22/X-25 — read side of the durable artifact channel. Used to build a
   * successor's context from the predecessor's DURABLE result rather than
   * from the `outputText` column, which is written once at the end and is
   * therefore missing or stale for any stage that was interrupted.
   */
  private durableEngine?: DurableExecutionEngine;

  setDurableEngine(engine: DurableExecutionEngine): void {
    this.durableEngine = engine;
  }

  /**
   * Execute workflow-level hooks for a given phase. Non-fatal.
   */
  private async executeWorkflowHooks(
    phase: WorkflowHookDefinition['phase'],
    hooks: readonly WorkflowHookDefinition[] | undefined,
    runId: string,
    definitionId: string,
  ): Promise<void> {
    if (!this.hookExecutor || !hooks || hooks.length === 0) return;
    try {
      const run = await this.runRepo.getById(runId);
      const hookCtx: HookContext = {
        sessionId: `__run_service_${runId}__`,
        workflowId: definitionId,
        workspacePath: (run.variables?.['__workingDirectory'] as string) ?? '',
        variables: (run.variables ?? {}) as Record<string, string>,
        eventBus: this.eventBus,
        // Stamp the run id so hook lifecycle events surface in scope='run'.
        workflowRunId: runId,
        templateScope: templateScope(run, run.variables, await this.stageRunRepo.getByRunId(runId)),
      };
      await this.hookExecutor.executePhase(phase, [...hooks], hookCtx);
    } catch (err) {
      this.logger?.warn(`[WorkflowRunService] Workflow hook phase '${phase}' error (non-fatal): ${err}`);
    }
  }

  /**
   * Single launch path for a stage's fire-and-forget execution. Centralizes
   * three concerns that were previously copy-pasted across startRun /
   * onStageCompleted / onStageFailed / scheduleSuccessorsAfterSkip / redriveRun:
   *  1. bounded concurrency (Semaphore) so a wide fan-out doesn't spawn an
   *     unbounded number of harness subprocesses (P1#7),
   *  2. routing a launch-time throw through onStageFailed so a stage that dies
   *     before StageExecutionService writes a 'running'/'failed' status doesn't
   *     strand the run in 'pending',
   *  3. one call site for executeStage — whose atomic claim (DUR-06) makes a
   *     duplicate launch a harmless no-op, so it is always safe to call.
   */
  private launchStage(
    stageRun: StageRun,
    runId: string,
    sessionMode: 'single' | 'per-stage' | 'auto',
    workflowSession?: SessionSpec,
    variables?: Record<string, unknown>,
    predecessorSummaries?: Array<{ stageName: string; summary: string; outputData?: Record<string, unknown> }>,
  ): void {
    // W18 / P1-16 — use acquire/release directly instead of semaphore.run() so
    // we can yield the permit across HITL approval waits (which can last hours).
    // semaphoreCallbacks are forwarded to executeStage; it calls pause() before
    // each hitl.interrupt() and resume() once the reviewer has decided.
    //
    // M8-fix: gate each launch through the `ordinary` admission lane so a wide
    // DAG fan-out queues (never rejects) rather than running unbounded and
    // saturating the event loop. Falls through without gating when no controller.
    //
    // W18 acceptance ("with 8 stages on approval, unrelated runs still
    // progress") needs BOTH permits yielded across the wait, not just the
    // stage one: the admission permit is held for the whole of `runFn`, so
    // parking only the stage semaphore still let N approvals consume the
    // entire `ordinary` lane and stall unrelated runs. `ticket` is the
    // admission-side equivalent of the stage semaphore's pause/resume.
    const runFn = async (ticket?: AdmissionTicket) => {
      if (this.stageSemaphore) await this.stageSemaphore.acquire();
      let permitHeld = !!this.stageSemaphore;
      const semaphoreCallbacks =
        this.stageSemaphore || ticket
          ? {
              pause: () => {
                if (permitHeld) {
                  this.stageSemaphore!.release();
                  permitHeld = false;
                }
                ticket?.pause();
              },
              resume: async () => {
                // Re-acquire in the same order every launch takes them
                // (admission lane, then stage slot) so two parked stages
                // resuming concurrently cannot deadlock against each other.
                await ticket?.resume();
                if (!permitHeld && this.stageSemaphore) {
                  await this.stageSemaphore.acquire();
                  permitHeld = true;
                }
              },
            }
          : undefined;
      try {
        await this.stageExecutionService.executeStage(
          stageRun,
          runId,
          sessionMode,
          workflowSession,
          variables,
          predecessorSummaries,
          undefined, // resumeContext — not used from launchStage
          semaphoreCallbacks,
        );
      } finally {
        // Only release if the HITL callbacks didn't already release (i.e.
        // executeStage threw before reaching a pause+resume pair, or the stage
        // had no HITL block at all).
        if (permitHeld && this.stageSemaphore) this.stageSemaphore.release();
      }
    };

    const settled = this.admissionController.admit('ordinary', (ticket) => runFn(ticket));

    settled.catch((err) => {
      this.onStageFailed(runId, stageRun.id, err).catch(() => {/* swallow */});
    });
  }

  /**
   * DUR-06 — re-drive an already-`running` run after a process restart.
   *
   * Called by StartupRecoveryService for each interrupted run (whose in-flight
   * stages it has already reset to `pending`). Unlike startRun this does NOT
   * redo workspace/worktree setup — that state is persisted in run.variables;
   * it only re-attaches the in-memory scheduler to the durable DB state:
   *   1. pre-seed the completion de-dup set with already-terminal stages so the
   *      polling backstop does NOT re-run result-validation / hooks for work
   *      that finished before the crash,
   *   2. re-subscribe event-driven routing + restart the polling backstop,
   *   3. launch every currently-ready stage (the DUR-06 claim makes this
   *      idempotent against any stray duplicate),
   *   4. skip now-unreachable stages and finalize if the DAG is already
   *      complete (covers a crash between the last stage completing and the run
   *      being finalized).
   * Idempotent and safe to call on a run already being driven.
   */
  async redriveRun(runId: string): Promise<void> {
    const run = await this.runRepo.getById(runId);
    if (run.status === 'starting') {
      await this.runRepo.updateStatus(runId, 'running');
      run.status = 'running';
    }
    if (run.status !== 'running') return;

    const stageRuns = await this.stageRunRepo.getByRunId(runId);

    // 1. Pre-seed de-dup for already-terminal stages so the polling backstop
    //    does not re-process (re-validate) completed/failed work post-restart.
    for (const sr of stageRuns) {
      if (sr.status === 'completed') {
        this.processedStageRuns.add(`completed:${sr.id}:${sr.retryCount}`);
      } else if (sr.status === 'failed') {
        this.processedStageRuns.add(`failed:${sr.id}:${sr.retryCount}`);
      }
    }

    // 2. Re-attach scheduler (both idempotent) and signal the resume before
    //    any launch/finalize so the event order reads naturally
    //    (resumed → [stage events] → completed/failed).
    this.subscribeRunEvents(runId);
    this.startPolling(runId);
    await this.eventBus.emitGlobal({
      kind: 'workflow_run.resumed',
      data: { workflowRunId: runId },
    });

    // 3+4. One reconcile decides what launches, what is skipped as
    //      unreachable, and whether the run was already complete at crash
    //      time. This is the same path every stage event takes, so a restart
    //      can no longer disagree with the live scheduler about readiness
    //      (the old restart path ignored edge types and relaunched a fan-in
    //      whose required branch had failed).
    await this.advanceRun(runId);
  }

  /**
   * Create a workflow run pinned to an immutable definition version (W-13):
   * the definition's current published version, a test version of its
   * working graph (`testRun`), or — for a retry — the ancestor's version.
   * One stage run per stage of that version, keyed by stage key.
   */
  async createRun(params: CreateWorkflowRunParams): Promise<WorkflowRun> {
    // R-8: engine state (`__*`, codebase checkouts) never comes from caller
    // variables; it is derived from the typed params below.
    const reserved = Object.keys(params.variables ?? {}).filter((k) => FORBIDDEN_VARIABLE_NAME_PATTERN.test(k));
    if (reserved.length > 0) {
      throw new ValidationError(
        `Invalid workflow run variables: ${reserved.map((k) => `"${k}"`).join(', ')} ` +
          'are engine-reserved names (__*, repo_path_*, repo_branch_*) and cannot be supplied',
      );
    }
    const engineState: Record<string, unknown> = {};
    if (params.projectId) engineState['__projectId'] = params.projectId;
    if (params.triggeredBy) engineState['__triggeredBy'] = params.triggeredBy;
    if (params.stageOverrides && params.stageOverrides.length > 0) engineState['__stageOverrides'] = params.stageOverrides;
    return this.materializeRun(params, engineState);
  }

  /** Create the run row and its stage rows; `engineState` holds the engine's own run-state keys. */
  private async materializeRun(params: CreateWorkflowRunParams, engineState: Record<string, unknown>): Promise<WorkflowRun> {
    return withSpan('core.workflow', 'workflow.createRun', async (span) => {
      span.setAttribute('workflow.definition_id', params.workflowDefinitionId);

    const definitionVersionId =
      params.definitionVersionId ??
      (await this.definitionService.resolveVersionForRun(params.workflowDefinitionId, { testRun: params.testRun === true }));
    const graph = await this.definitions.get(definitionVersionId);
    const variables = graph.workflow.variables;
    const now = new Date();

    // BUGFIX (variable type validation at run create) — enforce the declared
    // variable types, `required` and choice options against the caller's
    // variables, failing fast with a clear error.
    if (variables.length > 0) {
      const provided = params.variables ?? {};
      const issues: string[] = [];
      for (const v of variables) {
        const raw = (provided as Record<string, unknown>)[v.name];
        const missing = raw === undefined || raw === null || raw === '';
        if (missing) {
          if (v.required && v.defaultValue === undefined) {
            issues.push(`variable "${v.name}" is required`);
          }
          continue; // unset optional variable — nothing to type-check
        }
        switch (v.type) {
          case 'string':
          case 'text':
            if (typeof raw !== 'string') {
              issues.push(`variable "${v.name}" must be a string (got ${typeof raw})`);
            }
            break;
          case 'number':
            if (typeof raw !== 'number' || Number.isNaN(raw)) {
              issues.push(`variable "${v.name}" must be a number (got ${typeof raw})`);
            }
            break;
          case 'boolean':
            if (typeof raw !== 'boolean') {
              issues.push(`variable "${v.name}" must be a boolean (got ${typeof raw})`);
            }
            break;
          case 'choice': {
            if (typeof raw !== 'string') {
              issues.push(`variable "${v.name}" must be a string (got ${typeof raw})`);
            } else if (v.options && v.options.length > 0 && !v.options.includes(raw)) {
              issues.push(
                `variable "${v.name}" must be one of [${v.options.join(', ')}] (got "${raw}")`,
              );
            }
            break;
          }
        }
      }
      if (issues.length > 0) {
        throw new ValidationError(`Invalid workflow run variables: ${issues.join('; ')}`);
      }
    }

    const runVars: Record<string, unknown> = { ...(params.variables ?? {}) };
    // Fill in the declared `defaultValue` of every variable the caller did
    // not provide, so templates reading it render the default.
    for (const v of variables) {
      const current = runVars[v.name];
      const missing = current === undefined || current === null || current === '';
      if (missing && v.defaultValue !== undefined) {
        runVars[v.name] = v.defaultValue;
      }
    }
    Object.assign(runVars, engineState);
    const run: WorkflowRun = {
      id: generateId(),
      workflowDefinitionId: params.workflowDefinitionId,
      definitionVersionId,
      name: `${graph.workflow.name} - Run ${Date.now()}`,
      status: 'created',
      // v2: every stage gets a fresh session (sessionReuse 'fresh').
      sessionMode: 'per-stage',
      variables: runVars,
      // W23: carry the ancestor reference if this run was created by retry.
      ...(params.ancestorRunId ? { ancestorRunId: params.ancestorRunId } : {}),
      createdAt: now,
      updatedAt: now,
    };

    // The run row and its N stage rows commit in ONE transaction: a failed
    // stage insert never leaves a half-materialized run.
    const stageRuns: StageRun[] = graph.stages.map((stage) => ({
      id: generateId(),
      workflowRunId: run.id,
      stageKey: stage.key,
      name: stage.name,
      status: 'pending',
      currentStep: 0,
      totalSteps: stage.prompts.length,
      retryCount: 0,
      version: 0,
      createdAt: now,
    }));
    await this.runRepo.createWithStages(run, stageRuns);

    // Event emission happens AFTER commit so that observers never see a
    // `workflow_run.created` event for a run whose row was rolled back.
    await this.eventBus.emitGlobal({
      kind: 'workflow_run.created',
      data: {
        workflowRunId: run.id,
        name: run.name,
        workflowDefinitionId: run.workflowDefinitionId,
      },
    });

    runCounter.add(1, { definition_id: params.workflowDefinitionId });
    span.setAttribute('workflow.run_id', run.id);
    span.setAttribute('workflow.stage_count', stageRuns.length);

    return run;
    });
  }
  /**
   * W23 / X-24 — User-initiated retry of a failed or cancelled run.
   *
   * Creates a NEW WorkflowRun (with `ancestorRunId` pointing to the original)
   * rather than mutating the terminal record. This preserves the audit chain:
   *
   *   - The failed/cancelled run stays permanently queryable as history.
   *   - A terminal run is NEVER mutated — it is the ground truth of what
   *     happened before the retry, with its own completedAt/error.
   *   - Two calls to `retryRun(id)` can produce parallel retry attempts
   *     (different new run ids, same ancestorRunId).
   *
   * Stage runs from the failed ancestor that SUCCEEDED are copied into the
   * new run as `completed` (skip re-burning tokens for work that worked).
   * Failed/pending stages in the ancestor start fresh in the new run.
   *
   * Returns the new run (not the original). The caller may immediately call
   * `startRun(newRun.id)` or let the user kick it off.
   */
  async retryRun(runId: string): Promise<WorkflowRun> {
    return withSpan('core.workflow', 'workflow.retryRun', async (span) => {
      span.setAttribute('workflow.run_id', runId);

      const ancestor = await this.runRepo.getById(runId);
      if (ancestor.status !== 'failed' && ancestor.status !== 'cancelled') {
        throw new Error(
          `Cannot retry run ${runId}: current status is '${ancestor.status}', expected 'failed' or 'cancelled'`,
        );
      }

      // Create the new run, inheriting the ancestor's definition + variables —
      // minus the ancestor's EXECUTION CONTEXT. `startRun` only provisions a
      // workspace/worktree when `__workingDirectory`/`__artifactsDirectory`
      // are absent, so inheriting them verbatim made every retry run in the
      // failed run's dirty directory, inside a worktree whose `ownerId` still
      // pointed at the terminal ancestor (which the worktree reaper then
      // judged orphaned while the retry was still using it). A retry gets a
      // fresh workspace; the ancestor's pinned definition version is carried so
      // the copied stage results below refer to the DAG they were produced by.
      const { variables: inheritedVars, dropped } = stripExecutionContext(ancestor.variables ?? {});
      if (dropped.length > 0) {
        this.logger?.info(
          `[WorkflowRunService] Retry of run ${runId}: dropped inherited execution context ` +
            `(${dropped.join(', ')}) so the retry provisions a fresh workspace`,
        );
      }
      // The ancestor's user variables are re-validated; its remaining engine
      // state (project tag, trigger, stage overrides) is carried as is.
      const userVars: Record<string, unknown> = {};
      const engineState: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(inheritedVars)) {
        (FORBIDDEN_VARIABLE_NAME_PATTERN.test(k) ? engineState : userVars)[k] = v;
      }
      const newRun = await this.materializeRun(
        {
          workflowDefinitionId: ancestor.workflowDefinitionId,
          variables: userVars,
          ancestorRunId: runId,
          definitionVersionId: ancestor.definitionVersionId,
        },
        engineState,
      );

      // Copy completed/skipped stage runs from the ancestor into the new run so
      // the DAG scheduler does not re-execute work that already succeeded —
      // WITH their results. Copying only the status left every downstream
      // stage of the retry seeing "completed" predecessors with no summary,
      // no output and no structured data, i.e. running with no context at
      // all, which discarded the very work the retry was meant to preserve.
      const ancestorStageRuns = await this.stageRunRepo.getByRunId(runId);
      const newStageRuns = await this.stageRunRepo.getByRunId(newRun.id);
      const newRunByKey = new Map(newStageRuns.map((s) => [s.stageKey, s]));
      for (const sr of ancestorStageRuns) {
        if (sr.status !== 'completed' && sr.status !== 'skipped') continue;
        // An unreachable successor may become reachable after its predecessor
        // succeeds on retry. Re-evaluate it instead of freezing the old skip.
        // Explicit operator/runtime skips retain their existing behavior.
        if (sr.status === 'skipped' && sr.error === UNREACHABLE_STAGE_MESSAGE) continue;
        const newSr = newRunByKey.get(sr.stageKey);
        if (!newSr) continue;
        await this.stageRunRepo.update(newSr.id, {
          status: sr.status,
          summary: sr.summary,
          outputText: sr.outputText,
          outputData: sr.outputData,
          artifactManifest: sr.artifactManifest,
          error: sr.status === 'skipped' ? sr.error : undefined,
          startedAt: sr.startedAt,
          completedAt: sr.completedAt ?? new Date(),
        });
      }

      await this.eventBus.emitGlobal({
        kind: 'workflow_run.retried',
        data: { workflowRunId: newRun.id, ancestorRunId: runId },
      });

      return newRun;
    });
  }

  /**
   * Start a workflow run — validate DAG and schedule root stages.
   */
  async startRun(runId: string): Promise<void> {
    return withSpan('core.workflow', 'workflow.startRun', async (span) => {
      span.setAttribute('workflow.run_id', runId);
      activeRuns.add(1);

    const run = await this.runRepo.getById(runId);
    const sm = new WorkflowRunStateMachine(run.status);

    const graph = await this.definitions.get(run.definitionVersionId);
    const workflow = graph.workflow;

    // Set up per-run workspace and artifacts directories if not already set
    if (!run.variables?.['__workingDirectory'] || !run.variables?.['__artifactsDirectory']) {
      const projectId = workflow.projectId ?? undefined;
      const workspace = await this.workspaceManager.createWorkspace({
        ownerType: 'workflow_run',
        ownerId: runId,
        projectId,
        useWorktree: workflow.lifecycle.useWorktree,
        gitEnabled: true,
        stageSystemArtifacts: true,
        stageProjectArtifacts: !!projectId,
        // The workflow session's browser config, so the built-in browser
        // tools honour visibility, evalAllowed and allowedHosts on the first
        // invocation.
        ...(workflow.session.browser
          ? { browserConfig: workflow.session.browser as Record<string, unknown> }
          : {}),
      });
      const workspaceId = workspace.id;
      const workspaceRootPath = workspace.rootPath;

      let updatedVars: Record<string, unknown> = {
        ...(run.variables ?? {}),
        __workingDirectory: this.workspaceManager.getWorkingDirectory(workspace),
        __artifactsDirectory: path.join(workspace.rootPath, 'artifacts'),
        __workflowRunId: runId,
        __workspaceId: workspaceId,
      };

      // ── Worktree creation for project-linked workflows ──
      // NOTE: For ORCHESTRATED runs the WorkflowOrchestrator performs the
      // (richer) clone + worktree setup itself and pre-populates
      // __workingDirectory / __artifactsDirectory, so the enclosing `if`
      // guard above skips this entire branch. This path therefore only runs
      // for direct (PATH B) runs — scripts, automations, retries, and plain
      // definition runs — keeping a single, encapsulated worktree-setup helper
      // rather than duplicating the orchestrator's logic inline.
      updatedVars = await this.setupProjectWorktrees(
        run,
        graph,
        runId,
        workspaceRootPath,
        updatedVars,
      );

      await this.runRepo.update(runId, { variables: updatedVars, workspaceId });
      run.variables = updatedVars;
    }

    sm.transition('sys:start');
    // Set startedAt only on first start — not on resume after crash recovery
    const updateFields: Record<string, unknown> = { status: 'starting' };
    if (!run.startedAt) {
      updateFields['startedAt'] = new Date();
    }
    await this.runRepo.update(runId, updateFields);

    await this.eventBus.emitGlobal({
      kind: 'workflow_run.starting',
      data: { workflowRunId: runId },
    });

    // ── Workflow Hook: on_run_start ──
    // Fires once per run after workspace setup completes and before
    // DAG build / root stage scheduling.
    await this.executeWorkflowHooks('on_run_start', workflow.hooks, runId, run.workflowDefinitionId);

    // The DAG of the run's pinned definition version.
    await this.dagScheduler.buildDAGForRun(run);

    // Every stage runs in its own fresh session (v2 `sessionReuse: 'fresh'`);
    // shared sessions arrive with session groups in the engine upgrade (P03).

    sm.transition('sys:dag_ready');
    await this.runRepo.updateStatus(runId, 'running');

    await this.eventBus.emitGlobal({
      kind: 'workflow_run.running',
      data: { workflowRunId: runId },
    });

    // ── Event-driven DAG routing (primary) ──
    // Subscribe to stage_run.completed / stage_run.failed so the DAG advances
    // immediately when a stage finishes, instead of waiting up to the poll
    // interval. The handlers (onStageCompleted/onStageFailed) are idempotent
    // (de-duplicated via processedStageRuns), so this co-exists safely with
    // the polling backstop below. Subscribed BEFORE the first launch so a
    // stage that finishes instantly cannot emit into the void.
    this.subscribeRunEvents(runId);

    // Start polling as a BACKSTOP: the executeStage promise is fire-and-forget
    // and may never settle (e.g., session release hangs), and an event may be
    // missed if a subscriber throws. Polling guarantees eventual progress and
    // reaps stages whose heartbeat has gone stale.
    this.startPolling(runId);

    // Launch the roots. Same reconcile every later stage event takes: a root
    // with a false `guard` is skipped rather than launched, and an operator
    // skip override is honoured exactly as it is downstream.
    await this.advanceRun(runId);
    });
  }

  /**
   * Create git worktrees for a project-linked workflow run (direct PATH B
   * runs only — orchestrated runs set up worktrees in the orchestrator).
   * Records each checkout in the run state (read back as
   * `run.codebases.<alias>`) and points __workingDirectory at the first.
   * Non-fatal on error.
   */
  private async setupProjectWorktrees(
    run: WorkflowRun,
    graph: WorkflowGraph,
    runId: string,
    workspaceRootPath: string | undefined,
    updatedVars: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const projectId = (run.variables?.['__projectId'] as string | undefined) ?? graph.workflow.projectId ?? undefined;
    if (!projectId || !this.worktreeService || !this.codebaseRepo) return updatedVars;

    try {
      // The definition's codebase selection, else every ready project codebase
      let selectedAliases: string[] = [];
      const codebaseAliases = graph.workflow.lifecycle.codebaseAliases;
      if (codebaseAliases?.length) {
        selectedAliases = codebaseAliases;
      } else {
        // Fall back to ALL ready codebases in the project
        const codebases = await this.codebaseRepo.getByProjectId(projectId);
        selectedAliases = codebases.filter((cb) => cb.status === 'ready').map((cb) => cb.alias);
      }

      if (selectedAliases.length > 0) {
        // Place worktrees in workspace source/ dir when available
        const targetDir = workspaceRootPath ? path.join(workspaceRootPath, 'source') : undefined;
        const worktreeInfos = await this.worktreeService.createRunWorktrees(
          projectId,
          runId,
          selectedAliases,
          'workflow',
          targetDir,
        );

        for (const wt of worktreeInfos) {
          const alias = path.basename(wt.worktreePath);
          updatedVars[`repo_path_${alias}`] = wt.worktreePath;
          updatedVars[`repo_branch_${alias}`] = wt.branchName;
        }

        if (worktreeInfos.length > 0) {
          const primaryWorktree = worktreeInfos[0]!;
          updatedVars['__workingDirectory'] = primaryWorktree.worktreePath;
          this.logger?.info(`[WorkflowRunService] Created ${worktreeInfos.length} worktrees, workingDir=${primaryWorktree.worktreePath}`);
        }
      }
    } catch (err) {
      this.logger?.warn(`[WorkflowRunService] Worktree creation failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
    return updatedVars;
  }

  /**
   * Subscribe to stage terminal events for a run and route them through the
   * idempotent DAG handlers. Idempotent: a second call for the same run is a
   * no-op. Cleaned up via unsubscribeRunEvents on terminal state.
   */
  private subscribeRunEvents(runId: string): void {
    if (this.eventUnsubscribers.has(runId)) return;
    const unsub = this.eventBus.subscribeGlobal((event) => {
      const data = (event as { data?: Record<string, unknown> }).data;
      if (!data || data['workflowRunId'] !== runId) return;
      const stageRunId = typeof data['stageRunId'] === 'string' ? data['stageRunId'] : undefined;
      if (!stageRunId) return;
      if (event.kind === 'stage_run.completed') {
        this.onStageCompleted(runId, stageRunId).catch(() => {/* polling backstop */});
      } else if (event.kind === 'stage_run.failed') {
        const errMsg = typeof data['error'] === 'string' ? data['error'] : 'Stage failed';
        this.onStageFailed(runId, stageRunId, new Error(errMsg)).catch(() => {/* polling backstop */});
      }
    });
    this.eventUnsubscribers.set(runId, unsub);
  }

  /** Tear down the per-run event subscription (terminal states only). */
  private unsubscribeRunEvents(runId: string): void {
    const unsub = this.eventUnsubscribers.get(runId);
    if (unsub) {
      unsub();
      this.eventUnsubscribers.delete(runId);
    }
  }

  /** Drop processed-stage dedup keys for a finished run (prevents unbounded growth). */
  private async pruneProcessedForRun(runId: string): Promise<void> {
    try {
      const stageRuns = await this.stageRunRepo.getByRunId(runId);
      for (const sr of stageRuns) {
        // Keys are now retry-indexed (`completed:<id>:<retryCount>`); drop the
        // entire range of possible retry counts up to the stage's current count
        // plus a small headroom for races where a late retry bump arrives after
        // pruning starts.
        for (let r = 0; r <= sr.retryCount + 2; r++) {
          this.processedStageRuns.delete(`completed:${sr.id}:${r}`);
          this.processedStageRuns.delete(`failed:${sr.id}:${r}`);
        }
      }
    } catch {/* best-effort cleanup */}
  }

  /**
   * W18 / P1-18 — register a run with the process-wide reconciler.
   *
   * Replaces the previous per-run `setInterval`: instead of N intervals, we
   * have one that iterates over all active runs.
   */
  private startPolling(runId: string): void {
    if (this.activeRunIds.has(runId)) return;
    this.activeRunIds.add(runId);
    this.ensureReconciler();
  }

  /**
   * W18 / P1-18 — deregister a run from the process-wide reconciler.
   * Stops the reconciler when the last active run is removed.
   */
  private stopPolling(runId: string): void {
    this.activeRunIds.delete(runId);
    this.pollInFlight.delete(runId);
    if (this.activeRunIds.size === 0) {
      this.stopReconciler();
    }
  }

  /**
   * W18 / P1-18 — start the global reconciler if not already running.
   *
   * The reconciler ticks every 3 s and drives all active runs forward.
   * Each run is processed non-reentrantly via `pollInFlight`. The reconciler
   * uses `interval.unref()` so it does not keep the event loop alive after
   * graceful shutdown drains the active set.
   */
  private ensureReconciler(): void {
    if (this.reconcilerInterval !== undefined) return;
    const interval = setInterval(async () => {
      // Snapshot the active set so mutations during the tick don't cause
      // iteration issues (a run may be stopped while we are iterating).
      const runIds = [...this.activeRunIds];
      for (const runId of runIds) {
        // Non-reentrant: skip this run if its previous tick is still running.
        // A tick can take longer than the interval (validation + retry backoff)
        // and overlapping ticks could otherwise double-process a stage during
        // the validation-retry window.
        if (this.pollInFlight.has(runId)) continue;
        this.pollInFlight.add(runId);
        void (async () => {
          try {
            const run = await this.runRepo.getById(runId);
            if (run.status !== 'running') {
              this.stopPolling(runId);
              return;
            }
            // Find stages that completed/failed but haven't been processed,
            // and stages whose executor has stopped beating.
            const now = Date.now();
            const stageRuns = await this.stageRunRepo.getByRunId(runId);
            for (const sr of stageRuns) {
              if (sr.status === 'completed') {
                await this.onStageCompleted(runId, sr.id);
              } else if (sr.status === 'failed') {
                await this.onStageFailed(runId, sr.id, new Error(sr.error ?? 'Stage failed'));
              } else if (
                (sr.status === 'running' || sr.status === 'queued') &&
                this.isHeartbeatStale(sr, now)
              ) {
                await this.failStaleStage(runId, sr, now);
              }
            }
            // WS-D1 — a pending stage can become launchable or unreachable
            // without any stage event reaching us (a subscriber threw, or a
            // completion landed while this run was not yet subscribed). The
            // reconcile is idempotent (launches are claimed atomically), so
            // running it from the backstop is how "eventual progress" is
            // actually guaranteed rather than assumed.
            if (stageRuns.some((sr) => sr.status === 'pending')) {
              await this.advanceRun(runId);
            }
          } catch (err) {
            // Keep the reconciler running, but never silently.
            this.logger?.warn(
              `[WorkflowRunService] Reconciler tick failed for run ${runId}: ` +
                `${err instanceof Error ? err.message : String(err)}`,
            );
          } finally {
            this.pollInFlight.delete(runId);
          }
        })();
      }
    }, this.heartbeatPolicy.reconcileIntervalMs);
    // Shutdown drains runs explicitly; the reconciler must not keep the
    // event loop alive after that has happened.
    interval.unref?.();
    this.reconcilerInterval = interval;
  }

  /** Stop the process-wide reconciler. Called when no runs are active. */
  private stopReconciler(): void {
    if (this.reconcilerInterval !== undefined) {
      clearInterval(this.reconcilerInterval);
      this.reconcilerInterval = undefined;
    }
  }

  /**
   * Release all in-memory resources for graceful shutdown: stop every run's
   * poll loop, unsubscribe its EventBus listeners, and close its run logger.
   * Without this, `setInterval` handles and EventBus subscriptions are
   * orphaned on SIGTERM (memory leak + a process that won't exit cleanly).
   * The DB remains the source of truth, so in-flight runs resume on next boot
   * via StartupRecoveryService. Idempotent.
   */
  shutdown(): void {
    // W18 / P1-18 — stop the single process-wide reconciler (was: N per-run intervals)
    this.stopReconciler();
    this.activeRunIds.clear();
    this.pollInFlight.clear();

    for (const unsub of this.eventUnsubscribers.values()) {
      try {
        unsub();
      } catch {
        /* best-effort */
      }
    }
    this.eventUnsubscribers.clear();
  }

  /**
   * Pause a running workflow — cascades to all running stages.
   */
  async pauseRun(runId: string): Promise<void> {
    const run = await this.runRepo.getById(runId);
    if (run.status !== 'running') return;

    await this.runRepo.updateStatus(runId, 'paused');

    // Pause all running stage runs
    const stageRuns = await this.stageRunRepo.getByStatus(runId, ['running']);
    for (const sr of stageRuns) {
      await this.stageExecutionService.pauseStage(sr.id);
    }

    await this.eventBus.emitGlobal({
      kind: 'workflow_run.paused',
      data: { workflowRunId: runId },
    });
  }

  /**
   * Resume a paused workflow — cascades to all paused stages.
   */
  async resumeRun(runId: string): Promise<void> {
    const run = await this.runRepo.getById(runId);
    if (run.status !== 'paused') return;

    await this.runRepo.updateStatus(runId, 'running');

    // Resume all paused stage runs.
    // BUGFIX: pass run.variables (and workflow harness config + predecessor
    // summaries) through resumeStage so multi-prompt stages keep their
    // `{{var}}` interpolation across pause-resume cycles.
    const stageRuns = await this.stageRunRepo.getByStatus(runId, ['paused']);
    const graph = stageRuns.length > 0 ? await this.definitions.get(run.definitionVersionId) : null;
    const dag = stageRuns.length > 0
      ? await this.dagScheduler.buildDAGForRun(run)
      : null;
    const allStageRuns = stageRuns.length > 0
      ? await this.stageRunRepo.getByRunId(runId)
      : [];
    for (const sr of stageRuns) {
      const predecessorSummaries = dag
        ? this.gatherPredecessorSummaries(sr.stageKey, dag, allStageRuns)
        : undefined;
      this.stageExecutionService
        .resumeStage(
          sr.id,
          runId,
          run.sessionMode,
          graph?.workflow.session,
          run.variables,
          predecessorSummaries,
        )
        .catch(() => {/* handled by polling */});
    }

    // Restart event-driven routing + polling backstop for the resumed run
    this.subscribeRunEvents(runId);
    this.startPolling(runId);

    await this.eventBus.emitGlobal({
      kind: 'workflow_run.resumed',
      data: { workflowRunId: runId },
    });
  }

  /**
   * Cancel a running workflow — cascades abort+destroy to all non-terminal stages.
   */
  async cancelRun(runId: string): Promise<void> {
    return withSpan('core.workflow', 'workflow.cancelRun', async (span) => {
      span.setAttribute('workflow.run_id', runId);

    const run = await this.runRepo.getById(runId);
    if (run.status !== 'running' && run.status !== 'paused') return;

    this.stopPolling(runId);
    this.unsubscribeRunEvents(runId);
    await this.pruneProcessedForRun(runId);
    activeRuns.add(-1);

    await this.runRepo.updateStatus(runId, 'cancelling');

    await this.eventBus.emitGlobal({
      kind: 'workflow_run.cancelling',
      data: { workflowRunId: runId },
    });

    // Cancel all non-terminal stage runs
    const stageRuns = await this.stageRunRepo.getByRunId(runId);
    for (const sr of stageRuns) {
      if (sr.status === 'running' || sr.status === 'paused' || sr.status === 'queued' || sr.status === 'pending') {
        await this.stageExecutionService.cancelStage(sr.id);
      }
    }

    // Release all sessions
    await this.sessionAllocator.releaseAll(runId);

    await this.runRepo.updateStatus(runId, 'cancelled');
    await this.runRepo.update(runId, { completedAt: new Date() });

    // Mark workspace as completed on cancellation
    await this.completeWorkspaceForRun(runId);

    // ── Workflow Hook: on_run_cancelled ──
    const graph = await this.definitions.get(run.definitionVersionId);
    await this.executeWorkflowHooks('on_run_cancelled', graph.workflow.hooks, runId, run.workflowDefinitionId);

    await this.eventBus.emitGlobal({
      kind: 'workflow_run.cancelled',
      data: { workflowRunId: runId },
    });
    });
  }

  /**
   * HITL — change the permission mode on a live run.
   *
   * Default is 'bypassPermissions' (auto-approve everything) so runs
   * never block unless a user has explicitly switched. Valid transitions
   * are any → any — an operator might start in `plan` mode to review,
   * then flip to `bypassPermissions` once they've approved a few tool
   * calls and trust the agent. Emits `workflow_run.permission_mode_changed`.
   */
  async setPermissionMode(
    runId: string,
    mode: 'bypassPermissions' | 'default' | 'acceptEdits' | 'plan',
  ): Promise<void> {
    const run = await this.runRepo.getById(runId);
    const previous = run.permissionMode ?? 'bypassPermissions';
    if (previous === mode) return; // no-op
    await this.runRepo.update(runId, { permissionMode: mode });
    await this.eventBus.emitGlobal({
      kind: 'workflow_run.permission_mode_changed',
      data: { workflowRunId: runId, mode, previous },
    });
  }

  /** HITL — read the active permission mode; NULL columns read as the default. */
  async getPermissionMode(
    runId: string,
  ): Promise<'bypassPermissions' | 'default' | 'acceptEdits' | 'plan'> {
    const run = await this.runRepo.getById(runId);
    return run.permissionMode ?? 'bypassPermissions';
  }

  /**
   * Delete a workflow run — cancel if running, then remove all records.
   */
  async deleteRun(runId: string): Promise<void> {
    const run = await this.runRepo.getById(runId);

    // Cancel if still active (cancelRun also prunes dedup state + subscriptions)
    if (run.status === 'running' || run.status === 'paused' || run.status === 'starting') {
      await this.cancelRun(runId);
    } else {
      // Terminal run — still drop any lingering in-memory bookkeeping.
      this.stopPolling(runId);
      this.unsubscribeRunEvents(runId);
      await this.pruneProcessedForRun(runId);
    }

    // Delete all stage runs then the run itself
    await this.stageRunRepo.deleteByRunId(runId);
    await this.runRepo.delete(runId);
  }

  /**
   * Handle stage completion — schedule next stages or complete the run.
   */
  async onStageCompleted(runId: string, stageRunId: string): Promise<void> {
    // BUGFIX (convergence-stall on retry): include retryCount so a stage's
    // post-retry completion is not silently deduped by its first attempt's key.
    // The internal `retryStage` path (SDK error → retry) used to bump
    // retryCount but the dedup key stayed `completed:<id>`, so the second
    // completion was dropped and downstream stages never got scheduled.
    const stageRunForKey = await this.stageRunRepo.getById(stageRunId);
    const key = `completed:${stageRunId}:${stageRunForKey.retryCount}`;
    if (this.processedStageRuns.has(key)) return;
    this.processedStageRuns.add(key);

    const run = await this.runRepo.getById(runId);
    if (run.status !== 'running') return;

    const stageRun = stageRunForKey;

    // ── Result validation (single owner) ──
    // WorkflowRunService is the sole validator of a stage's `output.rules`
    // (workflow-level validations were folded into them by migration v55).
    // The WorkflowOrchestrator does not validate.
    //
    // On failure: bridge to retry when retries remain, else escalate through
    // onStageFailed so on_failure / on_completion edges route correctly.
    // The dedup key is NOT deleted here — retryStageAfterValidation flips the
    // stage status away from 'completed' *before* its backoff and resets the
    // dedup key itself, closing the window where an overlapping poll tick
    // could re-process the same completion.
    //
    // A stage that never ran has nothing to validate. `skipStageByOverride`
    // routes through here to advance the DAG, and without this guard the
    // rules were evaluated against a stage with no output at all: they
    // failed, the failure triggered a retry, and the retry EXECUTED the very
    // stage the operator had asked to skip — which then failed the run.
    if (this.resultValidator && stageRun.status !== 'skipped' && stageRun.status !== 'cancelled') {
      const stage = await this.definitions.stage(run.definitionVersionId, stageRun.stageKey);
      const rules = stage.output.rules;
      if (rules.length > 0) {
        try {
          const workspacePath =
            typeof run.variables?.['__workingDirectory'] === 'string'
              ? (run.variables['__workingDirectory'] as string)
              : undefined;
          const validation = await this.resultValidator.validateStageResult(
            runId,
            stageRunId,
            { stageKey: stage.key, rules },
            workspacePath,
          );
          if (!validation.passed) {
            const { maxRetries } = retryNumbers(stage);
            const attempt = stageRun.retryCount + 1;
            const failureMsg = validation.failures.join('; ');
            if (stageRun.retryCount < maxRetries) {
              this.logger?.info?.(
                `[WorkflowRunService] Validation failed for stage "${stageRun.name}" ` +
                `(attempt ${attempt}/${maxRetries + 1}). Triggering validation retry.`,
              );
              await this.retryStageAfterValidation(
                runId,
                stageRunId,
                `Validation failed: ${failureMsg}`,
              );
              return; // retry will re-emit stage_run.completed
            }
            // Retries exhausted (or no retry policy) — escalate to failure so
            // failure / completion edges route correctly.
            this.logger?.error?.(
              `[WorkflowRunService] Validation failed for stage "${stageRun.name}" ` +
              `with no retries remaining. Marking failed and routing on_failure edges.`,
            );
            await this.onStageFailed(
              runId,
              stageRunId,
              new Error(`Validation failed after ${attempt} attempt(s): ${failureMsg}`),
            );
            return;
          }
        } catch (err) {
          this.logger?.warn?.(
            `[WorkflowRunService] Result validation threw for stage "${stageRun.name}": ` +
            `${err instanceof Error ? err.message : String(err)}`,
          );
        }
        // Validation is done with this stage (it passed, or it threw and we
        // carried on). `StageExecutionService` deliberately holds the session
        // open until here so an in-session retry has a conversation to talk
        // to — release it now, or a per-stage session lingers until the run
        // ends. Both the retry paths above return before reaching this line
        // and manage the session themselves.
        if (run.sessionMode === 'per-stage' || run.sessionMode === 'auto') {
          await this.sessionAllocator.releaseSession(stageRunId).catch(() => {
            /* non-fatal: run teardown releases whatever is left */
          });
        }
      }
    }

    // HOOK-1: fire workflow-level `on_stage_completed` hooks (previously a
    // dormant phase with no firing site). Non-fatal; guarded so we only touch
    // the definition when a hook executor + hooks actually exist.
    if (this.hookExecutor) {
      const graph = await this.definitions.get(run.definitionVersionId);
      await this.executeWorkflowHooks('on_stage_completed', graph.workflow.hooks, runId, run.workflowDefinitionId);
    }

    // Launch / skip / finalize — the one reconcile.
    await this.advanceRun(runId);
  }

  /**
   * Handle stage failure.
   */
  async onStageFailed(runId: string, stageRunId: string, error: unknown): Promise<void> {
    // BUGFIX (see onStageCompleted): retryCount-aware dedup so a stage failure
    // after retry is processed correctly even if a prior attempt's failure key
    // is still present.
    const stageRunForKey = await this.stageRunRepo.getById(stageRunId);
    const key = `failed:${stageRunId}:${stageRunForKey.retryCount}`;
    if (this.processedStageRuns.has(key)) return;
    this.processedStageRuns.add(key);

    const run = await this.runRepo.getById(runId);
    if (run.status !== 'running') return;

    const stageRun = stageRunForKey;
    const errorMsg = error instanceof Error ? error.message : String(error);

    // Update stage run if not already failed
    if (stageRun.status !== 'failed') {
      await this.stageRunRepo.update(stageRunId, {
        status: 'failed',
        error: errorMsg,
        completedAt: new Date(),
      });
    }

    // A stage whose session was held open for a possible in-session
    // validation retry has now failed terminally — nothing else will use that
    // conversation, so release it here rather than leaving it to run teardown.
    if (run.sessionMode === 'per-stage' || run.sessionMode === 'auto') {
      await this.sessionAllocator.releaseSession(stageRunId).catch(() => {
        /* non-fatal: run teardown releases whatever is left */
      });
    }

    // HOOK-1: fire workflow-level `on_stage_failed` hooks (previously dormant).
    if (this.hookExecutor) {
      const graph = await this.definitions.get(run.definitionVersionId);
      await this.executeWorkflowHooks('on_stage_failed', graph.workflow.hooks, runId, run.workflowDefinitionId);
    }

    // Launch / skip / finalize — the SAME reconcile and the SAME dispatch loop
    // as onStageCompleted. Operator skip overrides are therefore honoured on
    // failure branches too; the old separate failure loop launched every
    // `on_failure` target unconditionally, precisely where a human was
    // hand-steering a broken run.
    await this.advanceRun(runId);
  }

  /**
   * WS-D1 — the single place the run moves forward. Called after every stage
   * event, from the reconciler backstop, from crash re-drive and from run
   * start. One reconcile answers what to launch, what is unreachable and
   * whether the run is done; this method persists the skips, dispatches the
   * launches (honouring operator overrides and fan-in hooks) and finalizes.
   *
   * Safe to call concurrently: skips only touch rows still `pending`, launches
   * go through the atomic DUR-06 claim, and finalization re-reads the run.
   */
  private async advanceRun(runId: string): Promise<void> {
    const run = await this.runRepo.getById(runId);
    if (run.status !== 'running') return;

    const { toLaunch, toSkip, runTerminal } = await this.dagScheduler.reconcileRun(runId);
    if (toLaunch.length === 0 && toSkip.length === 0 && !runTerminal) return;

    const allStageRuns = await this.stageRunRepo.getByRunId(runId);
    const byKey = new Map(allStageRuns.map((s) => [s.stageKey, s]));

    // Skips first, so a successor launched below sees final predecessor state.
    for (const key of toSkip) {
      const sr = byKey.get(key);
      if (!sr || sr.status !== 'pending') continue;
      await this.stageRunRepo.update(sr.id, {
        status: 'skipped',
        error: UNREACHABLE_STAGE_MESSAGE,
        completedAt: new Date(),
      });
      sr.status = 'skipped';
      await this.eventBus.emitGlobal({
        kind: 'stage_run.skipped',
        data: { stageRunId: sr.id, workflowRunId: runId, reason: 'unreachable' },
      });
    }

    if (toLaunch.length > 0) {
      const graph = await this.definitions.get(run.definitionVersionId);
      const dag = await this.dagScheduler.buildDAGForRun(run);
      for (const key of toLaunch) {
        const sr = byKey.get(key);
        if (!sr || sr.status !== 'pending') continue;

        // Operator run-time overrides — one check for every branch type.
        const override = this.findStageOverride(run.variables, sr.stageKey);
        if (override?.skip) {
          await this.skipStageByOverride(sr, runId);
          continue;
        }
        const effectiveVars = override?.variables
          ? { ...run.variables, ...override.variables }
          : run.variables;

        // HOOK-1: a stage with more than one predecessor is a parallel fan-in
        // (join) point — fire the `on_parallel_join` phase.
        if (this.hookExecutor) {
          const node = dag.nodes.get(key);
          if (node && node.dependencyIds.length > 1) {
            await this.executeWorkflowHooks('on_parallel_join', graph.workflow.hooks, runId, run.workflowDefinitionId);
          }
        }

        const predecessorSummaries = this.gatherPredecessorSummaries(key, dag, allStageRuns);
        this.launchStage(sr, runId, run.sessionMode, graph.workflow.session, effectiveVars, predecessorSummaries);
      }
    }

    if (runTerminal) await this.finalizeRun(runId, runTerminal);
  }

  /**
   * Transition a run whose every stage is terminal to its final status. The
   * completed / failed / cancelled decision was made by the reconcile
   * (`computeTerminalRunStatusFor`): a failure absorbed by a completed
   * `on_failure`/`on_completion`/`always` branch counts as handled, an
   * unhandled cancelled stage yields `cancelled` rather than `completed`.
   */
  private async finalizeRun(runId: string, finalStatus: TerminalRunStatus): Promise<void> {
    if (finalStatus === 'completed') {
      await this.completeRun(runId);
      return;
    }

    // Re-read status to avoid racing a concurrent completeRun / cancelRun.
    const run = await this.runRepo.getById(runId);
    if (run.status !== 'running') return;

    this.stopPolling(runId);
    this.unsubscribeRunEvents(runId);
    activeRuns.add(-1);

    const stageRuns = await this.stageRunRepo.getByRunId(runId);
    const culprits = stageRuns.filter((sr) => sr.status === finalStatus);
    const describe = (sr: StageRun) => `${sr.name}${sr.error ? ` (${sr.error})` : ''}`;
    const errorMsg =
      culprits.length > 0
        ? `Stage(s) ${finalStatus}: ${culprits.map(describe).join('; ')}`
        : `Workflow run ${finalStatus}`;

    await this.runRepo.update(runId, {
      status: finalStatus,
      error: errorMsg,
      completedAt: new Date(),
    });
    await this.completeWorkspaceForRun(runId);
    await this.pruneProcessedForRun(runId);

    const { workflow } = await this.definitions.get(run.definitionVersionId);
    if (finalStatus === 'failed') {
      await this.executeWorkflowHooks('on_run_failed', workflow.hooks, runId, run.workflowDefinitionId);
      await this.eventBus.emitGlobal({
        kind: 'workflow_run.failed',
        data: { workflowRunId: runId, error: errorMsg },
      });
    } else {
      await this.executeWorkflowHooks('on_run_cancelled', workflow.hooks, runId, run.workflowDefinitionId);
      await this.eventBus.emitGlobal({
        kind: 'workflow_run.cancelled',
        data: { workflowRunId: runId },
      });
    }
  }

  // ── WS-D1: stage liveness ──

  /** A queued/running stage whose last beat is older than the stale window. */
  private isHeartbeatStale(sr: StageRun, now: number): boolean {
    // Only rows the executor has ever beaten on are judged: the first beat is
    // written synchronously at claim time, so a row without one belongs to a
    // pre-heartbeat executor and is left to the crash-recovery path.
    if (!sr.heartbeatAt) return false;
    return now - sr.heartbeatAt.getTime() > this.heartbeatStaleAfterMs;
  }

  /**
   * Fail a stage whose executor stopped beating. Goes through the normal
   * `onStageFailed` so on_failure routing and downstream reconcile behave
   * exactly as for any other failure. The executor is told to abort first
   * (best-effort; it may be in another process or gone) so that a relaunch
   * never runs beside a wedged agent in the same working directory.
   */
  private async failStaleStage(runId: string, sr: StageRun, now: number): Promise<void> {
    const ageSec = Math.round((now - (sr.heartbeatAt?.getTime() ?? now)) / 1000);
    const limitSec = Math.round(this.heartbeatStaleAfterMs / 1000);
    const reason =
      `Stage heartbeat stale: no liveness beat for ${ageSec}s (limit ${limitSec}s) — ` +
      `the executor is hung or its process is gone`;
    this.logger?.warn(`[WorkflowRunService] ${reason} (run ${runId}, stage "${sr.name}" ${sr.id})`);

    const exec = this.stageExecutionService as { abortStage?: (id: string, reason: string) => Promise<void> };
    if (typeof exec.abortStage === 'function') {
      await exec.abortStage(sr.id, reason).catch(() => {/* best-effort */});
    }

    // Persist + announce before routing so the UI sees the failure and its
    // reason even if routing below throws; onStageFailed's own write is then
    // a no-op and its dedup key absorbs the event echo.
    await this.stageRunRepo.update(sr.id, { status: 'failed', error: reason, completedAt: new Date() });
    await this.eventBus.emitGlobal({
      kind: 'stage_run.failed',
      data: { stageRunId: sr.id, workflowRunId: runId, error: reason, name: sr.name },
    });
    await this.onStageFailed(runId, sr.id, new Error(reason));
  }

  // ── Validation-triggered retry ──

  /**
   * Re-execute a stage after post-completion result validation failed.
   *
   * Unlike the catch-block retry inside StageExecutionService (which fires
   * on SDK/execution errors), this path is invoked by the orchestrator's
   * `setupResultValidation` when the output doesn't meet the configured
   * validation rules and the stage still has retries remaining.
   *
   * Strategy: In-session retry first (follow-up prompt in same conversation),
   * then fall back to full session restart on final retry.
   *
   * In-session retry: Keeps the session alive, sends validation feedback as
   * a follow-up prompt so the agent can see its previous output and correct it.
   * This is faster, cheaper, and produces better results than a full restart.
   *
   * Full restart: Releases session, allocates fresh conversation, re-executes
   * all prompts from scratch with __validationFeedback injected.
   */
  async retryStageAfterValidation(
    runId: string,
    stageRunId: string,
    reason: string,
  ): Promise<void> {
    const stageRun = await this.stageRunRepo.getById(stageRunId);
    const run0 = await this.runRepo.getById(runId);
    const stage = await this.definitions.stage(run0.definitionVersionId, stageRun.stageKey);
    const retryPolicy = stage.retry ? retryNumbers(stage) : { maxRetries: 1, backoffMs: 3000, backoffMultiplier: 1 };

    // Determine retry strategy: in-session for first attempts, full restart for final
    // In-session threshold: use in-session retry for all but the last retry attempt
    const inSessionThreshold = Math.max(1, retryPolicy.maxRetries - 1);
    const useInSessionRetry = stageRun.retryCount < inSessionThreshold;

    // ── Close the re-process window (race fix) ──
    // Flip the stage status away from the terminal 'completed'/'failed' state
    // BEFORE the backoff sleep. Otherwise the polling backstop or the event
    // subscription could re-observe this stage as terminal during the (up to
    // several second) backoff and double-process the retry. Only after the
    // status is non-terminal is it safe to clear the dedup keys.
    await this.stageRunRepo.update(stageRunId, {
      status: useInSessionRetry ? 'running' : 'queued',
      error: undefined,
      completedAt: undefined,
      ...(useInSessionRetry ? {} : { currentStep: 0 }),
    });
    // Dedup keys are retry-indexed (`completed:<id>:<retryCount>`); drop the
    // current attempt's key so a re-completion at the same retryCount can be
    // re-processed. The next attempt's key (after incrementRetryCount) is a
    // distinct key, so it doesn't need explicit clearing.
    this.processedStageRuns.delete(`completed:${stageRunId}:${stageRun.retryCount}`);
    this.processedStageRuns.delete(`failed:${stageRunId}:${stageRun.retryCount}`);

    // Backoff before re-execution
    const backoff = retryPolicy.backoffMs * Math.pow(retryPolicy.backoffMultiplier, stageRun.retryCount);
    await new Promise((resolve) => setTimeout(resolve, backoff));

    // Increment retry count
    await this.stageRunRepo.incrementRetryCount(stageRunId);

    await this.eventBus.emitGlobal({
      kind: 'stage_run.retrying',
      data: {
        stageRunId,
        workflowRunId: runId,
        retryCount: stageRun.retryCount + 1,
      },
    });

    const run = await this.runRepo.getById(runId);
    const { workflow } = await this.definitions.get(run.definitionVersionId);
    const updated = await this.stageRunRepo.getById(stageRunId);
    // Enrich variables with validation feedback metadata so template
    // interpolation and downstream hooks can access retry context.
    const enrichedVars = {
      ...(run.variables ?? {}),
      __validationFeedback: reason,
      __validationRetryAttempt: String(updated.retryCount),
    };

    if (useInSessionRetry) {
      // ── In-Session Retry ──
      // Keep the session alive, send validation feedback as follow-up prompt.
      // The agent sees its own previous output + what went wrong → can fix it.
      this.stageExecutionService
        .retryInSession(updated, runId, reason, workflow.session, enrichedVars)
        .catch((err) => {
          this.onStageFailed(runId, stageRunId, err).catch(() => {/* swallow */});
        });
    } else {
      // ── Full Restart ──
      // Release old session so a fresh one is allocated, then re-execute from
      // scratch with validation feedback injected into variables.
      await this.sessionAllocator.releaseSession(stageRunId);
      this.stageExecutionService
        .executeStage(updated, runId, run.sessionMode, workflow.session, enrichedVars)
        .catch((err) => {
          this.onStageFailed(runId, stageRunId, err).catch(() => {/* swallow */});
        });
    }
  }

  // ── Private Helpers ──

  private async completeRun(runId: string): Promise<void> {
    this.stopPolling(runId);
    this.unsubscribeRunEvents(runId);
    await this.pruneProcessedForRun(runId);
    activeRuns.add(-1);

    const run = await this.runRepo.getById(runId);

    await this.runRepo.update(runId, {
      status: 'completed',
      completedAt: new Date(),
    });

    // Release all sessions
    await this.sessionAllocator.releaseAll(runId);

    // Mark workspace as completed (auto-commits final state)
    await this.completeWorkspaceForRun(runId);

    // ── Workflow Hook: on_run_complete ──
    const { workflow } = await this.definitions.get(run.definitionVersionId);
    await this.executeWorkflowHooks('on_run_complete', workflow.hooks, runId, run.workflowDefinitionId);

    await this.eventBus.emitGlobal({
      kind: 'workflow_run.completed',
      data: { workflowRunId: runId },
    });
  }

  /**
   * Mark the workspace as completed for a finished run (success, failure, or cancel).
   */
  private async completeWorkspaceForRun(runId: string): Promise<void> {
    try {
      const run = await this.runRepo.getById(runId);
      const workspaceId = run.workspaceId ?? (run.variables?.['__workspaceId'] as string | undefined);
      if (workspaceId) {
        await this.workspaceManager.completeWorkspace(workspaceId);
      }
    } catch (err) {
      this.logger?.warn?.(`[WorkflowRunService] Failed to complete workspace for run ${runId}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Gather the context a stage receives from upstream stages (its
   * `context`), especially at convergence points where parallel branches
   * merge:
   * 1. `context.mode: 'none'` → no context;
   * 2. `context.from` → those stages, by key (completed ones only);
   * 3. otherwise → the direct DAG predecessors.
   */
  private gatherPredecessorSummaries(
    stageKey: string,
    dag: DAG,
    allStageRuns: StageRun[],
  ): Array<{ stageName: string; summary: string; outputData?: Record<string, unknown>; fullOutput?: string }> {
    const node = dag.nodes.get(stageKey);
    if (!node) return [];

    const context = node.stage.context;
    const summaries: Array<{ stageName: string; summary: string; outputData?: Record<string, unknown>; fullOutput?: string }> = [];
    if (context.mode === 'none') return [];

    // Determine which stages to pull context from
    let sourceStageRuns: StageRun[];

    if (context.from !== undefined) {
      sourceStageRuns = context.from
        .map((key) => allStageRuns.find((sr) => sr.stageKey === key))
        .filter((sr): sr is StageRun => sr !== undefined && sr.status === 'completed');
    } else {
      sourceStageRuns = node.dependencyIds
        .map((predKey) => allStageRuns.find((sr) => sr.stageKey === predKey))
        .filter((sr): sr is StageRun => sr !== undefined);
    }

    for (const predRun of sourceStageRuns) {
      // X-25 — prefer the DURABLE result channel over the `outputText` column.
      //
      // `entries.kind='artifact'` was created for exactly this and had zero
      // readers; the successor's context came from a column written once at
      // the end of the predecessor. The artifact is appended per turn inside
      // the effect sandwich, so it holds every turn's contribution even when
      // the predecessor was interrupted and resumed — which is precisely the
      // case where the single final column write is missing or stale. Falls
      // back to the column when no artifact exists (no durable engine wired,
      // or a stage that ran before this change).
      const durableOutput = this.durableEngine
        ?.getArtifact({ scope: 'stage_run', scopeId: predRun.id }, STAGE_OUTPUT_ARTIFACT)
        ?.text;
      const fullOutput =
        durableOutput && durableOutput.trim().length > 0 ? durableOutput : predRun.outputText;

      // Include a predecessor when it has EITHER a summary or captured full
      // output (HANDOFF-1) — a `context.mode: 'output'` successor needs the
      // output even if summary generation produced nothing.
      if (predRun.summary || fullOutput) {
        summaries.push({
          stageName: predRun.name,
          summary: predRun.summary ?? '',
          outputData: predRun.outputData,
          fullOutput,
        });
      }
    }
    return summaries;
  }

  /**
   * The runtime override for a stage, matched by stage KEY (names and
   * positions change; keys do not). Overrides ride in the run's
   * `__stageOverrides` engine state (from the typed `stageOverrides` of the start request).
   */
  private findStageOverride(
    variables: Record<string, unknown> | undefined,
    stageKey: string,
  ): { skip?: boolean; variables?: Record<string, unknown> } | undefined {
    const overrides = variables?.['__stageOverrides'] as Array<{
      stageKey?: string;
      skip?: boolean;
      variables?: Record<string, unknown>;
    }> | undefined;

    if (!overrides || !Array.isArray(overrides)) return undefined;
    return overrides.find((o) => o.stageKey === stageKey);
  }

  /**
   * Skip a stage due to a runtime override (not DAG condition).
   */
  private async skipStageByOverride(stageRun: StageRun, runId: string): Promise<void> {
    await this.stageRunRepo.update(stageRun.id, {
      status: 'skipped',
      // The reason rode only on the SSE event, so the run page had nothing to
      // read afterwards and labelled every skip "Condition not met" — wrong,
      // and misleading, for a stage an operator deliberately skipped.
      // `error` is only surfaced for failed stages, so it is free here.
      error: 'Skipped by run-time stage override',
      completedAt: new Date(),
    });

    await this.eventBus.emitGlobal({
      kind: 'stage_run.skipped',
      data: {
        stageRunId: stageRun.id,
        workflowRunId: runId,
        reason: 'runtime_override',
      },
    });

    this.logger?.info(`[WorkflowRunService] Stage "${stageRun.name}" skipped by runtime override`);

    // Trigger onStageCompleted so DAG advances past the skipped stage
    await this.onStageCompleted(runId, stageRun.id);
  }
}
