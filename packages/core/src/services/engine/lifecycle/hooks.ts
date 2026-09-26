// ────────────────────────────────────────────────────────────────
// Workflow hooks and actions of the run lifecycle (P04 WP-4.1). The
// lifecycle phases are their ONE owner (C-17): each phase fires its hook
// phases once, and the journal keeps a resumed phase from firing them again.
// ────────────────────────────────────────────────────────────────

import type { HookDefinition, HookPhaseResult, WorkflowRun } from '@generatorai/shared';
import type { ActionDefinition, WorkflowGraph, WorkflowHookDefinition } from '@generatorai/workflow-spec';
import { expressionScope } from '../../../domain/scheduler/readiness.js';
import type { HookContext } from '../../HookExecutor.js';
import type { RunLifecycleDeps } from '../RunLifecycle.js';

/** The hook context of a run-level hook: the run's working directory and its whole expression scope. */
export function runHookContext(deps: Pick<RunLifecycleDeps, 'stores' | 'eventBus'>, run: WorkflowRun): HookContext {
  const state = deps.stores.runStore.loadRunState(run.id);
  return {
    sessionId: `__run_service_${run.id}__`,
    workflowId: run.workflowDefinitionId,
    workspacePath: run.systemVars?.workingDirectory ?? '',
    variables: Object.fromEntries(Object.entries(run.variables ?? {}).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])),
    eventBus: deps.eventBus,
    workflowRunId: run.id,
    ...(state ? { templateScope: expressionScope({ ...state.run, variables: run.variables ?? {} }, state.instances) } : {}),
  };
}

const CONTINUE: HookPhaseResult = { shouldContinue: true, mergedResult: {} };

/** Fire one workflow hook phase. A hook error is logged and does not stop the lifecycle; an abort is returned. */
export async function runWorkflowHooks(
  deps: Pick<RunLifecycleDeps, 'hookExecutor' | 'stores' | 'eventBus' | 'logger'>,
  phase: string,
  graph: WorkflowGraph,
  run: WorkflowRun,
): Promise<HookPhaseResult> {
  const hooks = graph.workflow.hooks;
  if (!deps.hookExecutor || hooks.length === 0 || !hooks.some((h) => h.phase === phase)) return CONTINUE;
  try {
    return await deps.hookExecutor.executePhase(phase as WorkflowHookDefinition['phase'], [...hooks] as unknown as HookDefinition[], runHookContext(deps, run));
  } catch (err) {
    deps.logger?.warn(`[RunLifecycle] run hook phase '${phase}' failed: ${String(err)}`);
    return CONTINUE;
  }
}

/** One action (onExit / onFailure / compensation), run as a single-hook phase whose failure is reported. */
export async function runAction(
  deps: Pick<RunLifecycleDeps, 'hookExecutor' | 'stores' | 'eventBus'>,
  run: WorkflowRun,
  action: ActionDefinition,
  phase: WorkflowHookDefinition['phase'],
): Promise<boolean> {
  if (!deps.hookExecutor) return true;
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
    const r = await deps.hookExecutor.executePhase(phase, [hook] as unknown as HookDefinition[], runHookContext(deps, run));
    return r.shouldContinue;
  } catch {
    return false;
  }
}
