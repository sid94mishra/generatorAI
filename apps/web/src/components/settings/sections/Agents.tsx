// ────────────────────────────────────────────────────────────────
// AgentsSection — the Settings entry point for the agent catalog.
//
// Authoring lives on the dedicated /agents pages (an agent has instructions,
// a capability policy and a team; that does not fit a settings row), so this
// section is a read-only overview plus a jump-off point.
// ────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, Network, ExternalLink, Plus } from 'lucide-react';

import { useAgents } from '@/hooks/agentQueries.js';
import { Badge, Button, SearchInput, Spinner } from '@/components/ui/index.js';
import { SectionHeader, SectionListHeader } from '../shared.js';
import { SCOPE_LABELS, ROLE_LABELS, scopeTone } from '@/lib/agentCopy.js';

export function AgentsSection() {
  const navigate = useNavigate();
  const { data: agents, isLoading } = useAgents();
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const list = agents ?? [];
    if (!q.trim()) return list;
    const s = q.toLowerCase();
    return list.filter(
      (a) => a.name.toLowerCase().includes(s) || a.description.toLowerCase().includes(s),
    );
  }, [agents, q]);

  // Settings is a page now, so leaving it IS the navigation — closing a
  // modal first would leave a stray "/" entry in the history between here
  // and where the user actually asked to go.
  const go = (path: string) => {
    navigate(path);
  };

  const enabledCount = (agents ?? []).filter((a) => a.enabled).length;

  return (
    <div>
      <SectionHeader
        title="Agents"
        description="Reusable agents that bundle instructions with a fixed set of skills, MCP servers and capabilities. Bind one to a chat, a workflow stage or an orchestrator's team."
      />

      <SectionListHeader
        title={agents ? `${enabledCount} of ${agents.length} enabled` : 'Agents'}
        action={
          <div className="flex items-center gap-2">
            <div className="w-[13rem]">
              <SearchInput value={q} onChange={setQ} placeholder="Search agents…" />
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => go('/agents/new')}
              leftIcon={<Plus className="h-3.5 w-3.5" />}
            >
              New
            </Button>
          </div>
        }
      />

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner size="sm" /> Loading agents…
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No agents yet. Create one to get started.
        </p>
      ) : (
        <div className="grid min-w-0 gap-2">
          {filtered.map((a) => (
            <Button variant="unstyled"
              key={a.id}
              type="button"
              onClick={() => go(`/agents/${a.id}`)}
              data-testid={`settings-agent-${a.slug}`}
              // `min-w-0` on the row: a grid item defaults to `min-width:auto`,
              // so without it a long description widens the row past the panel
              // and the trailing badges scroll out of view instead of truncating.
              className="flex w-full min-w-0 items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/40"
            >
              {a.role === 'orchestrator' ? (
                <Network className="h-4 w-4 shrink-0 text-primary" />
              ) : (
                <Bot className="h-4 w-4 shrink-0 text-primary" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">{a.name}</div>
                <div className="truncate text-xs text-muted-foreground">{a.description}</div>
              </div>
              <Badge tone={scopeTone(a.scope)} size="sm" className="shrink-0">
                {SCOPE_LABELS[a.scope]}
              </Badge>
              <Badge
                tone={a.role === 'orchestrator' ? 'primary' : 'neutral'}
                size="sm"
                className="shrink-0"
              >
                {ROLE_LABELS[a.role]}
              </Badge>
              {!a.enabled && (
                <Badge tone="warning" size="sm" className="shrink-0">
                  Disabled
                </Badge>
              )}
            </Button>
          ))}
        </div>
      )}

      <div className="mt-4">
        <Button
          variant="ghost"
          onClick={() => go('/agents')}
          leftIcon={<ExternalLink className="h-3.5 w-3.5" />}
        >
          Manage agents
        </Button>
      </div>
    </div>
  );
}
