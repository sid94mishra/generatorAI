import { describe, expect, it } from 'vitest';
import type { Agent } from '@generatorai/shared';

import {
  BLANK_DRAFT,
  agentFacts,
  agentMenu,
  changeCount,
  createBody,
  deleteDialog,
  draftFrom,
  duplicateDraft,
  filterAgents,
  instructionsLevel,
  modelLine,
  scopeCounts,
  triOf,
  updateBody,
  usedWorkflows,
  validateDraft,
  withName,
  withTri,
  type AgentListItem,
} from '../model/agentsModel';

const item = (p: Partial<AgentListItem>): AgentListItem => ({
  id: p.slug ?? 'a',
  ref: `global:${p.slug ?? 'a'}`,
  scope: 'global',
  slug: 'a',
  name: 'A',
  description: 'does things well',
  role: 'agent',
  enabled: true,
  skillIds: [],
  mcpServerIds: [],
  version: 1,
  ...p,
});

const agent: Agent = {
  id: 'id1',
  scope: 'global',
  projectId: '',
  slug: 'bug-fixer',
  ref: 'global:bug-fixer',
  name: 'Bug Fixer',
  description: 'Diagnoses and fixes defects.',
  instructions: 'You fix the cause.',
  role: 'agent',
  projection: 'append',
  tags: ['debugging'],
  enabled: true,
  skillIds: ['s1'],
  mcpServerIds: ['github'],
  tools: { shell: true },
  runtime: { model: 'claude-sonnet-5', reasoningEffort: 'medium', maxTurns: 40 },
  version: 4,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('list', () => {
  const list = [item({ slug: 'b', name: 'Bug Fixer', scope: 'global' }), item({ slug: 'c', name: 'Code Reviewer', scope: 'system' }), item({ slug: 'o', name: 'Orchestrator', role: 'orchestrator', orchestration: { teamAgentRefs: ['x', 'y', 'z'] } })];
  it('counts scopes and filters by scope, role and search', () => {
    expect(scopeCounts(list)).toEqual({ all: 3, system: 1, global: 2, project: 0 });
    expect(filterAgents(list, { scope: 'global', role: 'any', query: '', sort: 'name' }).map((a) => a.slug)).toEqual(['b', 'o']);
    expect(filterAgents(list, { scope: 'all', role: 'orchestrator', query: '', sort: 'name' }).map((a) => a.slug)).toEqual(['o']);
    expect(filterAgents(list, { scope: 'all', role: 'any', query: 'review', sort: 'name' }).map((a) => a.slug)).toEqual(['c']);
  });
  it('describes rows from what they carry', () => {
    expect(modelLine({ model: 'claude-sonnet-5', reasoningEffort: 'medium' })).toBe('claude-sonnet-5 · medium');
    expect(modelLine(undefined)).toBeNull();
    expect(agentFacts(item({ skillIds: ['a', 'b'], mcpServerIds: ['m'] }))).toEqual(['2 skills', '1 MCP']);
    expect(agentFacts(list[2]!)).toEqual(['team of 3']);
    expect(agentFacts(list[1]!)).toEqual(['read-only']);
  });
  it('built-ins only duplicate and export', () => {
    const ids = (m: ReturnType<typeof agentMenu>) => m.filter((e) => 'id' in e).map((e) => (e as { id: string }).id);
    expect(ids(agentMenu({ scope: 'system' }, true))).toEqual(['duplicate', 'export']);
    expect(ids(agentMenu({ scope: 'global' }, true))).toEqual(['edit', 'duplicate', 'export', 'delete']);
    expect(ids(agentMenu({ scope: 'global' }, false))).toEqual(['export']);
  });
});

describe('editor draft', () => {
  it('round-trips an agent and counts changes per field and capability', () => {
    const saved = draftFrom(agent);
    expect(changeCount(saved, saved)).toBe(0);
    const edited = { ...withName(saved, 'Bug Squasher'), tools: withTri(saved.tools, 'web', 'off') };
    // A touched slug does not follow the name.
    expect(edited.slug).toBe('bug-fixer');
    expect(changeCount(saved, edited)).toBe(2);
    expect(updateBody(edited)).not.toHaveProperty('scope');
    expect(updateBody(edited).runtime).toEqual({ model: 'claude-sonnet-5', reasoningEffort: 'medium', maxTurns: 40 });
  });
  it('tri-states map Inherit to an absent key', () => {
    expect(triOf({}, 'shell')).toBe('inherit');
    expect(withTri({ shell: true }, 'shell', 'inherit')).toEqual({});
    expect(withTri({}, 'web', 'off')).toEqual({ web: false });
  });
  it('a duplicate gets a new name and a slug that follows it', () => {
    const d = duplicateDraft({ ...agent, scope: 'system' });
    expect(d.name).toBe('Bug Fixer copy');
    expect(d.slug).toBe('bug-fixer-copy');
    expect(d.scope).toBe('global');
    expect(withName(d, 'Fixer Two').slug).toBe('fixer-two');
  });
  it('validates and builds the create body', () => {
    expect(Object.keys(validateDraft(BLANK_DRAFT))).toEqual(['name', 'slug', 'description', 'instructions']);
    const ok = { ...withName(BLANK_DRAFT, 'Planner'), description: 'Plans the work ahead', instructions: 'Plan.', role: 'orchestrator' as const, team: ['global:x'], maxWorkers: 3 };
    expect(validateDraft(ok)).toEqual({});
    expect(validateDraft(ok, new Set(['planner'])).slug).toMatch(/slug/);
    expect(validateDraft({ ...ok, scope: 'project' }).projectId).toBeDefined();
    expect(createBody(ok)).toMatchObject({ scope: 'global', slug: 'planner', orchestration: { teamAgentRefs: ['global:x'], maxWorkers: 3 } });
    expect(instructionsLevel('x'.repeat(9 * 1024))).toBe('warn');
    expect(instructionsLevel('x'.repeat(33 * 1024))).toBe('error');
  });
});

describe('delete', () => {
  it('deletes a free agent and disables a bound one', () => {
    expect(deleteDialog('A', { chats: [], stages: [], workflows: [] })).toMatchObject({ confirmLabel: 'Delete agent', force: false });
    const bound = deleteDialog('Bug Fixer', {
      chats: [{ id: 'c', name: 'Fix flaky test' }],
      stages: [{ id: 's', name: 'triage', workflowDefinitionId: 'w1' }],
      workflows: [{ id: 'w1', name: 'Flaky test triage' }, { id: 'w2', name: 'Nightly audit' }],
    });
    expect(bound).toMatchObject({ title: 'Disable “Bug Fixer”?', confirmLabel: 'Disable agent', force: true });
    expect(bound.impact).toEqual(['2 workflows: Flaky test triage, Nightly audit', '1 chat: Fix flaky test']);
    expect(usedWorkflows({ chats: [], workflows: [], stages: [{ id: 's', name: 'st', workflowDefinitionId: 'w9' }] })).toEqual([{ id: 'w9', name: 'st', stage: 'st' }]);
  });
});
