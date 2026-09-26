// ────────────────────────────────────────────────────────────────
// The finalize phases of `finalizing` / `cancelling` (P04 WP-4.1; G5 §3.9):
//
//   compensate   compensation of the completed instances `decide()` listed,
//                last completed first (the saga order); one failure does not
//                stop the others, and makes the run `failed`
//   hooks        the workflow's `onFailure` / `onExit` actions, then the run
//                hooks of the outcome (`on_run_complete|failed|cancelled`)
//   postProcess  commit, push and PR (the lifecycle's `postProcessing`
//                flags and steps) on the run's codebases, through the one
//                source-control flow; a completed run only — a failed or
//                cancelled run commits nothing. `on_postprocessing_start`,
//                `pre_commit`, `post_commit`, `on_pr_created` hooks. A
//                failing `failOnError` step fails the run
//   release      the run's sessions (B-15) and turn journals, the sandbox,
//                and the workspace. Worktrees are never removed here (C-7):
//                retention reclaims them.
// A sub-workflow child that inherits its parent's workspace (P05 §4.2)
// skips post-processing and the workspace release: the parent owns both.
// ────────────────────────────────────────────────────────────────

import type { HookPhaseResult, WorkflowRun } from '@generatorai/shared';
import type { FinalizePhase, Lifecycle, PostProcessingStep, WorkflowGraph, WorkflowHookDefinition } from '@generatorai/workflow-spec';
import type { RunOutcome } from '../../../domain/scheduler/types.js';
import { PhaseFailure, type PhaseResult, type RunLifecycleDeps } from '../RunLifecycle.js';
import { runAction } from './hooks.js';

export interface FinalizeContext {
  deps: RunLifecycleDeps;
  graph: WorkflowGraph;
  outcome: RunOutcome;
  compensate: readonly string[];
  now: () => number;
  hooks: (phase: string, run: WorkflowRun) => Promise<HookPhaseResult>;
}

type Phase = (ctx: FinalizeContext, run: WorkflowRun) => Promise<PhaseResult>;

const RUN_HOOK_PHASE: Readonly<Record<RunOutcome, WorkflowHookDefinition['phase']>> = {
  completed: 'on_run_complete',
  failed: 'on_run_failed',
  cancelled: 'on_run_cancelled',
};

const compensate: Phase = async ({ deps, graph, compensate: order }, run) => {
  const failures: string[] = [];
  const state = deps.stores.runStore.loadRunState(run.id);
  for (const id of order) {
    const inst = state?.instances.find((i) => i.id === id);
    const stage = inst ? graph.stages.find((s) => s.key === inst.stageKey) : undefined;
    for (const action of stage?.compensate ?? []) {
      let ok: boolean;
      if (action.config.type === 'restore_checkpoint') {
        ok = false;
        if (deps.checkpoints && run.workspaceId) {
          try {
            const r = await deps.checkpoints.restoreTurn(run.workspaceId, `attempt:${id}:1`, { workflowRunId: run.id }, 'before');
            ok = r.mounts.every((m) => m.ok);
          } catch {
            ok = false;
          }
        }
      } else {
        ok = await runAction(deps, run, { name: action.name, config: action.config, timeoutMs: action.timeoutMs, retries: action.retries }, 'on_run_failed');
      }
      if (!ok) failures.push(`compensation "${action.name}" of ${stage!.name} failed`);
    }
  }
  if (failures.length > 0) throw new PhaseFailure(failures.join('; '), {});
  return { detail: `${order.length} instance(s)` };
};

const hooks: Phase = async (ctx, run) => {
  const { deps, graph, outcome } = ctx;
  const actions = [...(outcome === 'failed' ? (graph.workflow.onFailure ?? []) : []), ...(graph.workflow.onExit ?? [])];
  for (const action of actions) {
    const ok = await runAction(deps, run, action, RUN_HOOK_PHASE[outcome]);
    if (!ok) deps.logger?.warn(`[RunLifecycle] ${run.id}: exit action "${action.name}" failed`);
  }
  await ctx.hooks(RUN_HOOK_PHASE[outcome], run);
  return {};
};

/**
 * The post-processing steps a run does: the explicit
 * `lifecycle.postProcessing.steps` in order, then the auto-steps its
 * `autoCommit` / `autoCreatePR` flags ask for. A run has something to
 * commit only when it has a codebase.
 */
export function buildPostProcessingSteps(lifecycle: Lifecycle, hasCodebases: boolean): PostProcessingStep[] {
  const config = lifecycle.postProcessing;
  const steps: PostProcessingStep[] = [...config.steps];
  // `push` is `autoPush || autoCreatePR`: a PR needs a pushed head.
  const hasExplicitCommit = steps.some((s) => s.config.type === 'commit_and_push');
  if (hasCodebases && (config.autoCommit || config.autoCreatePR) && !hasExplicitCommit) {
    steps.push({
      name: 'Auto-commit changes',
      config: {
        type: 'commit_and_push',
        commitMessage: 'feat: GeneratorAI workflow changes (run {{run.id}})',
        generateMessage: true,
        push: config.autoPush === true || config.autoCreatePR === true,
      },
      // A failed commit means there is nothing to open a PR from.
      failOnError: true,
    });
  }
  const hasExplicitPR = steps.some((s) => s.config.type === 'create_pr');
  if (hasCodebases && config.autoCreatePR && !hasExplicitPR) {
    steps.push({
      name: 'Auto-create Pull Request',
      config: {
        type: 'create_pr',
        title: 'GeneratorAI: Workflow changes',
        body: 'Automated changes generated by GeneratorAI workflow run.',
        generateText: true,
      },
      failOnError: true,
    });
  }
  return steps;
}

const postProcess: Phase = async (ctx, run) => {
  const { deps, graph, outcome } = ctx;
  if (outcome !== 'completed') return { detail: `skipped (${outcome})` };
  // A sub-workflow child in its parent's workspace: the parent commits (P05 §4.2).
  if (run.systemVars?.inheritedWorkspace) return { detail: 'skipped (the parent run commits)' };
  const codebases = run.systemVars?.codebases ?? {};
  const steps = buildPostProcessingSteps(graph.workflow.lifecycle, Object.keys(codebases).length > 0);
  if (steps.length === 0) return {};
  if (!deps.steps) throw new PhaseFailure('Post-processing steps cannot run in this process', {});
  await ctx.hooks('on_postprocessing_start', run);
  await ctx.hooks('pre_commit', run);
  const results = await deps.steps.executePostProcessing(steps, {
    runId: run.id,
    runName: run.name,
    workflowName: graph.workflow.name,
    ...(run.workspaceId ? { workspaceId: run.workspaceId } : {}),
    workDir: run.systemVars?.workingDirectory ?? '',
    variables: { ...run.variables },
    codebases: { ...codebases },
  });
  await ctx.hooks('post_commit', run);
  const pr = steps.find((s) => s.config.type === 'create_pr');
  if (pr && results.find((r) => r.stepName === pr.name)?.success) await ctx.hooks('on_pr_created', run);
  const failed = results.find((r) => !r.success && steps.find((s) => s.name === r.stepName)?.failOnError);
  const result: PhaseResult = { systemVars: { postProcessing: results }, detail: `${results.length} step(s)` };
  if (failed) throw new PhaseFailure(`post-processing step "${failed.stepName}" failed: ${failed.error ?? 'unknown error'}`, result);
  return result;
};

const release: Phase = async ({ deps, now }, run) => {
  const { stores, harness, sessionRepo } = deps;
  for (const rs of stores.runSessions.listActive(run.id)) {
    try {
      const session = await sessionRepo.getById(rs.sessionId);
      if (session.conversationId) await harness.destroyConversation(session.conversationId).catch(() => undefined);
      await sessionRepo.updateStatus(rs.sessionId, 'closed');
      await sessionRepo.update(rs.sessionId, { closedAt: new Date(now()) });
    } catch {
      /* a session that is already gone is released */
    }
    stores.runSessions.release(run.id, rs.sessionKey, now());
  }
  // The turn journal only serves a replay; a terminal run never replays (its re-run is a fork).
  for (const inst of stores.runStore.loadRunState(run.id)?.instances ?? []) stores.turns.release(inst.id);
  if (deps.sandbox && run.systemVars?.sandbox) {
    await deps.sandbox.lifecycle.destroyForRun(run.id).catch((err: unknown) => deps.logger?.warn(`[RunLifecycle] ${run.id}: sandbox teardown failed: ${String(err)}`));
    await deps.eventBus.emitGlobal({ kind: 'workflow_run.sandbox_destroyed', data: { workflowRunId: run.id } }).catch(() => undefined);
  }
  // An inherited workspace is the parent run's: it is released with the parent.
  if (run.workspaceId && !run.systemVars?.inheritedWorkspace) {
    await deps.workspaceManager.completeWorkspace(run.workspaceId).catch((err: unknown) => {
      deps.logger?.warn(`[RunLifecycle] completing the workspace of ${run.id} failed: ${String(err)}`);
    });
  }
  return {};
};

/** The finalize phases, in order. */
export const finalizePhases: ReadonlyArray<readonly [FinalizePhase, Phase]> = [
  ['compensate', compensate],
  ['hooks', hooks],
  ['postProcess', postProcess],
  ['release', release],
];
