// ────────────────────────────────────────────────────────────────
// F-settings-05 Agents (04 §3.1). Authoring lives on the dedicated /agents
// pages (an agent has instructions, a capability policy and a team; that
// does not fit a settings row), so this section is a read-only overview
// plus a jump-off point. Settings is a page addressed by URL, so leaving it
// IS the navigation.
// ────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAgents } from '@/hooks/agentQueries.js';
import { ROLE_LABELS, SCOPE_LABELS, scopeTone } from '@/lib/agentCopy.js';
import { Badge, type BadgeTone } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Icon } from '@/ui/icons/Icon.js';
import { SearchInput } from '@/ui/primitives/SearchInput/SearchInput.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { SectionHeader } from '@/ui/patterns/SectionHeader/SectionHeader.js';
import { SettingsSection } from '@/ui/patterns/SettingsSection/SettingsSection.js';

const LEGACY_TONE: Record<'neutral' | 'info' | 'success', BadgeTone> = { neutral: 'neutral', info: 'neutral', success: 'ok' };

export function AgentsSection() {
  const navigate = useNavigate();
  const { data: agents, isLoading } = useAgents();
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const list = agents ?? [];
    if (!q.trim()) return list;
    const s = q.toLowerCase();
    return list.filter((a) => a.name.toLowerCase().includes(s) || a.description.toLowerCase().includes(s));
  }, [agents, q]);

  const enabledCount = (agents ?? []).filter((a) => a.enabled).length;

  return (
    <SettingsSection
      title="Agents"
      description="Reusable agents that bundle instructions with a fixed set of skills, MCP servers and capabilities. Bind one to a chat, a workflow stage or an orchestrator's team."
    >
      <SectionHeader
        title={agents ? `${enabledCount} of ${agents.length} enabled` : 'Agents'}
        level={3}
        action={
          <div className="ml-auto flex items-center gap-2">
            <div className="w-52">
              <SearchInput value={q} onValueChange={setQ} placeholder="Search agents…" shortcut={null} label="Search agents" />
            </div>
            <Button size="sm" variant="secondary" icon="plus" onClick={() => navigate('/agents/new')}>
              New
            </Button>
          </div>
        }
      />

      {isLoading ? (
        <div className="flex items-center gap-2 text-small text-fg-3">
          <Spinner size={14} /> Loading agents…
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-6 text-center text-small text-fg-3">No agents yet. Create one to get started.</p>
      ) : (
        <div className="flex min-w-0 flex-col gap-2">
          {filtered.map((a) => (
            <Button
              key={a.id}
              variant="secondary"
              fullWidth
              onClick={() => navigate(`/agents/${a.id}`)}
              data-testid={`settings-agent-${a.slug}`}
              className="h-auto justify-start gap-3 rounded-card px-3 py-2.5 text-left font-normal"
            >
              <Icon concept={a.role === 'orchestrator' ? 'workflows' : 'agents'} size={16} className="shrink-0 text-fg-2" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-ui font-medium text-fg">{a.name}</div>
                <div className="truncate text-small text-fg-3">{a.description}</div>
              </div>
              <Badge tone={LEGACY_TONE[scopeTone(a.scope)]} className="shrink-0">
                {SCOPE_LABELS[a.scope]}
              </Badge>
              <Badge tone={a.role === 'orchestrator' ? 'ok' : 'neutral'} className="shrink-0">
                {ROLE_LABELS[a.role]}
              </Badge>
              {!a.enabled ? <Badge tone="warn" className="shrink-0">Disabled</Badge> : null}
            </Button>
          ))}
        </div>
      )}

      <Button variant="ghost" icon="external-link" onClick={() => navigate('/agents')}>
        Manage agents
      </Button>
    </SettingsSection>
  );
}
