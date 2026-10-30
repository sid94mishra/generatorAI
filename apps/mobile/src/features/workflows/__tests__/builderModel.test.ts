import { describe, expect, it } from 'vitest';
import type { WorkflowGraph } from '@generatorai/workflow-spec';

import { canMove, deleteStage, diffLine, duplicateStage, edgeCallouts, graphDiff, insertAfter, linearChains, moveStage, newStage, nudge, stageKeyFor, topLevelOrder } from '../model/builderModel';

const agent = (key: string, extra: Record<string, unknown> = {}) => ({ kind: 'agent', key, name: key.toUpperCase(), join: { mode: 'all' }, prompts: [], hooks: [], ...extra });
const graph = (stages: unknown[], edges: unknown[]): WorkflowGraph => ({ formatVersion: 2, workflow: { name: 'W' }, stages, edges }) as unknown as WorkflowGraph;
const ok = (from: string, to: string) => ({ from, to, on: 'success' });

// a → b → c → d, plus d → e on failure (d and e leave the chain).
const G = graph([agent('a'), agent('b'), agent('c'), agent('d'), agent('e')], [ok('a', 'b'), ok('b', 'c'), ok('c', 'd'), { from: 'd', to: 'e', on: 'failure' }]);

describe('builder model (MD-04)', () => {
  it('orders top-level stages and finds the linear chain', () => {
    expect(topLevelOrder(G).map((s) => s.key)).toEqual(['a', 'b', 'c', 'd', 'e']);
    const chains = linearChains(G);
    expect([chains.get('a'), chains.get('b'), chains.get('c')]).toEqual([1, 1, 1]);
    expect(chains.get('d')).toBeNull();
    const order = topLevelOrder(G);
    expect(canMove(order, chains, 0, 2)).toBe(true);
    expect(canMove(order, chains, 2, 3)).toBe(false);
  });

  it('moves a stage inside its chain and rewires the chain, keeping the exit edge', () => {
    const moved = moveStage(G, 'a', 2);
    expect(topLevelOrder(moved).map((s) => s.key).slice(0, 3)).toEqual(['b', 'c', 'a']);
    expect(moved.edges).toEqual(expect.arrayContaining([ok('b', 'c'), ok('c', 'a'), ok('a', 'd'), { from: 'd', to: 'e', on: 'failure' }]));
    expect(moved.edges).toHaveLength(4);
    expect(nudge(G, 'd', -1)).toBe(G);
  });

  it('adds a stage after the selected one, taking over its plain edge', () => {
    const s = newStage('agent', G);
    expect(s).toMatchObject({ kind: 'agent', key: 'stage_6', name: 'Stage 6', prompts: [] });
    const added = insertAfter(G, 'a', s);
    expect(added.edges).toEqual(expect.arrayContaining([ok('a', 'stage_6'), ok('stage_6', 'b')]));
    expect(added.edges.some((e) => e.from === 'a' && e.to === 'b')).toBe(false);
    expect(newStage('check', G)).toMatchObject({ kind: 'check', check: { command: 'npm' } });
  });

  it('duplicates and deletes, closing the chain over the gap', () => {
    const dup = duplicateStage(G, 'b');
    expect(dup.key).toBe('b_copy');
    expect(dup.graph.stages.find((s) => s.key === 'b_copy')?.name).toBe('B copy');
    const del = deleteStage(G, 'b');
    expect(del.stages.map((s) => s.key)).not.toContain('b');
    expect(del.edges).toEqual(expect.arrayContaining([ok('a', 'c')]));
  });

  it('describes the edges a card cannot edit, and diffs graphs', () => {
    expect(edgeCallouts(G, 'd')).toEqual([{ to: 'E', words: 'on failure', dashed: true }]);
    expect(edgeCallouts(G, 'a')).toEqual([]);
    const d = graphDiff(G, insertAfter(G, 'a', newStage('agent', G)));
    expect(d).toMatchObject({ added: ['stage_6'], removed: [], edgesChanged: true });
    expect(diffLine(d)).toBe('+1 stage · edges changed');
    expect(stageKeyFor('Run tests!', new Set(['run_tests']))).toBe('run_tests_2');
  });
});
