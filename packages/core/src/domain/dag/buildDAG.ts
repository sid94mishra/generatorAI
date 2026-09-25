// ────────────────────────────────────────────────────────────────
// buildDAG — the scheduler's graph over stage keys.
//
// Validation (keys, references, one edge per pair, cycles, expressions)
// is `validateWorkflow` in @generatorai/workflow-spec, run on every save,
// publish and run start; this only lays the validated graph out with the
// spec's own ordering algorithm (`analyzeGraph`).
// ────────────────────────────────────────────────────────────────

import { analyzeGraph, type WorkflowGraph } from '@generatorai/workflow-spec';
import { DAGValidationError } from '@generatorai/shared';
import type { DAG, StageNode } from './types.js';

/** @throws DAGValidationError when the graph has a cycle. */
export function buildDAG(graph: Pick<WorkflowGraph, 'stages' | 'edges'>): DAG {
  const keys = graph.stages.map((s) => s.key);
  const analysis = analyzeGraph(keys, graph.edges);
  if (analysis.unordered.length > 0) {
    const message = `Cycle detected involving stages: ${analysis.unordered.join(', ')}`;
    throw new DAGValidationError(`Invalid DAG: ${message}`, [message]);
  }

  const nodes = new Map<string, StageNode>();
  for (const stage of graph.stages) {
    nodes.set(stage.key, { stage, dependencyIds: [], dependentIds: [], outgoingEdges: [], incomingEdges: [] });
  }
  for (const edge of graph.edges) {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (!from || !to) continue;
    from.dependentIds.push(edge.to);
    from.outgoingEdges.push(edge);
    to.dependencyIds.push(edge.from);
    to.incomingEdges.push(edge);
  }

  return {
    nodes,
    edges: [...graph.edges],
    rootIds: analysis.roots,
    leafIds: analysis.leaves,
    topologicalOrder: analysis.order,
    executionLayers: analysis.layers,
  };
}
