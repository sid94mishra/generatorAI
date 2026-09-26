// ────────────────────────────────────────────────────────────────
// RunLifecycle — the `prepare` and `finalize` effects of the engine: ONE
// lifecycle for every run, however it was started (P04 WP-4.1; C-1, G5
// §3.9, §5.10).
//
// `prepare` runs while the run is `starting`: the PD-17 permission check,
// then the phases workspace → worktrees (the run's mounts, MountService) →
// uploads → projectConfigs → preprocess → sandbox. `finalize` runs while
// the run is `finalizing` or `cancelling`: compensate (last completed
// first) → hooks (onFailure / onExit actions and the run hooks) →
// postProcess (commit, push, PR; only for a completed run) → release
// (sessions, turn journals, sandbox, workspace).
//
// Every phase is a run-scope journalled effect: its completion is recorded
// under `system_vars.lifecycle['<stage>/<phase>']` before the next one
// starts, so a crash resumes at the phase that did not finish, and the
// hooks a phase fires fire once (C-17). A prepare failure fails the run
// with `status_reason: setup:<phase>`. `workflow_run.phase_started /
// phase_completed / phase_failed {stage, phase}` narrate it.
//
// A cancel while the run finalizes posts a second `finalize` (outcome
// cancelled): finalizes of one run are serialised, and the first one stops
// before its next phase and reports `superseded` instead of `finalized`, so
// post-processing is skipped and compensation still runs.
// ────────────────────────────────────────────────────────────────

import type { ILogger, RunSystemVars, WorkflowRun } from '@generatorai/shared';
import type { WorkflowGraph } from '@generatorai/workflow-spec';
import type { EngineStores } from '../../domain/ports/IEngineStore.js';
import type { IAgentHarness } from '../../domain/ports/IAgentHarness.js';
import type { IInvocationUploadRepository } from '../../domain/ports/IInvocationStores.js';
import type { ISessionRepository } from '../../domain/ports/IRepositories.js';
import type { IWorkflowRunRepository } from '../../domain/ports/IWorkflowRunRepository.js';
import type { RunOutcome } from '../../domain/scheduler/types.js';
import type { EventBus } from '../../events/EventBus.js';
import type { RunDefinitionReader } from '../definitions/RunDefinitionReader.js';
import type { HookExecutor } from '../HookExecutor.js';
import type { MountService } from '../MountService.js';
import type { RunSandbox } from '../createRunSandbox.js';
import type { WorkspaceCheckpointService } from '../WorkspaceCheckpointService.js';
import type { WorkspaceManager } from '../WorkspaceManager.js';
import { finalizePhases, type FinalizeContext } from './lifecycle/finalize.js';
import { runWorkflowHooks } from './lifecycle/hooks.js';
import { preparePhases, type PrepareContext, type ProjectConfigSource } from './lifecycle/prepare.js';
import type { LifecycleSteps } from './lifecycle/steps.js';

export interface RunLifecycle {
  /** The run's setup phases; throws `PrepareError` with the phase name to fail the run (`setup:<phase>`). */
  prepare(runId: string): Promise<void>;
  /**
   * Compensation, exit actions and hooks, post-processing, release.
   * `superseded`: a cancel arrived while this finalize ran; the cancel's own
   * finalize reports the outcome.
   */
  finalize(runId: string, outcome: RunOutcome, compensate: readonly string[]): Promise<{ ok: boolean; error?: string; superseded?: boolean }>;
}

/** A setup phase that failed, for `prepare_failed {phase}`. */
export class PrepareError extends Error {
  constructor(
    readonly phase: string,
    message: string,
  ) {
    super(message);
    this.name = 'PrepareError';
  }
}

/** Late-wired platform services of the lifecycle (built after the engine). */
export interface LifecyclePlatform {
  /** The run's mounts: worktrees, in-place checkouts, the generated directory (RV-19). */
  mounts?: MountService | undefined;
  /** Files staged before the run (`invocation_uploads`). */
  uploads?: IInvocationUploadRepository | undefined;
  /** The project's agent / prompt / skill configs. */
  projectConfigs?: ProjectConfigSource | undefined;
  /** Pre- and post-processing steps. */
  steps?: LifecycleSteps | undefined;
  /** The run sandbox, when the deployment runs stages in one. */
  sandbox?: RunSandbox | null | undefined;
  /** The versions `pin_at_run_start` sub-workflows run, resolved at run start (SubworkflowEffects). */
  subworkflowPins?: ((run: WorkflowRun, graph: WorkflowGraph) => Promise<Record<string, string>>) | undefined;
}

export interface RunLifecycleDeps extends LifecyclePlatform {
  stores: EngineStores;
  runRepo: IWorkflowRunRepository;
  definitions: RunDefinitionReader;
  workspaceManager: WorkspaceManager;
  harness: IAgentHarness;
  sessionRepo: ISessionRepository;
  eventBus: EventBus;
  hookExecutor?: HookExecutor | undefined;
  checkpoints?: WorkspaceCheckpointService | undefined;
  /**
   * PD-17: refuse a run whose permission mode a stage's provider cannot hold
   * (throws). Runs first, before anything is created for the run.
   */
  permissionCheck?: ((run: WorkflowRun, graph: WorkflowGraph) => Promise<void>) | undefined;
  logger?: ILogger | undefined;
  now?: () => number;
}

/** What a phase function hands back: system values to merge, and the user variables when it changed them. */
export interface PhaseResult {
  systemVars?: Partial<RunSystemVars>;
  variables?: Record<string, unknown>;
  workspaceId?: string;
  detail?: string;
}

/** A phase whose work failed but whose effect is recorded (compensation, post-processing). */
export class PhaseFailure extends Error {
  constructor(
    message: string,
    readonly result: PhaseResult,
  ) {
    super(message);
    this.name = 'PhaseFailure';
  }
}

export class DefaultRunLifecycle implements RunLifecycle {
  private readonly now: () => number;
  /** Finalizes of one run, serialised. */
  private readonly finalizing = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: RunLifecycleDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** Late wiring (the composition root builds these after the engine). */
  setPlatform(platform: LifecyclePlatform): void {
    Object.assign(this.deps, platform);
  }

  setCheckpoints(checkpoints: WorkspaceCheckpointService): void {
    this.deps.checkpoints = checkpoints;
  }

  /** The platform services wired so far (the map effects cut item mounts and push item branches with them). */
  get platform(): LifecyclePlatform {
    return { mounts: this.deps.mounts, uploads: this.deps.uploads, projectConfigs: this.deps.projectConfigs, steps: this.deps.steps, sandbox: this.deps.sandbox };
  }

  // ── Journal ──────────────────────────────────────────────────

  /**
   * Run one phase unless the journal says it already ran. Its result is
   * merged into the run row and recorded before this returns; a failure is
   * recorded as `failed` and re-thrown.
   */
  private async phase(
    runId: string,
    stage: 'prepare' | 'finalize',
    phase: string,
    fn: (run: WorkflowRun) => Promise<PhaseResult | void>,
  ): Promise<{ skipped: boolean; failed?: string }> {
    const key = `${stage}/${phase}`;
    const run = await this.deps.runRepo.getById(runId);
    const journalled = run.systemVars?.lifecycle?.[key];
    if (journalled) return { skipped: true, ...(journalled.status === 'failed' ? { failed: journalled.detail ?? `${phase} failed` } : {}) };
    const started = this.now();
    await this.emit('workflow_run.phase_started', { workflowRunId: runId, stage, phase });
    try {
      const result = (await fn(run)) ?? {};
      await this.record(runId, key, { status: 'done', at: this.now(), ...(result.detail ? { detail: result.detail } : {}) }, result);
      await this.emit('workflow_run.phase_completed', { workflowRunId: runId, stage, phase, durationMs: this.now() - started });
      return { skipped: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.record(runId, key, { status: 'failed', at: this.now(), detail: message }, err instanceof PhaseFailure ? err.result : {}).catch(
        (e: unknown) => this.deps.logger?.warn(`[RunLifecycle] ${runId}: recording ${key} failed: ${String(e)}`),
      );
      await this.emit('workflow_run.phase_failed', { workflowRunId: runId, stage, phase, error: message });
      if (err instanceof PhaseFailure) return { skipped: false, failed: message };
      throw err;
    }
  }

  private async record(runId: string, key: string, entry: NonNullable<RunSystemVars['lifecycle']>[string], result: PhaseResult): Promise<void> {
    const fresh = await this.deps.runRepo.getById(runId);
    const systemVars: RunSystemVars = {
      ...(fresh.systemVars ?? {}),
      ...(result.systemVars ?? {}),
      lifecycle: { ...(fresh.systemVars?.lifecycle ?? {}), [key]: entry },
    };
    await this.deps.runRepo.update(runId, {
      systemVars,
      ...(result.variables ? { variables: result.variables } : {}),
      ...(result.workspaceId ? { workspaceId: result.workspaceId } : {}),
    });
  }

  private async emit(kind: string, data: Record<string, unknown>): Promise<void> {
    await this.deps.eventBus.emitGlobal({ kind, data } as never).catch(() => undefined);
  }

  // ── prepare ──────────────────────────────────────────────────

  async prepare(runId: string): Promise<void> {
    const run = await this.deps.runRepo.getById(runId);
    const graph = await this.deps.definitions.get(run.definitionVersionId);
    if (this.deps.permissionCheck) {
      await this.deps.permissionCheck(run, graph).catch((err: unknown) => {
        throw new PrepareError('permission', err instanceof Error ? err.message : String(err));
      });
    }
    const ctx: PrepareContext = { deps: this.deps, graph, now: this.now, hooks: (phase, r) => this.runHooks(phase, graph, r) };
    for (const [name, fn] of preparePhases) {
      try {
        await this.phase(runId, 'prepare', name, (r) => fn(ctx, r));
      } catch (err) {
        throw new PrepareError(name, err instanceof Error ? err.message : String(err));
      }
    }
  }

  // ── finalize ─────────────────────────────────────────────────

  finalize(runId: string, outcome: RunOutcome, compensate: readonly string[]): Promise<{ ok: boolean; error?: string; superseded?: boolean }> {
    const previous = this.finalizing.get(runId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.finalizeNow(runId, outcome, compensate));
    this.finalizing.set(runId, next);
    void next.finally(() => {
      if (this.finalizing.get(runId) === next) this.finalizing.delete(runId);
    });
    return next;
  }

  private async finalizeNow(runId: string, outcome: RunOutcome, compensate: readonly string[]): Promise<{ ok: boolean; error?: string; superseded?: boolean }> {
    const graph = await this.deps.definitions.get((await this.deps.runRepo.getById(runId)).definitionVersionId);
    const ctx: FinalizeContext = {
      deps: this.deps,
      graph,
      outcome,
      compensate,
      now: this.now,
      hooks: (phase, r) => this.runHooks(phase, graph, r),
    };
    const failures: string[] = [];
    for (const [name, fn] of finalizePhases) {
      // A cancel that arrived while this one ran supersedes it before its next phase.
      if (outcome !== 'cancelled' && name !== 'release' && (await this.cancelled(runId))) return { ok: true, superseded: true };
      // Compensation is journalled per outcome: a cancel compensates what the cancel lists.
      const key = name === 'compensate' ? `compensate:${outcome}` : name;
      const r = await this.phase(runId, 'finalize', key, (run) => fn(ctx, run)).catch((err: unknown) => ({
        skipped: false,
        failed: err instanceof Error ? err.message : String(err),
      }));
      if (r.failed) failures.push(`${name}: ${r.failed}`);
    }
    if (outcome !== 'cancelled' && (await this.cancelled(runId))) return { ok: true, superseded: true };
    return failures.length > 0 ? { ok: false, error: failures.join('; ') } : { ok: true };
  }

  private async cancelled(runId: string): Promise<boolean> {
    return this.deps.stores.runs.getRunRow(runId)?.status === 'cancelling';
  }

  // ── hooks ────────────────────────────────────────────────────

  /** One workflow hook phase over the run (non-fatal unless a hook aborts). */
  private async runHooks(phase: string, graph: WorkflowGraph, run: WorkflowRun) {
    return runWorkflowHooks(this.deps, phase, graph, run);
  }
}

