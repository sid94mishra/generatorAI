import { describe, expect, it } from 'vitest';

import { filterTemplates, parseTemplates, templateSubtitle } from '../components/work/templateModel';

const graph = (workflow: Record<string, unknown>, stages: number) => ({
  formatVersion: 2,
  workflow,
  stages: Array.from({ length: stages }, (_, i) => ({ kind: 'agent', key: `s${i}`, name: `S${i}` })),
  edges: [],
});

const RAW = [
  {
    id: 'b',
    category: 'code-generation',
    graph: graph({ name: 'Bug fix', description: 'Fix a bug', variables: [{ name: 'issue' }], lifecycle: { requiresCodebase: true } }, 2),
  },
  { id: 'a', category: 'testing', graph: graph({ name: 'Audit' }, 1) },
  { id: 'c', category: 'code-generation', graph: graph({ name: 'Changelog' }, 0) },
  { graph: graph({ name: 'no id' }, 1) },
];

describe('templates', () => {
  it('reads name, description, inputs and lifecycle from the graph; sorts by category then name', () => {
    const list = parseTemplates(RAW);
    expect(list.map((t) => t.id)).toEqual(['b', 'c', 'a']);
    expect(list[0]).toMatchObject({ name: 'Bug fix', stageCount: 2, variableCount: 1, requiresCodebase: true });
    expect(list[2]).toMatchObject({ name: 'Audit', description: null, requiresCodebase: false });
    expect(parseTemplates('x')).toEqual([]);
  });

  it('filters by name, description or category', () => {
    const list = parseTemplates(RAW);
    expect(filterTemplates(list, 'TESTI').map((t) => t.id)).toEqual(['a']);
    expect(filterTemplates(list, 'fix').map((t) => t.id)).toEqual(['b']);
    expect(filterTemplates(list, ' ')).toHaveLength(3);
  });

  it('summarises', () => {
    expect(templateSubtitle(parseTemplates(RAW)[0]!)).toBe('code-generation · 2 stages · needs a codebase · Fix a bug');
  });
});
