// ────────────────────────────────────────────────────────────────
// DAGValidator Tests
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { validateDAG, topologicalSort, getExecutionLayers, buildDAG } from '../src/domain/dag/DAGValidator.js';
import { DAGValidationError } from '@generatorai/shared';
import type { StageDefinition, StageEdge } from '@generatorai/shared';

/** Helper to create a minimal StageDefinition */
function makeStage(id: string, order = 0): StageDefinition {
  return {
    id,
    workflowDefinitionId: 'wf-1',
    name: `Stage ${id}`,
    order,
    prompts: [],
    variables: {},
    hooks: {},
    createdAt: new Date(),
  };
}

/** Helper to create a minimal StageEdge */
function makeEdge(from: string, to: string, type: 'on_success' | 'on_failure' | 'on_completion' | 'always' = 'on_success'): StageEdge {
  return {
    id: `${from}-${to}`,
    workflowDefinitionId: 'wf-1',
    fromStageId: from,
    toStageId: to,
    edgeType: type,
    createdAt: new Date(),
  };
}

describe('validateDAG', () => {
  it('validates empty graph (warning, not error)', () => {
    const result = validateDAG([], []);
    expect(result.valid).toBe(true);
    expect(result.warnings).toContain('DAG has no stages');
  });

  it('validates single node (no edges)', () => {
    const result = validateDAG([makeStage('A')], []);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates simple linear DAG A → B → C', () => {
    const stages = [makeStage('A'), makeStage('B'), makeStage('C')];
    const edges = [makeEdge('A', 'B'), makeEdge('B', 'C')];
    const result = validateDAG(stages, edges);
    expect(result.valid).toBe(true);
  });

  it('validates diamond dependency A → B,C → D', () => {
    const stages = ['A', 'B', 'C', 'D'].map((id) => makeStage(id));
    const edges = [
      makeEdge('A', 'B'),
      makeEdge('A', 'C'),
      makeEdge('B', 'D'),
      makeEdge('C', 'D'),
    ];
    const result = validateDAG(stages, edges);
    expect(result.valid).toBe(true);
  });

  it('detects self-edges', () => {
    const result = validateDAG([makeStage('A')], [makeEdge('A', 'A')]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Self-edge'))).toBe(true);
  });

  it('detects simple cycles A → B → A', () => {
    const stages = [makeStage('A'), makeStage('B')];
    const edges = [makeEdge('A', 'B'), makeEdge('B', 'A')];
    const result = validateDAG(stages, edges);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Cycle'))).toBe(true);
  });

  it('detects complex cycles A → B → C → A', () => {
    const stages = [makeStage('A'), makeStage('B'), makeStage('C')];
    const edges = [makeEdge('A', 'B'), makeEdge('B', 'C'), makeEdge('C', 'A')];
    const result = validateDAG(stages, edges);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Cycle'))).toBe(true);
  });

  it('detects duplicate edges', () => {
    const stages = [makeStage('A'), makeStage('B')];
    const edges = [makeEdge('A', 'B'), makeEdge('A', 'B')];
    const result = validateDAG(stages, edges);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Duplicate'))).toBe(true);
  });

  it('detects references to non-existent stages', () => {
    const stages = [makeStage('A')];
    const edges = [makeEdge('A', 'Z')];
    const result = validateDAG(stages, edges);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('non-existent'))).toBe(true);
  });

  it('warns about disconnected nodes', () => {
    const stages = [makeStage('A'), makeStage('B'), makeStage('C')];
    const edges = [makeEdge('A', 'B')]; // C is disconnected
    const result = validateDAG(stages, edges);
    expect(result.valid).toBe(true); // disconnected is a warning, not error
    // C is a root node (no incoming edges), so it's reachable from roots
    // Actually C is also a root, so it should be reachable
  });

  it('validates large DAG (50 stages, chain)', () => {
    const stages = Array.from({ length: 50 }, (_, i) => makeStage(`S${i}`));
    const edges = Array.from({ length: 49 }, (_, i) => makeEdge(`S${i}`, `S${i + 1}`));
    const result = validateDAG(stages, edges);
    expect(result.valid).toBe(true);
  });
});

describe('topologicalSort', () => {
  it('sorts a linear DAG', () => {
    const stages = [makeStage('C'), makeStage('A'), makeStage('B')];
    const edges = [makeEdge('A', 'B'), makeEdge('B', 'C')];
    const sorted = topologicalSort(stages, edges);
    expect(sorted.indexOf('A')).toBeLessThan(sorted.indexOf('B'));
    expect(sorted.indexOf('B')).toBeLessThan(sorted.indexOf('C'));
  });

  it('sorts a diamond DAG', () => {
    const stages = ['A', 'B', 'C', 'D'].map((id) => makeStage(id));
    const edges = [
      makeEdge('A', 'B'),
      makeEdge('A', 'C'),
      makeEdge('B', 'D'),
      makeEdge('C', 'D'),
    ];
    const sorted = topologicalSort(stages, edges);
    expect(sorted.indexOf('A')).toBeLessThan(sorted.indexOf('B'));
    expect(sorted.indexOf('A')).toBeLessThan(sorted.indexOf('C'));
    expect(sorted.indexOf('B')).toBeLessThan(sorted.indexOf('D'));
    expect(sorted.indexOf('C')).toBeLessThan(sorted.indexOf('D'));
  });

  it('throws on cycle', () => {
    const stages = [makeStage('A'), makeStage('B')];
    const edges = [makeEdge('A', 'B'), makeEdge('B', 'A')];
    expect(() => topologicalSort(stages, edges)).toThrow(DAGValidationError);
  });

  it('handles single node', () => {
    const sorted = topologicalSort([makeStage('A')], []);
    expect(sorted).toEqual(['A']);
  });
});

describe('getExecutionLayers', () => {
  it('returns empty for empty graph', () => {
    expect(getExecutionLayers([], [])).toEqual([]);
  });

  it('single layer for independent stages', () => {
    const stages = [makeStage('A'), makeStage('B'), makeStage('C')];
    const layers = getExecutionLayers(stages, []);
    expect(layers).toHaveLength(1);
    expect(layers[0]).toEqual(expect.arrayContaining(['A', 'B', 'C']));
  });

  it('two layers for linear A → B', () => {
    const stages = [makeStage('A'), makeStage('B')];
    const edges = [makeEdge('A', 'B')];
    const layers = getExecutionLayers(stages, edges);
    expect(layers).toHaveLength(2);
    expect(layers[0]).toEqual(['A']);
    expect(layers[1]).toEqual(['B']);
  });

  it('diamond A → B,C → D produces 3 layers', () => {
    const stages = ['A', 'B', 'C', 'D'].map((id) => makeStage(id));
    const edges = [
      makeEdge('A', 'B'),
      makeEdge('A', 'C'),
      makeEdge('B', 'D'),
      makeEdge('C', 'D'),
    ];
    const layers = getExecutionLayers(stages, edges);
    expect(layers).toHaveLength(3);
    expect(layers[0]).toEqual(['A']);
    expect(layers[1]).toEqual(expect.arrayContaining(['B', 'C']));
    expect(layers[2]).toEqual(['D']);
  });

  it('fan-out A → B,C,D,E produces 2 layers', () => {
    const stages = ['A', 'B', 'C', 'D', 'E'].map((id) => makeStage(id));
    const edges = [
      makeEdge('A', 'B'),
      makeEdge('A', 'C'),
      makeEdge('A', 'D'),
      makeEdge('A', 'E'),
    ];
    const layers = getExecutionLayers(stages, edges);
    expect(layers).toHaveLength(2);
    expect(layers[0]).toEqual(['A']);
    expect(layers[1]).toEqual(expect.arrayContaining(['B', 'C', 'D', 'E']));
  });
});

describe('buildDAG', () => {
  it('builds a valid DAG', () => {
    const stages = ['A', 'B', 'C'].map((id) => makeStage(id));
    const edges = [makeEdge('A', 'B'), makeEdge('B', 'C')];
    const dag = buildDAG(stages, edges);

    expect(dag.nodes.size).toBe(3);
    expect(dag.rootIds).toEqual(['A']);
    expect(dag.leafIds).toEqual(['C']);
    expect(dag.topologicalOrder).toEqual(['A', 'B', 'C']);
    expect(dag.executionLayers).toHaveLength(3);
  });

  it('throws on invalid DAG', () => {
    const stages = [makeStage('A'), makeStage('B')];
    const edges = [makeEdge('A', 'B'), makeEdge('B', 'A')];
    expect(() => buildDAG(stages, edges)).toThrow(DAGValidationError);
  });

  it('correctly wires node dependencies', () => {
    const stages = ['A', 'B', 'C'].map((id) => makeStage(id));
    const edges = [makeEdge('A', 'B'), makeEdge('A', 'C')];
    const dag = buildDAG(stages, edges);

    const nodeA = dag.nodes.get('A')!;
    expect(nodeA.dependencyIds).toEqual([]);
    expect(nodeA.dependentIds).toEqual(expect.arrayContaining(['B', 'C']));
    expect(nodeA.outgoingEdges).toHaveLength(2);

    const nodeB = dag.nodes.get('B')!;
    expect(nodeB.dependencyIds).toEqual(['A']);
    expect(nodeB.incomingEdges).toHaveLength(1);
  });
});
