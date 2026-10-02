// MB-04 AgentPicker model (pure): scope counts ("All 6 · Global 3 · Project 1 · Built-in 2"), the search, the
// Orchestrators / Workers sections filtered to the New chat "Who works on this" choice (MDF-52), and the row's
// mono line ("2 skills · 1 MCP" — the model is not in the list API, so it is not shown, MD-27).
import type { AgentSummary } from '@generatorai/client-core';

export type AgentScopeFilter = 'all' | 'global' | 'project' | 'system';

export const SCOPE_LABEL: Record<AgentScopeFilter, string> = { all: 'All', global: 'Global', project: 'Project', system: 'Built-in' };

export function scopeCounts(agents: readonly AgentSummary[]): Record<AgentScopeFilter, number> {
  return {
    all: agents.length,
    global: agents.filter((a) => a.scope === 'global').length,
    project: agents.filter((a) => a.scope === 'project').length,
    system: agents.filter((a) => a.scope === 'system').length,
  };
}

export function agentSections(
  agents: readonly AgentSummary[],
  options: { scope: AgentScopeFilter; query: string; role?: 'agent' | 'orchestrator' },
): Array<{ title: 'Orchestrators' | 'Workers'; agents: AgentSummary[] }> {
  const q = options.query.trim().toLowerCase();
  const list = agents.filter(
    (a) => a.enabled && (options.scope === 'all' || a.scope === options.scope) && (!options.role || a.role === options.role) && (!q || a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)),
  );
  const orchestrators = list.filter((a) => a.role === 'orchestrator');
  const workers = list.filter((a) => a.role !== 'orchestrator');
  return [
    ...(orchestrators.length ? [{ title: 'Orchestrators' as const, agents: orchestrators }] : []),
    ...(workers.length ? [{ title: 'Workers' as const, agents: workers }] : []),
  ];
}

export function agentFacts(agent: Pick<AgentSummary, 'skillIds' | 'mcpServerIds'>): string {
  const skills = agent.skillIds.length;
  return `${skills} skill${skills === 1 ? '' : 's'} · ${agent.mcpServerIds.length} MCP`;
}
