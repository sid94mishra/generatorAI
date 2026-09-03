// ────────────────────────────────────────────────────────────────
// DAG layout and the narrow-terminal tree fallback (Phase 9 item 5).
//
// This module had NO tests, and it is what draws every workflow — both the
// wide layered graph and the indented dependency tree under 100 columns.
// Its failure modes are all silent-and-wrong rather than throwing: a stage
// drawn beside its dependency instead of after it, a diamond that recurses
// forever, or a cyclic definition rendering as an empty tree, which looks
// exactly like data loss.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { layoutDag, toTree, type DagEdge, type DagStage } from '../dagLayout.js';

const stage = (id: string): DagStage => ({ id, name: id.toUpperCase() });
const edge = (from: string, to: string, edgeType?: string): DagEdge => ({
  id: `${from}-${to}`,
  fromStageId: from,
  toStageId: to,
  ...(edgeType ? { edgeType } : {}),
});
const layerOf = (result: ReturnType<typeof layoutDag>, id: string) =>
  result.nodes.find((n) => n.id === id)?.layer;

describe('layoutDag', () => {
  it('puts every root on layer 0 and each dependant after its dependency', () => {
    const result = layoutDag(['a', 'b', 'c'].map(stage), [edge('a', 'b'), edge('b', 'c')]);
    expect(layerOf(result, 'a')).toBe(0);
    expect(layerOf(result, 'b')).toBe(1);
    expect(layerOf(result, 'c')).toBe(2);
    expect(result.layers).toEqual([['a'], ['b'], ['c']]);
  });

  it('uses the LONGEST path, so a late dependency is drawn after its chain', () => {
    // a→b→c→d and a→d. Shortest-path would put d on layer 1, beside b, where
    // its dependency on c is invisible.
    const result = layoutDag(
      ['a', 'b', 'c', 'd'].map(stage),
      [edge('a', 'b'), edge('b', 'c'), edge('c', 'd'), edge('a', 'd')],
    );
    expect(layerOf(result, 'd')).toBe(3);
  });

  it('lays a diamond out with both middle stages on the same layer', () => {
    const result = layoutDag(
      ['a', 'b', 'c', 'd'].map(stage),
      [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')],
    );
    expect(layerOf(result, 'b')).toBe(1);
    expect(layerOf(result, 'c')).toBe(1);
    expect(layerOf(result, 'd')).toBe(2);
    expect(result.layers[1]).toHaveLength(2);
  });

  it('skips an edge naming a stage that no longer exists, rather than throwing', () => {
    // A definition mid-edit is a normal state to render — a stage deleted
    // while its edges survive must not take the whole pane down.
    const result = layoutDag([stage('a')], [edge('a', 'ghost'), edge('ghost', 'a')]);
    expect(result.edges).toHaveLength(0);
    expect(result.nodes).toHaveLength(1);
  });

  it('reports the stages in a cycle instead of looping forever', () => {
    const result = layoutDag(['a', 'b', 'c'].map(stage), [
      edge('a', 'b'),
      edge('b', 'c'),
      edge('c', 'b'),
    ]);
    expect([...result.cycle].sort()).toEqual(['b', 'c']);
    // And still returns a usable layout for the acyclic part.
    expect(layerOf(result, 'a')).toBe(0);
    expect(result.nodes).toHaveLength(3);
  });

  it('reports a self-edge as a cycle', () => {
    expect(layoutDag([stage('a')], [edge('a', 'a')]).cycle).toEqual(['a']);
  });

  it('names stages that are connected to nothing at all', () => {
    const result = layoutDag(['a', 'b', 'lonely'].map(stage), [edge('a', 'b')]);
    expect(result.orphans).toEqual(['lonely']);
  });

  it('does not call a root with children an orphan', () => {
    // A root has no incoming edges, which is not the same as being isolated.
    expect(layoutDag(['a', 'b'].map(stage), [edge('a', 'b')]).orphans).toEqual([]);
  });

  it('orders a layer to reduce crossings, by the mean position of its parents', () => {
    // Parents on layer 0 are [p1, p2] in that order. c1 hangs off p1 and c2
    // off p2, so keeping c1 before c2 is the crossing-free order — declaring
    // the children in the opposite order must not preserve that order.
    const stages = ['p1', 'p2', 'c2', 'c1'].map(stage);
    const result = layoutDag(stages, [edge('p1', 'c1'), edge('p2', 'c2')]);
    const parents = result.layers[0]!;
    const children = result.layers[1]!;
    expect(children.indexOf('c1')).toBeLessThan(children.indexOf('c2'));
    expect(parents).toEqual(['p1', 'p2']);
  });

  it('handles an empty graph without producing a phantom layer of nodes', () => {
    const result = layoutDag([], []);
    expect(result.nodes).toEqual([]);
    expect(result.cycle).toEqual([]);
    expect(result.orphans).toEqual([]);
  });

  it('gives every node an index within its layer', () => {
    const result = layoutDag(['a', 'b', 'c'].map(stage), [edge('a', 'b'), edge('a', 'c')]);
    const layerOne = result.nodes.filter((n) => n.layer === 1).map((n) => n.index).sort();
    expect(layerOne).toEqual([0, 1]);
  });
});

describe('toTree', () => {
  it('indents each dependant under its dependency', () => {
    const lines = toTree(['a', 'b', 'c'].map(stage), [edge('a', 'b'), edge('b', 'c')]);
    expect(lines.map((l) => [l.id, l.depth])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ]);
  });

  it('emits a shared node once and marks the second appearance as a repeat', () => {
    // A diamond reaches `d` by two paths; expanding it twice would double the
    // subtree and, on a cycle, never terminate.
    const lines = toTree(
      ['a', 'b', 'c', 'd'].map(stage),
      [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')],
    );
    const ds = lines.filter((l) => l.id === 'd');
    expect(ds).toHaveLength(2);
    expect(ds[0]?.repeat).toBe(false);
    expect(ds[1]?.repeat).toBe(true);
  });

  it('terminates on a cycle and still shows every stage', () => {
    // Roots-first alone would render a fully cyclic definition as an EMPTY
    // tree, which reads as data loss rather than as a bad definition.
    const lines = toTree(['a', 'b'].map(stage), [edge('a', 'b'), edge('b', 'a')]);
    expect(lines.length).toBeGreaterThan(0);
    expect(new Set(lines.map((l) => l.id))).toEqual(new Set(['a', 'b']));
  });

  it('shows a stage that only a cycle points at', () => {
    const lines = toTree(['root', 'x', 'y'].map(stage), [
      edge('root', 'x'),
      edge('x', 'y'),
      edge('y', 'x'),
    ]);
    expect(new Set(lines.map((l) => l.id))).toEqual(new Set(['root', 'x', 'y']));
  });

  it('carries the edge type through so a non-default branch is labelled', () => {
    const lines = toTree(['a', 'b'].map(stage), [edge('a', 'b', 'on_failure')]);
    expect(lines.find((l) => l.id === 'b')?.edgeType).toBe('on_failure');
    // A root arrives by no edge at all.
    expect(lines.find((l) => l.id === 'a')?.edgeType).toBeUndefined();
  });

  it('marks the last child at each level, for the box-drawing corner', () => {
    const lines = toTree(['a', 'b', 'c'].map(stage), [edge('a', 'b'), edge('a', 'c')]);
    expect(lines.find((l) => l.id === 'b')?.isLast).toBe(false);
    expect(lines.find((l) => l.id === 'c')?.isLast).toBe(true);
  });

  it('lists several disconnected roots rather than only the first', () => {
    const lines = toTree(['a', 'b'].map(stage), []);
    expect(lines.map((l) => l.id)).toEqual(['a', 'b']);
    expect(lines.every((l) => l.depth === 0)).toBe(true);
  });

  it('ignores an edge naming a stage that does not exist', () => {
    const lines = toTree([stage('a')], [edge('a', 'ghost')]);
    expect(lines.map((l) => l.id)).toEqual(['a']);
  });

  it('returns nothing for an empty definition', () => {
    expect(toTree([], [])).toEqual([]);
  });
});
