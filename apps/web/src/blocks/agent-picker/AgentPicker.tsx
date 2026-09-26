// ────────────────────────────────────────────────────────────────
// B-02 AgentPicker — the connected block (03 §2.1). Replaces
// components/agents/AgentPicker.tsx with the same props and behaviour.
//
// Bound by the PORTABLE `scope:slug` ref rather than the row id, so an
// exported workflow keeps working when it is imported into an installation
// where the same agent has a different primary key. Data:
// `useSelectableAgents(projectId)` (a project agent hides a global one of the
// same slug, a global one a built-in one); disabled agents are hidden.
// ────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import type { Agent, AgentRole } from '@generatorai/shared';
import { useSelectableAgents } from '@/hooks/agentQueries.js';
import { AgentPickerView } from './AgentPicker.view.js';

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
  /** Render the "N skills · M MCP servers · model" summary line under the trigger. */
  showSummary?: boolean;
  'data-testid'?: string;
}

/** Choose "No agent", a worker or an orchestrator from the selectable agents. */
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
  const navigate = useNavigate();

  const enabled = useMemo(() => (agents ?? []).filter((a) => a.enabled), [agents]);
  const candidates = useMemo(() => {
    const excluded = new Set(excludeRefs ?? []);
    return enabled.filter((a) => !excluded.has(a.ref) && (!role || a.role === role));
  }, [enabled, role, excludeRefs]);

  return (
    <AgentPickerView
      agents={candidates}
      teamPool={enabled}
      value={value}
      onSelect={(ref) => onChange(ref, ref ? candidates.find((a) => a.ref === ref) : undefined)}
      loading={isLoading}
      disabled={disabled}
      placeholder={placeholder}
      showSummary={showSummary}
      manageAgentsHref="/agents"
      onNavigate={(href) => navigate(href)}
      className={className}
      data-testid={testId}
    />
  );
}
