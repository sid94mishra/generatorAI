import { describe, expect, it } from 'vitest';
import type { AgentSummary } from '@generatorai/client-core';
import { agentFacts, agentSections, scopeCounts } from './agentPickerModel';

const agent = (name: string, scope: AgentSummary['scope'], role: AgentSummary['role'] = 'agent', enabled = true): AgentSummary => ({
  id: name,
  ref: `${scope}:${name}`,
  scope,
  slug: name,
  name,
  description: `${name} does things`,
  role,
  enabled,
  skillIds: ['a', 'b'],
  mcpServerIds: ['m'],
  version: 1,
});

describe('AgentPicker (MB-04)', () => {
  const agents = [agent('Orchestrator', 'global', 'orchestrator'), agent('Bug Fixer', 'project'), agent('Code Reviewer', 'system'), agent('Off', 'global', 'agent', false)];

  it('counts per scope and sections orchestrators before workers', () => {
    expect(scopeCounts(agents)).toEqual({ all: 4, global: 2, project: 1, system: 1 });
    expect(agentSections(agents, { scope: 'all', query: '' }).map((s) => `${s.title}:${s.agents.length}`)).toEqual(['Orchestrators:1', 'Workers:2']);
  });

  it('filters by the "Who works on this" role, the scope and the search; hides disabled agents', () => {
    expect(agentSections(agents, { scope: 'all', query: '', role: 'orchestrator' }).map((s) => s.title)).toEqual(['Orchestrators']);
    expect(agentSections(agents, { scope: 'system', query: '' })[0]!.agents.map((a) => a.name)).toEqual(['Code Reviewer']);
    expect(agentSections(agents, { scope: 'all', query: 'bug' })[0]!.agents.map((a) => a.name)).toEqual(['Bug Fixer']);
    expect(agentFacts(agents[1]!)).toBe('2 skills · 1 MCP');
  });
});
