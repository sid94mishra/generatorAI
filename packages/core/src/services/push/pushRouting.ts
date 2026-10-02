import type { PushData } from '@generatorai/shared';
import type { NotificationPlan } from './notificationPolicy.js';

/** Keep legacy `route` unchanged; v2 clients consume only the scoped web href. */
export function pushRouting(plan: NotificationPlan, serverId: string, workflowDefinitionId?: string | null): Partial<PushData> {
  const [kind, ...parts] = plan.threadId.split(':');
  const id = parts.join(':');
  const scope = { v: 2 as const, serverId };
  if (kind === 'chat') return { ...scope, href: plan.route, entity: 'chat', entityId: id };
  if (kind === 'run') return {
    ...scope, href: workflowDefinitionId ? `/workflows/${encodeURIComponent(workflowDefinitionId)}/runs/${encodeURIComponent(id)}` : '/workflows',
    entity: 'workflow_run', entityId: id,
    ...(workflowDefinitionId ? { workflowDefinitionId } : {}),
  };
  // An automation thread names its definition, not an execution. Do not invent an execution id.
  return { ...scope, href: plan.route };
}
