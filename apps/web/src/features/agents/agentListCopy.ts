// ────────────────────────────────────────────────────────────────
// Agents feature — presentation helpers local to this domain.
//
// `lib/agentCopy.ts` is shared with the legacy Settings › Agents section
// (`components/settings/sections/Agents.tsx`, out of scope for this pass) and
// its legacy Badge, whose tone vocabulary differs from the kit's (P-05:
// neutral/run/ok/warn/err vs the legacy primary/success/warning/danger/info).
// Redefining `ROLE_LABELS`/`scopeTone` there would ripple into that page's
// rendered copy and its Badge typing, so the kit-flavoured versions live
// here instead.
// ────────────────────────────────────────────────────────────────

import type { Agent, AgentRole } from '@generatorai/shared';

/** "Worker" (not "Agent") distinguishes the role from the Agent entity itself — matches B-02 AgentPicker's Orchestrators/Workers grouping (`agentPickerModel.ts`). */
export const ROLE_LABEL: Record<AgentRole, string> = {
  agent: 'Worker',
  orchestrator: 'Orchestrator',
};

/** "Built-in · read-only", "Project · payments-service", "Global". */
export function scopeMeta(agent: Agent, projectName: string | undefined): string {
  if (agent.scope === 'system') return 'Built-in · read-only';
  if (agent.scope === 'project') return `Project${projectName ? ` · ${projectName}` : ''}`;
  return 'Global';
}

/** Worker: "claude-sonnet-5 · medium · 3 skills · 1 MCP". Orchestrator: "team of 3 · 5 workers max". */
export function agentMetaLine(agent: Agent): string {
  if (agent.role === 'orchestrator') {
    const teamSize = agent.orchestration?.teamAgentRefs.length ?? 0;
    const team = teamSize > 0 ? `team of ${teamSize}` : 'team: any enabled agent';
    const maxWorkers = agent.orchestration?.maxWorkers;
    return maxWorkers !== undefined ? `${team} · ${maxWorkers} workers max` : team;
  }
  const skillCount = `${agent.skillIds.length} skill${agent.skillIds.length === 1 ? '' : 's'}`;
  const mcpCount = `${agent.mcpServerIds.length} MCP`;
  return [agent.runtime.model, agent.runtime.reasoningEffort, skillCount, mcpCount]
    .filter((part): part is string => Boolean(part))
    .join(' · ');
}
