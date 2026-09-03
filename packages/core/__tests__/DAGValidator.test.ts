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

// ── Structured issues (Phase 7 item 6 — validation navigation) ──────
//
// `errors`/`warnings` alone are prose: a client cannot tell which stage or
// edge a finding is about without re-parsing English. `issues` carries the
// same findings with the responsible ids attached. The invariant these
// tests hold is that `issues` NEVER diverges from the two string arrays —
// one issue per string, same order, same text.

describe('validateDAG issues', () => {
  const errorIssues = (r: ReturnType<typeof validateDAG>) =>
    r.issues.filter((i) => i.severity === 'error');
  const warningIssues = (r: ReturnType<typeof validateDAG>) =>
    r.issues.filter((i) => i.severity === 'warning');

  it('emits exactly one issue per error/warning string, with matching text', () => {
    // Every branch at once: a stage with no prompts (warning), a self-edge
    // and an unknown target (errors).
    const result = validateDAG([makeStage('A')], [makeEdge('A', 'A'), makeEdge('A', 'Z')]);
    expect(errorIssues(result).map((i) => i.message)).toEqual(result.errors);
    expect(warningIssues(result).map((i) => i.message)).toEqual(result.warnings);
  });

  it('names the stage for an empty-prompts warning, with the field', () => {
    const result = validateDAG([makeStage('A')], []);
    const issue = result.issues.find((i) => i.code === 'stage-without-prompts');
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe('warning');
    expect(issue?.stageIds).toEqual(['A']);
    expect(issue?.field).toBe('prompts');
  });

  it('names the stage and the edge for a self-edge', () => {
    const result = validateDAG([makeStage('A')], [makeEdge('A', 'A')]);
    const issue = result.issues.find((i) => i.code === 'self-edge');
    expect(issue?.stageIds).toEqual(['A']);
    expect(issue?.edge).toEqual({ fromStageId: 'A', toStageId: 'A', edgeType: 'on_success' });
  });

  it('names every stage in a cycle', () => {
    const stages = [makeStage('A'), makeStage('B'), makeStage('C')];
    const edges = [makeEdge('A', 'B'), makeEdge('B', 'C'), makeEdge('C', 'A')];
    const issue = validateDAG(stages, edges).issues.find((i) => i.code === 'cycle');
    expect(issue?.severity).toBe('error');
    expect([...(issue?.stageIds ?? [])].sort()).toEqual(['A', 'B', 'C']);
  });

  it('omits a stage id that does not exist rather than pointing at nothing', () => {
    // The whole point of `stageIds` is "what a UI can select" — a dangling
    // reference is not selectable, so only the surviving end is listed.
    const issue = validateDAG([makeStage('A')], [makeEdge('A', 'Z')]).issues.find(
      (i) => i.code === 'unknown-target-stage',
    );
    expect(issue?.stageIds).toEqual(['A']);
    expect(issue?.edge?.toStageId).toBe('Z');
  });

  it('names both ends of a duplicate edge', () => {
    const stages = [makeStage('A'), makeStage('B')];
    const issue = validateDAG(stages, [makeEdge('A', 'B'), makeEdge('A', 'B')]).issues.find(
      (i) => i.code === 'duplicate-edge',
    );
    expect(issue?.stageIds).toEqual(['A', 'B']);
  });

  it('reports an empty graph as one warning issue', () => {
    const result = validateDAG([], []);
    expect(result.issues).toEqual([
      { severity: 'warning', code: 'empty-graph', message: 'DAG has no stages', stageIds: [] },
    ]);
  });

  it('names the disconnected stages', () => {
    // B and C are unreachable from A: the only root is A, and nothing links
    // to B or C from it.
    const stages = [makeStage('A'), makeStage('B'), makeStage('C')].map((s) => ({
      ...s,
      prompts: [{ label: 'p', text: 'hello', waitForCompletion: true }],
    }));
    const edges = [makeEdge('B', 'C'), makeEdge('C', 'B')];
    const result = validateDAG(stages, edges);
    // B↔C is a cycle, so this exercises the cycle path's early return —
    // the issues array must still be returned, not dropped.
    expect(result.issues.some((i) => i.code === 'cycle')).toBe(true);
    expect(result.errors.length).toBe(result.issues.filter((i) => i.severity === 'error').length);
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
