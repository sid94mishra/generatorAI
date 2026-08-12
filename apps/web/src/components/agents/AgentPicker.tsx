// ────────────────────────────────────────────────────────────────
// AgentPicker — choose an agent to drive a chat, stage or worker.
//
// Bound by the PORTABLE `scope:slug` ref rather than the row id, so an
// exported workflow keeps working when it is imported into an installation
// where the same agent has a different primary key.
// ────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import { Bot, Network } from 'lucide-react';
import { useSelectableAgents } from '@/hooks/agentQueries.js';
import { SearchableSelect, Badge } from '@/components/ui/index.js';
import { SCOPE_LABELS } from '@/lib/agentCopy.js';
import type { Agent, AgentRole } from '@generatorai/shared';

export interface AgentPickerProps {
  value: string | undefined;
  onChange: (ref: string | undefined, agent: Agent | undefined) => void;
  projectId?: string;
  /** Restrict the list, e.g. only orchestrators or only plain agents. */
  role?: AgentRole;
  /** Refs to exclude — used to stop an orchestrator listing itself as a team member. */
  excludeRefs?: string[];
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  /** Render the "N skills · M MCP" summary line under the trigger. */
  showSummary?: boolean;
  'data-testid'?: string;
}

export function AgentPicker({
  value,
  onChange,
  projectId,
  role,
  excludeRefs,
  disabled = false,
  placeholder = 'No agent (platform default)',
  className,
  showSummary = true,
  'data-testid': testId,
}: AgentPickerProps) {
  const { data: agents, isLoading } = useSelectableAgents(projectId);

  const candidates = useMemo(() => {
    const excluded = new Set(excludeRefs ?? []);
    return (agents ?? []).filter(
      (a) => a.enabled && !excluded.has(a.ref) && (!role || a.role === role),
    );
  }, [agents, role, excludeRefs]);

  const selected = candidates.find((a) => a.ref === value);

  return (
    <div className={className}>
      <SearchableSelect<Agent>
        items={candidates}
        value={value ?? null}
        onSelect={(ref, agent) => onChange(ref, agent)}
        getKey={(a) => a.ref}
        getLabel={(a) => a.name}
        getSearchText={(a) => `${a.slug} ${a.description} ${a.tags.join(' ')}`}
        placeholder={placeholder}
        searchPlaceholder="Search agents…"
        emptyText="No agents available."
        disabled={disabled}
        loading={isLoading}
        clearable
        onClear={() => onChange(undefined, undefined)}
        data-testid={testId ?? 'agent-picker'}
        renderItem={(a) => (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {a.role === 'orchestrator' ? (
              <Network className="h-3.5 w-3.5 shrink-0 text-primary" />
            ) : (
              <Bot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-foreground">{a.name}</div>
              <div className="truncate text-[10px] text-muted-foreground">{a.description}</div>
            </div>
            <Badge tone="neutral" size="sm" className="text-[9px]">
              {SCOPE_LABELS[a.scope]}
            </Badge>
          </div>
        )}
      />
      {showSummary && selected && (
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {selected.role === 'orchestrator' ? (
            <Network className="h-3 w-3" />
          ) : (
            <Bot className="h-3 w-3" />
          )}
          <span className="truncate">
            {selected.skillIds.length} skills · {selected.mcpServerIds.length} MCP servers
            {selected.runtime.model ? ` · ${selected.runtime.model}` : ''}
          </span>
        </div>
      )}
    </div>
  );
}
