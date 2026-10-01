import { attentionItemRoute, toEpochMs } from '@generatorai/client-core';
import type { AttentionItem, AttentionSnapshot, RecentActivityItem } from '@generatorai/shared';
import type { GateInfo, Operation } from '../../services/api/activityRanking';

function gateOf(item: AttentionItem): GateInfo | undefined {
  const ask = item.ask;
  if (item.entity !== 'chat' || !ask) return undefined;
  if (ask.kind !== 'tool_permission' && ask.kind !== 'question' && ask.kind !== 'plan_review') return undefined;
  return {
    interactionId: ask.id, kind: ask.kind, summary: ask.summary,
    ...(ask.kind === 'tool_permission' ? { permissionAllowed: ask.actions.includes('allow_once') && ask.actions.includes('deny') } : {}),
  };
}

/** Adapt server feed facts to the legacy row contract until M7 redraws Home. */
export function activityOperations(snapshot: AttentionSnapshot | null, recent: readonly RecentActivityItem[], serverId?: string | null): Operation[] {
  const routeFor = (href: string) => {
    const target = attentionItemRoute({ href }, serverId ?? 'current');
    return target ? `${target.pathname}?${new URLSearchParams(target.params)}` : '/';
  };
  const active = [...(snapshot?.needsYou ?? []), ...(snapshot?.running ?? [])];
  const liveEntities = new Set(active.map((item) => `${item.entity}:${item.entityId}`));
  const rows: Operation[] = active.map((item) => ({
    id: item.key, entityId: item.entityId,
    kind: item.entity === 'workflow_run' ? 'run' : item.entity === 'chat' ? 'chat' : 'automation',
    name: item.title, status: item.state === 'needs_you' ? 'awaiting_input' : item.state,
    updatedAt: toEpochMs(item.since) ?? 0, href: serverId ? routeFor(item.href) : item.href,
    blocked: Boolean(item.ask), running: !item.ask, stoppable: item.stoppable,
    gate: gateOf(item),
  }));
  for (const item of recent) {
    const entity = item.entity === 'run' ? 'workflow_run' : item.entity;
    if (liveEntities.has(`${entity}:${item.entityId}`)) continue;
    rows.push({
      id: item.key, entityId: item.entityId,
      kind: item.entity === 'run' ? 'run' : item.entity === 'chat' ? 'chat' : 'automation',
      name: item.title, status: item.outcome === 'succeeded' ? 'completed' : item.outcome,
      updatedAt: toEpochMs(item.endedAt) ?? 0, href: serverId ? routeFor(item.href) : item.href, blocked: false, running: false, retryable: item.retry === 'run_retry',
    });
  }
  return rows;
}
