// ────────────────────────────────────────────────────────────────
// AgentUsedBy — the agent editor's "Used by" aside card (AgentEditor board;
// D-78 follow-up): the workflows (with their stages) and chats bound to this
// agent, from `GET /api/agents/:id/usage`. Nothing renders until there is a
// binding, so a fresh agent shows no empty card (D-36).
// ────────────────────────────────────────────────────────────────

import { Link as RouterLink } from 'react-router';
import { useAgentUsage } from '@/hooks/agentQueries.js';
import { Icon } from '@/ui/icons/Icon.js';
import { Card } from '@/ui/primitives/Card/Card.js';
import { Link } from '@/ui/primitives/Link/Link.js';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function AgentUsedBy({ agentId }: { agentId: string }) {
  const { data } = useAgentUsage(agentId);
  if (!data || (data.workflows.length === 0 && data.chats.length === 0)) return null;
  const stagesOf = (workflowId: string) => data.stages.filter((s) => s.workflowDefinitionId === workflowId).map((s) => s.name);

  return (
    <Card data-testid="agent-used-by">
      <Card.Header
        title="Used by"
        meta={`${plural(data.workflows.length, 'workflow', 'workflows')} · ${plural(data.chats.length, 'chat', 'chats')}`}
      />
      <Card.Body className="flex flex-col gap-1.5">
        {data.workflows.map((w) => {
          const stages = stagesOf(w.id);
          return (
            <div key={w.id} className="flex min-w-0 items-center gap-2 text-small">
              <Icon concept="workflows" size={14} className="shrink-0 text-fg-3" />
              <Link render={<RouterLink to={`/workflows/${w.id}`} />} className="min-w-0 truncate">
                {w.name}
              </Link>
              {stages.length > 0 ? <span className="ml-auto shrink-0 truncate text-micro text-fg-3">{stages.join(', ')}</span> : null}
            </div>
          );
        })}
        {data.chats.map((c) => (
          <div key={c.id} className="flex min-w-0 items-center gap-2 text-small">
            <Icon concept="chats" size={14} className="shrink-0 text-fg-3" />
            <Link render={<RouterLink to={`/chats/${c.id}`} />} className="min-w-0 truncate">
              {c.name}
            </Link>
          </div>
        ))}
      </Card.Body>
    </Card>
  );
}
