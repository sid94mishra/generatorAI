import { describe, expect, it } from 'vitest';
import type { WorkflowGraph } from '@generatorai/workflow-spec';

import { graphSummary, runGraphView } from './runGraphModel';

const agent = (key: string, extra: Record<string, unknown> = {}) => ({ key, name: key.toUpperCase(), kind: 'agent', prompts: [], join: { mode: 'all' }, ...extra });
const GRAPH = {
  stages: [agent('scan'), agent('assess', { approval: { allowChanges: true, maxRounds: 3 } }), { key: 'fix_loop', name: 'Fix loop', kind: 'loop', join: { mode: 'all' }, loop: { maxIterations: 3 } }, agent('fix', { parentKey: 'fix_loop' }), agent('notify')],
  edges: [
    { from: 'scan', to: 'assess', on: 'success' },
    { from: 'assess', to: 'fix_loop', on: 'success', when: "max_risk == 'high'" },
    { from: 'fix_loop', to: 'notify', on: 'failure' },
  ],
} as unknown as Pick<WorkflowGraph, 'stages' | 'edges'>;

describe('runGraphView', () => {
  it('lays out the top level only and labels conditional edges', () => {
    const view = runGraphView(GRAPH);
    expect(view.layout.nodes.map((n) => n.key)).toEqual(['scan', 'assess', 'fix_loop', 'notify']);
    expect(view.nodes.get('fix_loop')?.children).toBe(1);
    expect(view.nodes.get('assess')?.approval).toBe(true);
    const labels = view.layout.edges.map((e) => e.label);
    expect(labels).toEqual([undefined, "when max_risk == 'high'", 'on failure']);
    expect(view.layout.edges.filter((e) => e.dashed)).toHaveLength(2);
  });

  it('thickens the edges a run went through and names nodes with their status', () => {
    const view = runGraphView(GRAPH, new Map([
      ['scan', { state: 'succeeded' as const, label: 'Succeeded' }],
      ['assess', { state: 'running' as const, label: 'Running' }],
      ['fix_loop', { state: 'queued' as const, label: 'Queued' }],
    ]));
    expect(view.layout.edges.find((e) => e.from === 'scan')?.emphasis).toBe(true);
    expect(view.layout.edges.find((e) => e.from === 'assess')?.emphasis).toBeUndefined();
    expect(view.layout.nodes[1]?.label).toBe('ASSESS, Running');
  });

  it('summarises the graph in words', () => {
    expect(graphSummary(GRAPH)).toBe('4 stages, 1 approval gate, 2 branches, 1 loop');
  });
});
