// ────────────────────────────────────────────────────────────────
// DAGValidator — Validates and analyzes directed acyclic graphs
// Implements cycle detection (Kahn's algorithm), reachability,
// topological sort, and execution layer computation.
// ────────────────────────────────────────────────────────────────

import type { StageDefinition, StageEdge } from '@generatorai/shared';
import { DAGValidationError } from '@generatorai/shared';
import type { DAG, DAGValidationResult, StageNode } from './types.js';

/**
 * Validate a DAG defined by stages and edges.
 *
 * Checks for:
 * - Self-edges
 * - Duplicate edges
 * - References to non-existent stages
 * - Cycles (via Kahn's algorithm)
 * - Disconnected nodes (unreachable from roots)
 * - Empty graph (warning, not error)
 */
export function validateDAG(
  stages: StageDefinition[],
  edges: StageEdge[],
): DAGValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (stages.length === 0) {
    warnings.push('DAG has no stages');
    return { valid: true, errors, warnings };
  }

  // ── Empty-prompts check ──
  // A stage with zero prompts will never produce any LLM output. This is
  // almost always a misconfiguration (forgot to add a prompt). It's only a
  // warning, not an error, because a stage can be a placeholder while the
  // workflow is in-progress in the builder UI.
  for (const stage of stages) {
    if (!stage.prompts || stage.prompts.length === 0) {
      warnings.push(`Stage '${stage.name}' has no prompts \u2014 it will not produce any output`);
    }
  }

  const stageIds = new Set(stages.map((s) => s.id));

  // ── Self-edge check ──
  for (const edge of edges) {
    if (edge.fromStageId === edge.toStageId) {
      errors.push(`Self-edge detected on stage '${edge.fromStageId}'`);
    }
  }

  // ── Reference check ──
  for (const edge of edges) {
    if (!stageIds.has(edge.fromStageId)) {
      errors.push(`Edge references non-existent source stage '${edge.fromStageId}'`);
    }
    if (!stageIds.has(edge.toStageId)) {
      errors.push(`Edge references non-existent target stage '${edge.toStageId}'`);
    }
  }

  // ── Duplicate edge check ──
  const edgeSet = new Set<string>();
  for (const edge of edges) {
    const key = `${edge.fromStageId}→${edge.toStageId}:${edge.edgeType}`;
    if (edgeSet.has(key)) {
      errors.push(`Duplicate edge from '${edge.fromStageId}' to '${edge.toStageId}' with type '${edge.edgeType}'`);
    }
    edgeSet.add(key);
  }

  // If basic validation already failed, don't run cycle detection
  if (errors.length > 0) {
    return { valid: false, errors, warnings };
  }

  // ── Cycle detection via Kahn's algorithm ──
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const id of stageIds) {
    inDegree.set(id, 0);
    adjacency.set(id, []);
  }

  for (const edge of edges) {
    adjacency.get(edge.fromStageId)!.push(edge.toStageId);
    inDegree.set(edge.toStageId, (inDegree.get(edge.toStageId) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) {
      queue.push(id);
    }
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node);
    for (const neighbor of adjacency.get(node) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  if (sorted.length !== stageIds.size) {
    const cycleNodes = [...stageIds].filter((id) => !sorted.includes(id));
    errors.push(`Cycle detected involving stages: ${cycleNodes.join(', ')}`);
    return { valid: false, errors, warnings };
  }

  // ── Disconnected node check ──
  // All nodes should be reachable from roots OR have a path to a leaf
  const roots = [...stageIds].filter((id) => (inDegree.get(id) ?? 0) === 0 || !edges.some((e) => e.toStageId === id));
  if (roots.length === 0 && stages.length > 0) {
    errors.push('No root stages found — all stages have incoming edges');
    return { valid: false, errors, warnings };
  }

  // BFS from all roots
  const reachable = new Set<string>();
  const bfsQueue = [...roots];
  while (bfsQueue.length > 0) {
    const node = bfsQueue.shift()!;
    if (reachable.has(node)) continue;
    reachable.add(node);
    for (const neighbor of adjacency.get(node) ?? []) {
      if (!reachable.has(neighbor)) {
        bfsQueue.push(neighbor);
      }
    }
  }

  const unreachable = [...stageIds].filter((id) => !reachable.has(id));
  if (unreachable.length > 0) {
    warnings.push(`Disconnected stages detected: ${unreachable.join(', ')}`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Compute topological ordering of stages using Kahn's algorithm.
 * @throws DAGValidationError if the graph contains a cycle
 */
export function topologicalSort(
  stages: StageDefinition[],
  edges: StageEdge[],
): string[] {
  const stageIds = new Set(stages.map((s) => s.id));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const id of stageIds) {
    inDegree.set(id, 0);
    adjacency.set(id, []);
  }

  for (const edge of edges) {
    adjacency.get(edge.fromStageId)!.push(edge.toStageId);
    inDegree.set(edge.toStageId, (inDegree.get(edge.toStageId) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) {
      queue.push(id);
    }
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node);
    for (const neighbor of adjacency.get(node) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  if (sorted.length !== stageIds.size) {
    throw new DAGValidationError('Cannot topologically sort: graph contains a cycle');
  }

  return sorted;
}

/**
 * Compute execution layers — groups of stages that can run in parallel.
 * Each layer's stages have all their dependencies satisfied by previous layers.
 */
export function getExecutionLayers(
  stages: StageDefinition[],
  edges: StageEdge[],
): string[][] {
  if (stages.length === 0) return [];

  const stageIds = new Set(stages.map((s) => s.id));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const id of stageIds) {
    inDegree.set(id, 0);
    adjacency.set(id, []);
  }

  for (const edge of edges) {
    adjacency.get(edge.fromStageId)!.push(edge.toStageId);
    inDegree.set(edge.toStageId, (inDegree.get(edge.toStageId) ?? 0) + 1);
  }

  const layers: string[][] = [];
  let currentLayer = [...stageIds].filter((id) => (inDegree.get(id) ?? 0) === 0);

  while (currentLayer.length > 0) {
    layers.push(currentLayer);

    const nextLayer: string[] = [];
    for (const node of currentLayer) {
      for (const neighbor of adjacency.get(node) ?? []) {
        const newDegree = (inDegree.get(neighbor) ?? 0) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) {
          nextLayer.push(neighbor);
        }
      }
    }

    currentLayer = nextLayer;
  }

  return layers;
}

/**
 * Build an in-memory DAG from stages and edges.
 * @throws DAGValidationError if the graph is invalid
 */
export function buildDAG(
  stages: StageDefinition[],
  edges: StageEdge[],
): DAG {
  const result = validateDAG(stages, edges);
  if (!result.valid) {
    throw new DAGValidationError(
      `Invalid DAG: ${result.errors.join('; ')}`,
      result.errors,
    );
  }

  const nodes = new Map<string, StageNode>();

  // Initialize nodes
  for (const stage of stages) {
    nodes.set(stage.id, {
      stage,
      dependencyIds: [],
      dependentIds: [],
      outgoingEdges: [],
      incomingEdges: [],
    });
  }

  // Wire edges
  for (const edge of edges) {
    const fromNode = nodes.get(edge.fromStageId);
    const toNode = nodes.get(edge.toStageId);
    if (fromNode && toNode) {
      fromNode.dependentIds.push(edge.toStageId);
      fromNode.outgoingEdges.push(edge);
      toNode.dependencyIds.push(edge.fromStageId);
      toNode.incomingEdges.push(edge);
    }
  }

  const rootIds = [...nodes.entries()]
    .filter(([, node]) => node.dependencyIds.length === 0)
    .map(([id]) => id);

  const leafIds = [...nodes.entries()]
    .filter(([, node]) => node.dependentIds.length === 0)
    .map(([id]) => id);

  const topologicalOrder = topologicalSort(stages, edges);
  const executionLayers = getExecutionLayers(stages, edges);

  return {
    nodes,
    edges,
    rootIds,
    leafIds,
    topologicalOrder,
    executionLayers,
  };
}
