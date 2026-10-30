import type { PushData } from '@generatorai/shared';
import type { NotificationPlan } from './notificationPolicy.js';

/** A run approval opens its approval sheet (MB-50); everything else about a run opens the run. */
function runHref(plan: NotificationPlan, runId: string, workflowDefinitionId?: string | null): string {
  if (!workflowDefinitionId) return '/workflows';
  const run = `/workflows/${encodeURIComponent(workflowDefinitionId)}/runs/${encodeURIComponent(runId)}`;
  return plan.categoryId === 'run.approval' && plan.stageRunId ? `${run}/approval/${encodeURIComponent(plan.stageRunId)}` : run;
}

/** Keep legacy `route` unchanged; v2 clients consume only the scoped web href. */
export function pushRouting(plan: NotificationPlan, serverId: string, workflowDefinitionId?: string | null): Partial<PushData> {
  const [kind, ...parts] = plan.threadId.split(':');
  const id = parts.join(':');
  const scope = { v: 2 as const, serverId };
  if (kind === 'chat') return { ...scope, href: plan.route, entity: 'chat', entityId: id };
  if (kind === 'run') return {
    ...scope, href: runHref(plan, id, workflowDefinitionId),
    entity: 'workflow_run', entityId: id,
    ...(workflowDefinitionId ? { workflowDefinitionId } : {}),
  };
  // An automation thread names its definition, not an execution. Do not invent an execution id.
  return { ...scope, href: plan.route };
}
