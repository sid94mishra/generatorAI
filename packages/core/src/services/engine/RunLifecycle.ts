// ────────────────────────────────────────────────────────────────
// RunLifecycle — the `prepare` and `finalize` effects of the v2 engine
// (P03 WP-3.6, G5 §3.9, §5.10).
//
// `prepare` runs while the run is `starting` (the workspace, then the
// `on_run_start` hooks) and posts `prepared` or `prepare_failed`.
// `finalize` runs while the run is `finalizing` or `cancelling`:
// compensation for the completed instances `decide()` listed (last completed
// first, the saga order), the workflow's `onFailure` / `onExit` actions and
// its run hooks, then the run's sessions are released (B-15) and the
// workspace is completed. It posts `finalized {ok}`; a failed compensation
// makes the run `failed` (`finalize_failed`) without stopping the others.
// Clone/preprocess and commit/PR post-processing join these two phases in
// P04 (one lifecycle for every entry point).
// ────────────────────────────────────────────────────────────────

import * as path from 'node:path';
import type { ILogger, WorkflowRun } from '@generatorai/shared';
import type {
  ActionDefinition,
  CompensationAction,
  HookDefinition,
  WorkflowGraph,
  WorkflowHookDefinition,
} from '@generatorai/workflow-spec';
import type { EngineStores } from '../../domain/ports/IEngineStore.js';
import type { IAgentHarness } from '../../domain/ports/IAgentHarness.js';
import type { ISessionRepository } from '../../domain/ports/IRepositories.js';
import type { IWorkflowRunRepository } from '../../domain/ports/IWorkflowRunRepository.js';
import { expressionScope } from '../../domain/scheduler/readiness.js';
import type { RunOutcome } from '../../domain/scheduler/types.js';
import type { EventBus } from '../../events/EventBus.js';
import type { RunDefinitionReader } from '../definitions/RunDefinitionReader.js';
import { userVariables } from '../definitions/runScope.js';
import type { HookContext, HookExecutor } from '../HookExecutor.js';
import type { WorkspaceCheckpointService } from '../WorkspaceCheckpointService.js';
import type { WorkspaceManager } from '../WorkspaceManager.js';

export interface RunLifecycle {
  /** The run's setup phases; throws with the phase name to fail the run (`setup:<phase>`). */
  prepare(runId: string): Promise<void>;
  /** Compensation, exit actions, hooks, session release. */
  finalize(runId: string, outcome: RunOutcome, compensate: readonly string[]): Promise<{ ok: boolean; error?: string }>;
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

export interface RunLifecycleDeps {
  stores: EngineStores;
  runRepo: IWorkflowRunRepository;
  definitions: RunDefinitionReader;
  workspaceManager: WorkspaceManager;
  harness: IAgentHarness;
  sessionRepo: ISessionRepository;
  eventBus: EventBus;
  hookExecutor?: HookExecutor | undefined;
  checkpoints?: WorkspaceCheckpointService | undefined;
  logger?: ILogger | undefined;
  now?: () => number;
}

const RUN_HOOK_PHASE: Readonly<Record<RunOutcome, WorkflowHookDefinition['phase']>> = {
  completed: 'on_run_complete',
  failed: 'on_run_failed',
  cancelled: 'on_run_cancelled',
};

export class DefaultRunLifecycle implements RunLifecycle {
  private readonly now: () => number;

  constructor(private readonly deps: RunLifecycleDeps) {
    this.now = deps.now ?? Date.now;
  }

  async prepare(runId: string): Promise<void> {
    const run = await this.deps.runRepo.getById(runId);
    const graph = await this.deps.definitions.get(run.definitionVersionId);
    await this.ensureWorkspace(run, graph).catch((err: unknown) => {
      throw new PrepareError('workspace', err instanceof Error ? err.message : String(err));
    });
    await this.runHooks('on_run_start', graph, await this.deps.runRepo.getById(runId));
  }

  /** Every run has a workspace; a run that already has one (a recovery) keeps it. */
  private async ensureWorkspace(run: WorkflowRun, graph: WorkflowGraph): Promise<void> {
    const vars = run.variables ?? {};
    if (typeof vars['__workingDirectory'] === 'string' && typeof vars['__artifactsDirectory'] === 'string') return;
    const { workspaceManager } = this.deps;
    const projectId = graph.workflow.projectId ?? undefined;
    const workspace = await workspaceManager.createWorkspace({
      ownerType: 'workflow_run',
      ownerId: run.id,
      projectId,
      useWorktree: graph.workflow.lifecycle.useWorktree,
      gitEnabled: true,
      stageSystemArtifacts: true,
      stageProjectArtifacts: !!projectId,
      ...(graph.workflow.session.browser ? { browserConfig: graph.workflow.session.browser as Record<string, unknown> } : {}),
    });
    await this.deps.runRepo.update(run.id, {
      workspaceId: workspace.id,
      variables: {
        ...vars,
        __workingDirectory: workspaceManager.getWorkingDirectory(workspace),
        __artifactsDirectory: path.join(workspace.rootPath, 'artifacts'),
        __workflowRunId: run.id,
        __workspaceId: workspace.id,
      },
    });
  }

  async finalize(runId: string, outcome: RunOutcome, compensate: readonly string[]): Promise<{ ok: boolean; error?: string }> {
    const run = await this.deps.runRepo.getById(runId);
    const graph = await this.deps.definitions.get(run.definitionVersionId);
    const failures: string[] = [];

    // Compensation, last completed first; one failure does not stop the others.
    const state = this.deps.stores.runStore.loadRunState(runId);
    for (const id of compensate) {
      const inst = state?.instances.find((i) => i.id === id);
      const stage = inst ? graph.stages.find((s) => s.key === inst.stageKey) : undefined;
      for (const action of stage?.compensate ?? []) {
        const ok = await this.compensate(run, graph, id, action);
        if (!ok) failures.push(`compensation "${action.name}" of ${stage!.name}`);
      }
    }

    const actions: ActionDefinition[] = [...(outcome === 'failed' ? (graph.workflow.onFailure ?? []) : []), ...(graph.workflow.onExit ?? [])];
    for (const action of actions) {
      const ok = await this.runAction(run, graph, action, RUN_HOOK_PHASE[outcome]);
      if (!ok) this.deps.logger?.warn(`[RunLifecycle] ${runId}: exit action "${action.name}" failed`);
    }
    await this.runHooks(RUN_HOOK_PHASE[outcome], graph, run);
    await this.releaseSessions(runId);
    const workspaceId = run.workspaceId ?? (run.variables?.['__workspaceId'] as string | undefined);
    if (workspaceId) {
      await this.deps.workspaceManager.completeWorkspace(workspaceId).catch((err: unknown) => {
        this.deps.logger?.warn(`[RunLifecycle] completing the workspace of ${runId} failed: ${String(err)}`);
      });
    }
    return failures.length > 0 ? { ok: false, error: `${failures.join('; ')} failed` } : { ok: true };
  }

  /** Destroy the run's conversations and close their sessions (every outcome, B-15). */
  async releaseSessions(runId: string): Promise<void> {
    const { stores, harness, sessionRepo } = this.deps;
    for (const rs of stores.runSessions.listActive(runId)) {
      try {
        const session = await sessionRepo.getById(rs.sessionId);
        if (session.conversationId) await harness.destroyConversation(session.conversationId).catch(() => undefined);
        await sessionRepo.updateStatus(rs.sessionId, 'closed');
        await sessionRepo.update(rs.sessionId, { closedAt: new Date(this.now()) });
      } catch {
        /* a session that is already gone is released */
      }
      stores.runSessions.release(runId, rs.sessionKey, this.now());
    }
  }

  private hookContext(run: WorkflowRun): HookContext {
    const state = this.deps.stores.runStore.loadRunState(run.id);
    return {
      sessionId: `__run_service_${run.id}__`,
      workflowId: run.workflowDefinitionId,
      workspacePath: (run.variables?.['__workingDirectory'] as string | undefined) ?? '',
      variables: Object.fromEntries(Object.entries(run.variables ?? {}).map(([k, v]) => [k, String(v)])),
      eventBus: this.deps.eventBus,
      workflowRunId: run.id,
      ...(state
        ? { templateScope: expressionScope({ ...state.run, variables: userVariables(run.variables) }, state.instances) }
        : {}),
    };
  }

  private async runHooks(phase: WorkflowHookDefinition['phase'], graph: WorkflowGraph, run: WorkflowRun): Promise<void> {
    const hooks = graph.workflow.hooks;
    if (!this.deps.hookExecutor || hooks.length === 0) return;
    await this.deps.hookExecutor
      .executePhase(phase, [...hooks] as unknown as HookDefinition[], this.hookContext(run))
      .catch((err: unknown) => this.deps.logger?.warn(`[RunLifecycle] run hook phase '${phase}' failed: ${String(err)}`));
  }

  /** One action, run as a single-hook phase whose failure is reported (failurePolicy abort). */
  private async runAction(run: WorkflowRun, graph: WorkflowGraph, action: ActionDefinition, phase: WorkflowHookDefinition['phase']): Promise<boolean> {
    if (!this.deps.hookExecutor) return true;
    const hook = {
      id: `action:${action.name}`,
      name: action.name,
      type: action.config.type,
      priority: 0,
      enabled: true,
      failurePolicy: 'abort' as const,
      timeoutMs: action.timeoutMs,
      retries: action.retries,
      config: action.config,
      phase,
    };
    try {
      const r = await this.deps.hookExecutor.executePhase(phase, [hook] as unknown as HookDefinition[], this.hookContext(run));
      return r.shouldContinue;
    } catch {
      return false;
    }
  }

  private async compensate(run: WorkflowRun, graph: WorkflowGraph, stageRunId: string, action: CompensationAction): Promise<boolean> {
    if (action.config.type === 'restore_checkpoint') {
      const workspaceId = run.workspaceId ?? (run.variables?.['__workspaceId'] as string | undefined);
      if (!this.deps.checkpoints || !workspaceId) return false;
      try {
        const r = await this.deps.checkpoints.restoreTurn(workspaceId, `attempt:${stageRunId}:1`, { workflowRunId: run.id }, 'before');
        return r.mounts.every((m) => m.ok);
      } catch {
        return false;
      }
    }
    return this.runAction(run, graph, { name: action.name, config: action.config, timeoutMs: action.timeoutMs, retries: action.retries }, 'on_run_failed');
  }
}
