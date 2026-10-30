// ────────────────────────────────────────────────────────────────
// B-02 AgentPicker — pure helpers: scope filter + counts, search, the
// Orchestrators / Workers grouping, the "3 skills · 1 MCP server · model"
// summary and an orchestrator's team. React-free (view, block and tests).
// ────────────────────────────────────────────────────────────────

import type { Agent, AgentScope } from '@generatorai/shared';
import { SCOPE_LABELS } from '@/lib/agentCopy.js';

export type AgentScopeFilter = 'all' | AgentScope;

/** Scope tabs in board order: All · Global · Project · Built-in. */
export const SCOPE_FILTERS: readonly AgentScopeFilter[] = ['all', 'global', 'project', 'system'];

export function scopeFilterLabel(scope: AgentScopeFilter): string {
  return scope === 'all' ? 'All' : SCOPE_LABELS[scope];
}

export function scopeLabel(scope: AgentScope): string {
  return SCOPE_LABELS[scope];
}

/** How many agents each scope tab holds. */
export function scopeCounts(agents: readonly Agent[]): Record<AgentScopeFilter, number> {
  const counts: Record<AgentScopeFilter, number> = { all: agents.length, global: 0, project: 0, system: 0 };
  for (const agent of agents) counts[agent.scope] += 1;
  return counts;
}

/** Scope tab + case-insensitive match on name, slug, description and tags. */
export function filterAgents(agents: readonly Agent[], scope: AgentScopeFilter, query: string): Agent[] {
  const q = query.trim().toLowerCase();
  return agents.filter((a) => {
    if (scope !== 'all' && a.scope !== scope) return false;
    if (!q) return true;
    return [a.name, a.slug, a.description, ...a.tags].some((text) => text.toLowerCase().includes(q));
  });
}

export interface AgentGroup {
  key: 'orchestrators' | 'workers';
  label: string;
  agents: Agent[];
}

/** Orchestrators first, then workers; empty groups are dropped. */
export function groupAgents(agents: readonly Agent[]): AgentGroup[] {
  const groups: AgentGroup[] = [
    { key: 'orchestrators', label: 'Orchestrators', agents: agents.filter((a) => a.role === 'orchestrator') },
    { key: 'workers', label: 'Workers', agents: agents.filter((a) => a.role !== 'orchestrator') },
  ];
  return groups.filter((g) => g.agents.length > 0);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "3 skills · 1 MCP" — the row's capability counts. */
export function capabilityCounts(agent: Agent): string {
  return `${plural(agent.skillIds.length, 'skill', 'skills')} · ${agent.mcpServerIds.length} MCP`;
}

/** The trigger's meta line: "3 skills · 1 MCP server · claude-sonnet-5". */
export function agentSummary(agent: Agent): string {
  return [
    plural(agent.skillIds.length, 'skill', 'skills'),
    plural(agent.mcpServerIds.length, 'MCP server', 'MCP servers'),
    agent.runtime.model ?? null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** "Orchestrator · Global · v3". */
export function agentHeadline(agent: Agent): string {
  return `${agent.role === 'orchestrator' ? 'Orchestrator' : 'Worker'} · ${scopeLabel(agent.scope)} · v${agent.version}`;
}

/**
 * The agents an orchestrator may spawn: its `teamAgentRefs`, resolved against
 * the selectable list (unknown refs are dropped); an empty list means "any
 * enabled non-orchestrator agent" (AgentOrchestrationPolicy).
 */
export function teamOf(agent: Agent, all: readonly Agent[]): Agent[] {
  if (agent.role !== 'orchestrator') return [];
  const refs = agent.orchestration?.teamAgentRefs ?? [];
  if (refs.length === 0) return all.filter((a) => a.enabled && a.role !== 'orchestrator');
  const byRef = new Map(all.map((a) => [a.ref, a]));
  return refs.flatMap((ref) => byRef.get(ref) ?? []);
}
