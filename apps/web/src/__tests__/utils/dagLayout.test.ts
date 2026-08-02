// ────────────────────────────────────────────────────────────────
// DAG Layout utility tests
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { getLayoutedElements, getExecutionLayers } from '@/utils/dagLayout.js';
import type { Node, Edge } from '@xyflow/react';

function makeNode(id: string, x = 0, y = 0): Node {
  return { id, position: { x, y }, data: {} };
}

function makeEdge(source: string, target: string): Edge {
  return { id: `${source}-${target}`, source, target };
}

describe('getLayoutedElements', () => {
  it('returns empty arrays for empty input', () => {
    const result = getLayoutedElements([], []);
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });

  it('lays out a single node', () => {
    const nodes = [makeNode('a')];
    const result = getLayoutedElements(nodes, []);
    expect(result.nodes).toHaveLength(1);
    expect(typeof result.nodes[0]!.position.x).toBe('number');
    expect(typeof result.nodes[0]!.position.y).toBe('number');
  });

  it('lays out a linear chain A → B → C', () => {
    const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
    const edges = [makeEdge('a', 'b'), makeEdge('b', 'c')];
    const result = getLayoutedElements(nodes, edges, 'LR');

    const xPositions = result.nodes.map((n) => n.position.x);
    // A should be leftmost, C rightmost
    const aIdx = result.nodes.findIndex((n) => n.id === 'a');
    const cIdx = result.nodes.findIndex((n) => n.id === 'c');
    expect(xPositions[aIdx]!).toBeLessThan(xPositions[cIdx]!);
  });

  it('preserves edges as-is', () => {
    const nodes = [makeNode('a'), makeNode('b')];
    const edges = [makeEdge('a', 'b')];
    const result = getLayoutedElements(nodes, edges);
    expect(result.edges).toBe(edges);
  });
});

describe('getExecutionLayers', () => {
  it('groups independent nodes into the same layer', () => {
    const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
    const edges: Edge[] = [];
    const layers = getExecutionLayers(nodes, edges);
    expect(layers).toHaveLength(1);
    expect(layers[0]).toHaveLength(3);
  });

  it('separates dependent nodes into layers', () => {
    const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
    const edges = [makeEdge('a', 'b'), makeEdge('b', 'c')];
    const layers = getExecutionLayers(nodes, edges);
    expect(layers).toHaveLength(3);
    expect(layers[0]).toEqual(['a']);
    expect(layers[1]).toEqual(['b']);
    expect(layers[2]).toEqual(['c']);
  });

  it('handles diamond DAG correctly', () => {
    const nodes = [makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d')];
    const edges = [makeEdge('a', 'b'), makeEdge('a', 'c'), makeEdge('b', 'd'), makeEdge('c', 'd')];
    const layers = getExecutionLayers(nodes, edges);
    // Layer 0: [a], Layer 1: [b, c], Layer 2: [d]
    expect(layers).toHaveLength(3);
    expect(layers[0]).toEqual(['a']);
    expect(layers[1]!.sort()).toEqual(['b', 'c']);
    expect(layers[2]).toEqual(['d']);
  });
});
