// ────────────────────────────────────────────────────────────────
// WorkflowRunService — workflow run lifecycle management (v2)
// Orchestrates DAGScheduler + StageExecutionService.
// ────────────────────────────────────────────────────────────────

import type {
  WorkflowRun,
  WorkflowRunStatus,
  StageRun,
  CreateWorkflowRunParams,
  HarnessConfig,
  ILogger,
} from '@generatorai/shared';
import type { Semaphore } from '../utils/Semaphore.js';
import { generateId, withSpan, getMeter, ValidationError } from '@generatorai/shared';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { RunLogger } from '../events/StreamLogger.js';

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
import type { IStageDefinitionRepository } from '../domain/ports/IStageDefinitionRepository.js';
import type { IWorkflowDefinitionRepository } from '../domain/ports/IWorkflowDefinitionRepository.js';
import type { EventBus } from '../events/EventBus.js';
import type { DAGScheduler } from './DAGScheduler.js';
import type { StageExecutionService } from './StageExecutionService.js';
import type { SessionAllocator } from './SessionAllocator.js';
import type { WorkspaceManager } from './WorkspaceManager.js';
import type { ResultValidator } from './ResultValidator.js';
import type { WorktreeService } from './WorktreeService.js';
import type { IProjectCodebaseRepository } from '../domain/ports/IProjectCodebaseRepository.js';
import type { DAG } from '../domain/dag/types.js';
import { WorkflowRunStateMachine } from '../domain/state-machines/WorkflowRunStateMachine.js';
import type { HookExecutor, HookContext } from './HookExecutor.js';
import type { HookDefinition, WorkflowHookDefinition } from '@generatorai/shared';

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
  /** Per-run event loggers writing JSONL to the artifacts dir */
  private runLoggers = new Map<string, RunLogger>();
  /** Optional hook executor for workflow-level lifecycle hooks */
  private hookExecutor?: HookExecutor;

  constructor(
    private runRepo: IWorkflowRunRepository,
    private stageRunRepo: IStageRunRepository,
    private stageDefRepo: IStageDefinitionRepository,
    private definitionRepo: IWorkflowDefinitionRepository,
    private eventBus: EventBus,
    private dagScheduler: DAGScheduler,
    private stageExecutionService: StageExecutionService,
    private sessionAllocator: SessionAllocator,
    private artifactsDir?: string,
    private logger?: ILogger,
    /**
     * Optional transactional wrapper. When supplied, multi-row writes
     * (create run + N stage runs) are wrapped atomically so a mid-loop
     * failure rolls back the whole set. When omitted (tests), writes run
     * as independent statements.
     */
    private withTransaction?: <T>(fn: () => Promise<T>) => Promise<T>,
    /** Optional workspace manager for unified workspace isolation. */
    private workspaceManager?: WorkspaceManager,
    /** Optional worktree service for codebase isolation. */
    private worktreeService?: WorktreeService,
    /** Optional codebase repository for resolving project codebases. */
    private codebaseRepo?: IProjectCodebaseRepository,
    /**
     * Optional concurrency limiter (P1#7). When supplied, every stage launch
     * acquires a permit before executing, bounding how many harness
     * subprocesses spawn at once so a small self-hosted instance isn't
     * overwhelmed by a wide DAG fan-out. Omitted ⇒ unlimited (tests).
     */
    private stageSemaphore?: Semaphore,
  ) {}

  /** Late-wire workspace manager (set after construction when DI order requires it). */
  setWorkspaceManager(wm: WorkspaceManager): void {
    this.workspaceManager = wm;
  }

  /** Late-wire worktree service (set after construction when DI order requires it). */
  setWorktreeService(wts: WorktreeService, cbRepo: IProjectCodebaseRepository): void {
    this.worktreeService = wts;
    this.codebaseRepo = cbRepo;
  }

  /** Late-wire hook executor for workflow-level lifecycle hooks. */
  setHookExecutor(he: HookExecutor): void {
    this.hookExecutor = he;
  }

  /** Late-wire result validator (so per-stage resultValidation rules can run
   *  in the v2 DAG flow without a hard dependency on WorkflowOrchestrator). */
  setResultValidator(rv: ResultValidator): void {
    this.resultValidator = rv;
  }

  private resultValidator?: ResultValidator;

  /**
   * Execute workflow-level hooks for a given phase. Non-fatal.
   */
  private async executeWorkflowHooks(
    phase: WorkflowHookDefinition['phase'],
    hooks: WorkflowHookDefinition[] | undefined,
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
      };
      await this.hookExecutor.executePhase(
        phase,
        hooks as unknown as HookDefinition[],
        hookCtx,
      );
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
    harnessConfig?: Partial<HarnessConfig>,
    variables?: Record<string, unknown>,
    predecessorSummaries?: Array<{ stageName: string; summary: string; outputData?: Record<string, unknown> }>,
  ): void {
    const exec = (): Promise<void> =>
      this.stageExecutionService.executeStage(
        stageRun,
        runId,
        sessionMode,
        harnessConfig,
        variables,
        predecessorSummaries,
      );
    const settled = this.stageSemaphore ? this.stageSemaphore.run(exec) : exec();
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

    // Re-attach the per-run JSONL logger (in-memory; lost on restart).
    const artifactsDirPath = run.variables?.['__artifactsDirectory'] as string | undefined;
    if (artifactsDirPath && this.logger && !this.runLoggers.has(runId)) {
      const runLogger = new RunLogger(runId, artifactsDirPath, this.logger);
      runLogger.attach(this.eventBus);
      this.runLoggers.set(runId, runLogger);
    }

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
    this.startPolling(runId, run.workflowDefinitionId);
    await this.eventBus.emitGlobal({
      kind: 'workflow_run.resumed',
      data: { workflowRunId: runId },
    });

    // 3. Launch currently-ready stages (all preds terminal, status pending).
    const readyDefIds = await this.dagScheduler.getReadyStages(runId, run.workflowDefinitionId);
    if (readyDefIds.length > 0) {
      const definition = await this.definitionRepo.getById(run.workflowDefinitionId);
      const harnessConfig = definition.harnessConfig;
      const dag = await this.dagScheduler.buildDAGForDefinition(run.workflowDefinitionId);
      for (const defId of readyDefIds) {
        const sr = stageRuns.find((s) => s.stageDefinitionId === defId);
        if (!sr || sr.status !== 'pending') continue;
        const override = this.findStageOverride(run.variables, sr.name, stageRuns.indexOf(sr));
        if (override?.skip) {
          await this.skipStageByOverride(sr, runId);
          continue;
        }
        const effectiveVars = override?.variables
          ? { ...run.variables, ...override.variables }
          : run.variables;
        const predecessorSummaries = this.gatherPredecessorSummaries(defId, dag, stageRuns);
        this.launchStage(sr, runId, run.sessionMode, harnessConfig, effectiveVars, predecessorSummaries);
      }
    }

    // 4. Skip unreachable + finalize if already complete.
    await this.skipUnreachableStages(runId, run.workflowDefinitionId);
    await this.finalizeRunIfComplete(runId, run.workflowDefinitionId);

    await this.eventBus.emitGlobal({
      kind: 'workflow_run.resumed',
      data: { workflowRunId: runId },
    });
  }

  /**
   * Create a workflow run — snapshot the definition and create stage run records.
   */
  async createRun(params: CreateWorkflowRunParams): Promise<WorkflowRun> {
    return withSpan('core.workflow', 'workflow.createRun', async (span) => {
      span.setAttribute('workflow.definition_id', params.workflowDefinitionId);

    const definition = await this.definitionRepo.getById(params.workflowDefinitionId);
    const stages = await this.stageDefRepo.getByDefinitionId(definition.id);
    const now = new Date();

    // BUGFIX (variable type validation at run create) — enforce VariableDefinition
    // type + required + choice options against the caller-supplied variables
    // dict. Previously any payload was accepted (zod schema only required
    // `Record<string, unknown>`), letting `topic: 12345` through when the
    // definition says `topic: 'string'`. We now fail fast with a clear error.
    if (definition.variables && definition.variables.length > 0) {
      const provided = params.variables ?? {};
      const issues: string[] = [];
      for (const v of definition.variables) {
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

    // Create workflow run with master session ID
    const masterSessionId = `master_${generateId()}`;
    const runVars: Record<string, unknown> = { ...(params.variables ?? {}) };
    // Merge in `defaultValue` for any workflow-defined variable the caller
    // didn't provide. Without this pass, prompts like `Hello {{name}}` reach
    // the harness with the placeholder unresolved even though the definition
    // supplied a sensible default — `interpolateVariables` only substitutes
    // keys that exist in the vars bag.
    if (definition.variables && definition.variables.length > 0) {
      for (const v of definition.variables) {
        const current = runVars[v.name];
        const missing = current === undefined || current === null || current === '';
        if (missing && v.defaultValue !== undefined) {
          runVars[v.name] = v.defaultValue;
        }
      }
    }
    if (params.projectId) {
      runVars['__projectId'] = params.projectId;
    }
    const run: WorkflowRun = {
      id: generateId(),
      workflowDefinitionId: definition.id,
      name: `${definition.name} - Run ${Date.now()}`,
      status: 'created',
      sessionMode: definition.sessionMode,
      masterSessionId,
      variables: runVars,
      createdAt: now,
      updatedAt: now,
    };

    // Atomically insert the run row + N stage_run rows. A mid-loop failure
    // (e.g. UNIQUE violation on one stage) should not leave the run in a
    // half-materialized state.
    const insertRunAndStages = async (): Promise<void> => {
      await this.runRepo.create(run);
      for (const stage of stages) {
        const stageRun: StageRun = {
          id: generateId(),
          workflowRunId: run.id,
          stageDefinitionId: stage.id,
          name: stage.name,
          status: 'pending',
          currentStep: 0,
          totalSteps: stage.prompts.length,
          retryCount: 0,
          version: 0,
          createdAt: now,
        };
        await this.stageRunRepo.create(stageRun);
      }
    };
    if (this.withTransaction) {
      await this.withTransaction(insertRunAndStages);
    } else {
      await insertRunAndStages();
    }

    // Event emission happens AFTER commit so that observers never see a
    // `workflow_run.created` event for a run whose row was rolled back.
    await this.eventBus.emitGlobal({
      kind: 'workflow_run.created',
      data: {
        workflowRunId: run.id,
        name: run.name,
        workflowDefinitionId: definition.id,
      },
    });

    runCounter.add(1, { definition_id: params.workflowDefinitionId });
    span.setAttribute('workflow.run_id', run.id);
    span.setAttribute('workflow.stage_count', stages.length);

    return run;
    });
  }
  /**
   * Phase 2, 2.4 — user-initiated retry of a `failed` run.
   *
   * Resets every `failed` stage run back to `pending`, clears its error
   * and timing fields, advances the WorkflowRun state machine via
   * `user:retry` (failed → created), and returns without auto-starting.
   * The caller decides whether to immediately `startRun(runId)` or let
   * the user kick it off.
   */
  async retryRun(runId: string): Promise<WorkflowRun> {
    return withSpan('core.workflow', 'workflow.retryRun', async (span) => {
      span.setAttribute('workflow.run_id', runId);

      const run = await this.runRepo.getById(runId);
      if (run.status !== 'failed') {
        throw new Error(
          `Cannot retry run ${runId}: current status is '${run.status}', expected 'failed'`,
        );
      }

      // Walk the state machine so the error surface is consistent with
      // other lifecycle transitions.
      const sm = new WorkflowRunStateMachine(run.status);
      const nextStatus = sm.transition('user:retry');

      // Reset failed stages so the DAG scheduler picks them up on next
      // startRun. Leave successful stages alone — retrying from scratch
      // would re-burn tokens for work that already succeeded.
      const stageRuns = await this.stageRunRepo.getByRunId(runId);
      for (const sr of stageRuns) {
        if (sr.status === 'failed') {
          await this.stageRunRepo.resetForRetry(sr.id);
        }
      }

      await this.runRepo.updateStatus(runId, nextStatus);
      // Clear the previous run's terminal fields so the retry starts fresh.
      // `null` (not `undefined`) is required: the repo skips `undefined` keys,
      // whereas `null` writes SQL NULL. The type models these as optional
      // (string|Date|undefined), so a cast to null is unavoidable here.
      await this.runRepo.update(runId, {
        error: null as unknown as undefined,
        startedAt: null as unknown as undefined,
        completedAt: null as unknown as undefined,
      });

      await this.eventBus.emitGlobal({
        kind: 'workflow_run.retried',
        data: { workflowRunId: runId },
      });

      return this.runRepo.getById(runId);
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

    // Set up per-run workspace and artifacts directories if not already set
    if (!run.variables?.['__workingDirectory'] || !run.variables?.['__artifactsDirectory']) {
      let runWorkspaceDir: string;
      let runArtifactsDir: string;
      let workspaceId: string | undefined;
      let workspaceRootPath: string | undefined;

      const definition = await this.definitionRepo.getById(run.workflowDefinitionId);

      if (this.workspaceManager) {
        // Use unified WorkspaceManager for workspace isolation
        const workspace = await this.workspaceManager.createWorkspace({
          ownerType: 'workflow_run',
          ownerId: runId,
          projectId: definition.projectId,
          useWorktree: definition.useWorktree ?? true,
          gitEnabled: true,
          stageSystemArtifacts: true,
          stageProjectArtifacts: !!definition.projectId,
          // Propagate the workflow definition's browserConfig so the
          // built-in browser tools honour visibility, evalAllowed, and
          // allowedHosts on the first invocation.
          ...(definition.browserConfig
            ? { browserConfig: definition.browserConfig as Record<string, unknown> }
            : {}),
        });
        workspaceId = workspace.id;
        workspaceRootPath = workspace.rootPath;
        runWorkspaceDir = this.workspaceManager.getWorkingDirectory(workspace);
        runArtifactsDir = path.join(workspace.rootPath, 'artifacts');
      } else {
        // Fallback: manual directory creation (legacy behavior)
        const baseDir = this.artifactsDir ?? path.join(process.cwd(), '.generatorai', 'artifacts');
        runWorkspaceDir = path.join(baseDir, 'runs', runId, 'workspace');
        runArtifactsDir = path.join(baseDir, 'runs', runId, 'artifacts');
        await fs.mkdir(runWorkspaceDir, { recursive: true });
        await fs.mkdir(runArtifactsDir, { recursive: true });
      }

      let updatedVars: Record<string, unknown> = {
        ...(run.variables ?? {}),
        __workingDirectory: runWorkspaceDir,
        __artifactsDirectory: runArtifactsDir,
        __workflowRunId: runId,
        ...(workspaceId ? { __workspaceId: workspaceId } : {}),
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
        definition,
        runId,
        workspaceRootPath,
        updatedVars,
      );

      const runUpdates: Record<string, unknown> = { variables: updatedVars };
      if (workspaceId) runUpdates['workspaceId'] = workspaceId;
      await this.runRepo.update(runId, runUpdates);
      run.variables = updatedVars;
    }

    // Start per-run JSONL logger (captures all streaming + lifecycle events)
    const artifactsDirPath = run.variables?.['__artifactsDirectory'] as string | undefined;
    if (artifactsDirPath && this.logger) {
      const runLogger = new RunLogger(runId, artifactsDirPath, this.logger);
      runLogger.attach(this.eventBus);
      this.runLoggers.set(runId, runLogger);
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
    // DAG build / root stage scheduling. Mirrors the v1 orchestrator
    // hook point so workflow-level hooks defined on the definition
    // execute in the v2 DAG runner as well.
    {
      const definition = await this.definitionRepo.getById(run.workflowDefinitionId);
      await this.executeWorkflowHooks(
        'on_run_start',
        definition.hooks,
        runId,
        definition.id,
      );
    }

    // Build DAG
    const dag = await this.dagScheduler.buildDAGForDefinition(run.workflowDefinitionId);

    // FEAT-1: resolve `auto` session mode adaptively (was a silent alias for
    // `per-stage`). A purely linear DAG (every execution layer has exactly one
    // stage) runs better as `single` — one shared SDK conversation carries
    // context forward across the chain. Any parallelism (a layer with >1 stage,
    // or multiple roots) needs `per-stage` isolation so concurrent stages don't
    // clobber a shared conversation. Persist the resolved mode so every later
    // re-fetch of the run (onStageCompleted/onStageFailed/resume) sees it.
    //
    // FEAT-1b: also override `single` when the DAG has parallelism. A shared
    // session cannot correctly serve two stages executing concurrently — every
    // Claude event fires BOTH stages' onConversationEvent subscribers and the
    // frontend sees identical streams for both stage rows (STR-11). Detecting
    // this at run start and forcing per-stage isolation prevents the duplicate-
    // stream footgun without asking authors to remember the mode.
    const hasParallelism =
      dag.rootIds.length > 1 || dag.executionLayers.some((layer) => layer.length > 1);
    if (run.sessionMode === 'auto') {
      const resolvedMode = hasParallelism ? 'per-stage' : 'single';
      await this.runRepo.update(runId, { sessionMode: resolvedMode });
      run.sessionMode = resolvedMode;
      this.logger?.info?.(
        `[WorkflowRunService] auto session mode resolved to '${resolvedMode}' for run ${runId} (parallel=${hasParallelism})`,
      );
    } else if (run.sessionMode === 'single' && hasParallelism) {
      // Definition explicitly requested `single` but the DAG has concurrent
      // stages — silently override to `per-stage` and log so the operator can
      // fix the definition. Keeping `single` here would deliver identical
      // event streams to every parallel stage.
      await this.runRepo.update(runId, { sessionMode: 'per-stage' });
      run.sessionMode = 'per-stage';
      this.logger?.warn?.(
        `[WorkflowRunService] Overriding sessionMode 'single' → 'per-stage' for run ${runId}: ` +
        `definition has parallel stages (roots=${dag.rootIds.length}, maxLayer=${Math.max(...dag.executionLayers.map((l) => l.length))}). ` +
        `A shared session cannot correctly serve concurrent stages.`,
      );
    }

    sm.transition('sys:dag_ready');
    await this.runRepo.updateStatus(runId, 'running');

    await this.eventBus.emitGlobal({
      kind: 'workflow_run.running',
      data: { workflowRunId: runId },
    });

    // Get root stages and start them
    const rootStageDefIds = await this.dagScheduler.getRootStages(runId, run.workflowDefinitionId);
    const stageRuns = await this.stageRunRepo.getByRunId(runId);
    const defForConfig = await this.definitionRepo.getById(run.workflowDefinitionId);
    const harnessConfig = defForConfig.harnessConfig;

    for (const stageDefId of rootStageDefIds) {
      const stageRun = stageRuns.find((sr) => sr.stageDefinitionId === stageDefId);
      if (stageRun) {
        // Check for runtime stage overrides
        const override = this.findStageOverride(run.variables, stageRun.name, stageRuns.indexOf(stageRun));
        if (override?.skip) {
          await this.skipStageByOverride(stageRun, runId);
          continue;
        }
        const effectiveVars = override?.variables
          ? { ...run.variables, ...override.variables }
          : run.variables;

        // Fire and forget — completion handled by the scheduler. launchStage
        // adds the concurrency gate (P1#7), launch-time failure routing, and
        // relies on the DUR-06 claim so a duplicate launch is a safe no-op.
        this.launchStage(stageRun, runId, run.sessionMode, harnessConfig, effectiveVars);
      }
    }

    // ── Event-driven DAG routing (primary) ──
    // Subscribe to stage_run.completed / stage_run.failed so the DAG advances
    // immediately when a stage finishes, instead of waiting up to the 3s poll
    // interval. The handlers (onStageCompleted/onStageFailed) are idempotent
    // (de-duplicated via processedStageRuns), so this co-exists safely with
    // the polling backstop below.
    this.subscribeRunEvents(runId);

    // Start polling as a BACKSTOP: the executeStage promise is fire-and-forget
    // and may never settle (e.g., session release hangs), and an event may be
    // missed if a subscriber throws. Polling guarantees eventual progress.
    this.startPolling(runId, run.workflowDefinitionId);
    });
  }

  /**
   * Create git worktrees for a project-linked workflow run (direct PATH B
   * runs only — orchestrated runs set up worktrees in the orchestrator).
   * Mutates and returns the variables map with repo_path_* / repo_branch_*
   * entries and an overridden __workingDirectory. Non-fatal on error.
   */
  private async setupProjectWorktrees(
    run: WorkflowRun,
    definition: { projectId?: string; orchestratorConfig?: { gitRepositories?: Array<{ alias: string }> } },
    runId: string,
    workspaceRootPath: string | undefined,
    updatedVars: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const projectId = (run.variables?.['__projectId'] as string | undefined) ?? definition.projectId;
    if (!projectId || !this.worktreeService || !this.codebaseRepo) return updatedVars;

    try {
      // Resolve codebases: use orchestratorConfig.gitRepositories aliases OR all project codebases
      let selectedAliases: string[] = [];
      const orchConfig = definition.orchestratorConfig;
      if (orchConfig?.gitRepositories?.length) {
        selectedAliases = orchConfig.gitRepositories.map((r) => r.alias);
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
          // Backward-compat: system templates reference {{repo_path_target}}
          if (!updatedVars['repo_path_target']) {
            updatedVars['repo_path_target'] = primaryWorktree.worktreePath;
          }
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
   * have one that iterates over all active runs. The call signature is kept
   * compatible with the previous `startPolling(runId, workflowDefinitionId)`
   * so all existing call sites require no changes.
   */
  private startPolling(runId: string, _workflowDefinitionId?: string): void {
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
            // Find stages that completed/failed but haven't been processed
            const stageRuns = await this.stageRunRepo.getByRunId(runId);
            for (const sr of stageRuns) {
              if (sr.status === 'completed') {
                await this.onStageCompleted(runId, sr.id);
              } else if (sr.status === 'failed') {
                await this.onStageFailed(runId, sr.id, new Error(sr.error ?? 'Stage failed'));
              }
            }
          } catch {
            // Swallow errors to keep the reconciler running
          } finally {
            this.pollInFlight.delete(runId);
          }
        })();
      }
    }, 3000);
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

    for (const logger of this.runLoggers.values()) {
      try {
        logger.close();
      } catch {
        /* best-effort */
      }
    }
    this.runLoggers.clear();
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
    const definition = stageRuns.length > 0
      ? await this.definitionRepo.getById(run.workflowDefinitionId)
      : null;
    const dag = stageRuns.length > 0
      ? await this.dagScheduler.buildDAGForDefinition(run.workflowDefinitionId)
      : null;
    const allStageRuns = stageRuns.length > 0
      ? await this.stageRunRepo.getByRunId(runId)
      : [];
    for (const sr of stageRuns) {
      const predecessorSummaries = dag
        ? this.gatherPredecessorSummaries(sr.stageDefinitionId, dag, allStageRuns)
        : undefined;
      this.stageExecutionService
        .resumeStage(
          sr.id,
          runId,
          run.sessionMode,
          definition?.harnessConfig,
          run.variables,
          predecessorSummaries,
        )
        .catch(() => {/* handled by polling */});
    }

    // Restart event-driven routing + polling backstop for the resumed run
    this.subscribeRunEvents(runId);
    this.startPolling(runId, run.workflowDefinitionId);

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
    this.closeRunLogger(runId);
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
    const definition = await this.definitionRepo.getById(run.workflowDefinitionId);
    await this.executeWorkflowHooks('on_run_cancelled', definition.hooks, runId, definition.id);

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
    // WorkflowRunService is the sole validator for BOTH per-stage rules
    // (stageDef.resultValidation) and workflow-level rules
    // (orchestratorConfig.resultValidations, matched by stage order). The
    // WorkflowOrchestrator no longer runs validation itself (it only records
    // results for reporting) — this removes the previous double-validation
    // where an orchestrated run was validated by both services.
    //
    // On failure: bridge to retry when retries remain, else escalate through
    // onStageFailed so on_failure / on_completion edges route correctly.
    // The dedup key is NOT deleted here — retryStageAfterValidation flips the
    // stage status away from 'completed' *before* its backoff and resets the
    // dedup key itself, closing the window where an overlapping poll tick
    // could re-process the same completion.
    if (this.resultValidator) {
      const stageDef = await this.stageDefRepo.getById(stageRun.stageDefinitionId);
      const definition = await this.definitionRepo.getById(run.workflowDefinitionId);
      const workflowRules = (definition.orchestratorConfig?.resultValidations ?? [])
        .filter((v) => v.stageIndex === stageDef.order)
        .flatMap((v) => v.rules ?? []);
      const rules = [...workflowRules, ...(stageDef.resultValidation ?? [])];
      if (rules.length > 0) {
        try {
          const workspacePath =
            typeof run.variables?.['__workingDirectory'] === 'string'
              ? (run.variables['__workingDirectory'] as string)
              : undefined;
          const validation = await this.resultValidator.validateStageResult(
            runId,
            stageRunId,
            { stageIndex: stageDef.order, rules },
            workspacePath,
          );
          if (!validation.passed) {
            const maxRetries = stageDef.retryPolicy?.maxRetries ?? 0;
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
            // Retries exhausted (or no retryPolicy) — escalate to failure so
            // on_failure / on_completion edges route correctly.
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
      }
    }

    // HOOK-1: fire workflow-level `on_stage_completed` hooks (previously a
    // dormant phase with no firing site). Non-fatal; guarded so we only touch
    // the definition when a hook executor + hooks actually exist.
    if (this.hookExecutor) {
      const def = await this.definitionRepo.getById(run.workflowDefinitionId);
      await this.executeWorkflowHooks('on_stage_completed', def.hooks, runId, run.workflowDefinitionId);
    }

    // Schedule next stages
    const nextStageDefIds = await this.dagScheduler.onStageCompleted(
      runId,
      run.workflowDefinitionId,
      stageRun.stageDefinitionId,
    );

    if (nextStageDefIds.length > 0) {
      const allStageRuns = await this.stageRunRepo.getByRunId(runId);
      const definition = await this.definitionRepo.getById(run.workflowDefinitionId);
      const harnessConfig = definition.harnessConfig;
      const dag = await this.dagScheduler.buildDAGForDefinition(run.workflowDefinitionId);

      for (const defId of nextStageDefIds) {
        const sr = allStageRuns.find((s) => s.stageDefinitionId === defId);
        if (sr) {
          // Check for runtime stage overrides
          const override = this.findStageOverride(run.variables, sr.name, allStageRuns.indexOf(sr));
          if (override?.skip) {
            await this.skipStageByOverride(sr, runId);
            continue;
          }
          const effectiveVars = override?.variables
            ? { ...run.variables, ...override.variables }
            : run.variables;

          // HOOK-1: a stage being scheduled with more than one predecessor is a
          // parallel fan-in (join) point — fire the `on_parallel_join` phase
          // (previously dormant). Guarded behind hookExecutor to avoid extra work.
          if (this.hookExecutor) {
            const node = dag.nodes.get(defId);
            if (node && node.dependencyIds.length > 1) {
              await this.executeWorkflowHooks('on_parallel_join', definition.hooks, runId, run.workflowDefinitionId);
            }
          }

          // Gather summaries from all predecessor stages
          const predecessorSummaries = this.gatherPredecessorSummaries(defId, dag, allStageRuns);

          this.launchStage(sr, runId, run.sessionMode, harnessConfig, effectiveVars, predecessorSummaries);
        }
      }
    }

    // Skip stages whose conditions are not met (cascading)
    await this.skipUnreachableStages(runId, run.workflowDefinitionId);

    // Finalize (completed vs failed) if the DAG is now complete.
    await this.finalizeRunIfComplete(runId, run.workflowDefinitionId);
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

    // HOOK-1: fire workflow-level `on_stage_failed` hooks (previously dormant).
    if (this.hookExecutor) {
      const def = await this.definitionRepo.getById(run.workflowDefinitionId);
      await this.executeWorkflowHooks('on_stage_failed', def.hooks, runId, run.workflowDefinitionId);
    }

    // Check for failure edges
    const nextStageDefIds = await this.dagScheduler.onStageFailed(
      runId,
      run.workflowDefinitionId,
      stageRun.stageDefinitionId,
    );

    if (nextStageDefIds.length > 0) {
      const allStageRuns = await this.stageRunRepo.getByRunId(runId);
      const definition = await this.definitionRepo.getById(run.workflowDefinitionId);
      const harnessConfig = definition.harnessConfig;
      const dag = await this.dagScheduler.buildDAGForDefinition(run.workflowDefinitionId);

      for (const defId of nextStageDefIds) {
        const sr = allStageRuns.find((s) => s.stageDefinitionId === defId);
        if (sr) {
          // Gather summaries from all predecessor stages (including failed ones)
          const predecessorSummaries = this.gatherPredecessorSummaries(defId, dag, allStageRuns);

          this.launchStage(sr, runId, run.sessionMode, harnessConfig, run.variables, predecessorSummaries);
        }
      }
    }

    // Skip stages whose conditions are not met (cascading)
    await this.skipUnreachableStages(runId, run.workflowDefinitionId);

    // Finalize if the DAG is now complete. The completed-vs-failed decision is
    // centralized in finalizeRunIfComplete (deterministic regardless of which
    // handler observes completion, and treats handled on_failure recoveries as
    // success).
    await this.finalizeRunIfComplete(runId, run.workflowDefinitionId);
  }

  /**
   * If the DAG is complete, transition the run to its terminal status.
   *
   * The completed-vs-failed decision is delegated to
   * DAGScheduler.computeTerminalRunStatus, which treats a failed stage whose
   * failure is absorbed by an active on_failure / on_completion / always edge
   * (a recovery branch that completed) as handled → the run can still complete
   * successfully. This is invoked by BOTH onStageCompleted and onStageFailed
   * so the final status is deterministic regardless of ordering.
   */
  private async finalizeRunIfComplete(runId: string, workflowDefinitionId: string): Promise<void> {
    const complete = await this.dagScheduler.isDAGComplete(runId, workflowDefinitionId);
    if (!complete) return;

    const finalStatus = await this.dagScheduler.computeTerminalRunStatus(runId, workflowDefinitionId);
    if (finalStatus === 'completed') {
      await this.completeRun(runId);
      return;
    }

    // ── Unhandled failure → mark run failed ──
    // Re-read status to avoid racing a concurrent completeRun.
    const run = await this.runRepo.getById(runId);
    if (run.status !== 'running') return;

    this.stopPolling(runId);
    this.unsubscribeRunEvents(runId);
    this.closeRunLogger(runId);
    activeRuns.add(-1);

    const stageRuns = await this.stageRunRepo.getByRunId(runId);
    const failed = stageRuns.filter((sr) => sr.status === 'failed');
    const errorMsg =
      failed.length > 0
        ? `Stage(s) failed: ${failed
            .map((sr) => `${sr.name}${sr.error ? ` (${sr.error})` : ''}`)
            .join('; ')}`
        : 'Workflow run failed';

    await this.runRepo.update(runId, {
      status: 'failed',
      error: errorMsg,
      completedAt: new Date(),
    });
    // Mark workspace as completed even on failure
    await this.completeWorkspaceForRun(runId);
    await this.pruneProcessedForRun(runId);

    // ── Workflow Hook: on_run_failed ──
    const definition = await this.definitionRepo.getById(run.workflowDefinitionId);
    await this.executeWorkflowHooks('on_run_failed', definition.hooks, runId, definition.id);

    await this.eventBus.emitGlobal({
      kind: 'workflow_run.failed',
      data: { workflowRunId: runId, error: errorMsg },
    });
  }

  /**
   * Mark stages as skipped when their conditions cannot be met.
   * Handles cascading: if a skipped stage has dependents, those may also need skipping.
   */
  private async skipUnreachableStages(runId: string, workflowDefinitionId: string): Promise<void> {
    const skippedDefIds: string[] = [];
    let skippable = await this.dagScheduler.getSkippableStages(runId, workflowDefinitionId);
    while (skippable.length > 0) {
      const allStageRuns = await this.stageRunRepo.getByRunId(runId);
      let progressed = false;
      for (const defId of skippable) {
        const sr = allStageRuns.find((s) => s.stageDefinitionId === defId);
        if (sr && sr.status === 'pending') {
          await this.stageRunRepo.update(sr.id, {
            status: 'skipped',
            completedAt: new Date(),
          });
          skippedDefIds.push(defId);
          progressed = true;
        }
      }
      // Guard against an infinite loop if a "skippable" stage can't actually
      // be transitioned (e.g. already non-pending).
      if (!progressed) break;
      // Check for cascading skips (skipped stages might unblock more skips)
      skippable = await this.dagScheduler.getSkippableStages(runId, workflowDefinitionId);
    }

    // Route `always` edges out of stages we just skipped so a fan-in /
    // convergence stage that is only reachable via an `always` edge from a
    // skipped branch is scheduled instead of being stranded. (on_success /
    // on_failure / on_completion edges are correctly NOT activated by a skip.)
    for (const defId of skippedDefIds) {
      await this.scheduleSuccessorsAfterSkip(runId, workflowDefinitionId, defId);
    }
  }

  /**
   * Schedule stages reachable via `always` edges from a stage that was just
   * skipped. Mirrors the dispatch logic in onStageCompleted.
   */
  private async scheduleSuccessorsAfterSkip(
    runId: string,
    workflowDefinitionId: string,
    skippedDefId: string,
  ): Promise<void> {
    const nextStageDefIds = await this.dagScheduler.onStageSkipped(runId, workflowDefinitionId, skippedDefId);
    if (nextStageDefIds.length === 0) return;

    const run = await this.runRepo.getById(runId);
    if (run.status !== 'running') return;

    const allStageRuns = await this.stageRunRepo.getByRunId(runId);
    const definition = await this.definitionRepo.getById(run.workflowDefinitionId);
    const harnessConfig = definition.harnessConfig;
    const dag = await this.dagScheduler.buildDAGForDefinition(run.workflowDefinitionId);

    for (const defId of nextStageDefIds) {
      const sr = allStageRuns.find((s) => s.stageDefinitionId === defId);
      if (!sr || sr.status !== 'pending') continue;

      const override = this.findStageOverride(run.variables, sr.name, allStageRuns.indexOf(sr));
      if (override?.skip) {
        await this.skipStageByOverride(sr, runId);
        continue;
      }
      const effectiveVars = override?.variables
        ? { ...run.variables, ...override.variables }
        : run.variables;
      const predecessorSummaries = this.gatherPredecessorSummaries(defId, dag, allStageRuns);
      this.launchStage(sr, runId, run.sessionMode, harnessConfig, effectiveVars, predecessorSummaries);
    }
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
    const stageDef = await this.stageDefRepo.getById(stageRun.stageDefinitionId);
    const retryPolicy = stageDef.retryPolicy ?? { maxRetries: 1, backoffMs: 3000, backoffMultiplier: 1 };

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
    const definition = await this.definitionRepo.getById(run.workflowDefinitionId);
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
        .retryInSession(updated, runId, reason, definition.harnessConfig, enrichedVars)
        .catch((err) => {
          this.onStageFailed(runId, stageRunId, err).catch(() => {/* swallow */});
        });
    } else {
      // ── Full Restart ──
      // Release old session so a fresh one is allocated, then re-execute from
      // scratch with validation feedback injected into variables.
      await this.sessionAllocator.releaseSession(stageRunId);
      this.stageExecutionService
        .executeStage(updated, runId, run.sessionMode, definition.harnessConfig, enrichedVars)
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
    this.closeRunLogger(runId);
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
    const definition = await this.definitionRepo.getById(run.workflowDefinitionId);
    await this.executeWorkflowHooks('on_run_complete', definition.hooks, runId, definition.id);

    await this.eventBus.emitGlobal({
      kind: 'workflow_run.completed',
      data: { workflowRunId: runId },
    });
  }

  /**
   * Close and remove the per-run event logger for a given run.
   */
  private closeRunLogger(runId: string): void {
    const rl = this.runLoggers.get(runId);
    if (rl) {
      rl.close();
      this.runLoggers.delete(runId);
    }
  }

  /**
   * Mark the workspace as completed for a finished run (success, failure, or cancel).
   */
  private async completeWorkspaceForRun(runId: string): Promise<void> {
    if (!this.workspaceManager) return;
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
   * Gather summaries from all predecessor stages of a given stage definition.
   * Used to inject context into successor stages, especially at convergence points
   * where multiple parallel branches merge.
   *
   * Context source resolution:
   * 1. If `stageDef.contextSources` is defined → resolve by stage name (any stage in workflow)
   * 2. If `stageDef.contextSources` is undefined → fallback to direct DAG predecessors
   * 3. If `stageDef.contextSources` is empty array → no context injected
   */
  private gatherPredecessorSummaries(
    stageDefId: string,
    dag: DAG,
    allStageRuns: StageRun[],
  ): Array<{ stageName: string; summary: string; outputData?: Record<string, unknown>; fullOutput?: string }> {
    const node = dag.nodes.get(stageDefId);
    if (!node) return [];

    const stageDef = node.stage;
    const summaries: Array<{ stageName: string; summary: string; outputData?: Record<string, unknown>; fullOutput?: string }> = [];

    // Determine which stages to pull context from
    let sourceStageRuns: StageRun[];

    if (stageDef.contextSources !== undefined) {
      // Explicit context sources: resolve by stage name
      if (stageDef.contextSources.length === 0) return []; // empty = no context
      sourceStageRuns = stageDef.contextSources
        .map((name) => allStageRuns.find((sr) => sr.name === name))
        .filter((sr): sr is StageRun => sr !== undefined && sr.status === 'completed');
    } else {
      // Fallback: direct DAG predecessors (original behavior)
      sourceStageRuns = node.dependencyIds
        .map((predId) => allStageRuns.find((sr) => sr.stageDefinitionId === predId))
        .filter((sr): sr is StageRun => sr !== undefined);
    }

    for (const predRun of sourceStageRuns) {
      // Include a predecessor when it has EITHER a summary or captured full
      // output (HANDOFF-1) — a contextFilter='full' successor needs the output
      // even if summary generation produced nothing.
      if (predRun.summary || predRun.outputText) {
        summaries.push({
          stageName: predRun.name,
          summary: predRun.summary ?? '',
          outputData: predRun.outputData,
          fullOutput: predRun.outputText,
        });
      }
    }
    return summaries;
  }

  /**
   * Find a runtime stage override matching by name or index.
   * Overrides are stored in run variables as `__stageOverrides` (set by the orchestrator).
   */
  private findStageOverride(
    variables: Record<string, unknown> | undefined,
    stageName: string,
    stageIndex: number,
  ): { skip?: boolean; variables?: Record<string, unknown>; agentName?: string; timeoutMs?: number } | undefined {
    const overrides = variables?.['__stageOverrides'] as Array<{
      stageName?: string;
      stageIndex?: number;
      skip?: boolean;
      variables?: Record<string, unknown>;
      agentName?: string;
      timeoutMs?: number;
    }> | undefined;

    if (!overrides || !Array.isArray(overrides)) return undefined;

    // Match by name first, then by index
    return overrides.find(
      (o) => (o.stageName && o.stageName === stageName) || (o.stageIndex !== undefined && o.stageIndex === stageIndex),
    );
  }

  /**
   * Skip a stage due to a runtime override (not DAG condition).
   */
  private async skipStageByOverride(stageRun: StageRun, runId: string): Promise<void> {
    await this.stageRunRepo.update(stageRun.id, {
      status: 'skipped',
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
