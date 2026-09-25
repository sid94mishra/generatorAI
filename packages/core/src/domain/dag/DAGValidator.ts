// ────────────────────────────────────────────────────────────────
// DAGValidator — Validates and analyzes directed acyclic graphs of the
// id-keyed stage definitions the v1 engine runs. Ordering, layering and
// cycle detection are the workflow-spec graph analysis (Kahn), the same
// algorithm `validateWorkflow` runs over stage keys.
// ────────────────────────────────────────────────────────────────

import type { StageDefinition, StageEdge } from '@generatorai/shared';
import { DAGValidationError } from '@generatorai/shared';
import { analyzeGraph, type GraphAnalysis } from '@generatorai/workflow-spec';
import type { DAG, DAGValidationIssue, DAGValidationResult, StageNode } from './types.js';

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
  const issues: DAGValidationIssue[] = [];

  // One helper for both outputs, so an issue can never drift from its string
  // (or be forgotten on a new check) — the two arrays are built from the same
  // call, never independently.
  const fail = (issue: Omit<DAGValidationIssue, 'severity'>): void => {
    errors.push(issue.message);
    issues.push({ severity: 'error', ...issue });
  };
  const warn = (issue: Omit<DAGValidationIssue, 'severity'>): void => {
    warnings.push(issue.message);
    issues.push({ severity: 'warning', ...issue });
  };

  if (stages.length === 0) {
    warn({ code: 'empty-graph', message: 'DAG has no stages', stageIds: [] });
    return { valid: true, errors, warnings, issues };
  }

  // ── Empty-prompts check ──
  // A stage with zero prompts will never produce any LLM output. This is
  // almost always a misconfiguration (forgot to add a prompt). It's only a
  // warning, not an error, because a stage can be a placeholder while the
  // workflow is in-progress in the builder UI.
  //
  // A stage bound to an agent is exempt: the agent's instructions are the
  // instruction, so the stage is complete without a separate prompt.
  for (const stage of stages) {
    const hasAgent = !!stage.agentRef;
    if ((!stage.prompts || stage.prompts.length === 0) && !hasAgent) {
      warn({
        code: 'stage-without-prompts',
        message: `Stage '${stage.name}' has no prompts \u2014 it will not produce any output`,
        stageIds: [stage.id],
        field: 'prompts',
      });
    }
  }

  const stageIds = new Set(stages.map((s) => s.id));

  // ── Self-edge check ──
  for (const edge of edges) {
    if (edge.fromStageId === edge.toStageId) {
      fail({
        code: 'self-edge',
        message: `Self-edge detected on stage '${edge.fromStageId}'`,
        stageIds: [edge.fromStageId],
        edge: edgeRef(edge),
      });
    }
  }

  // ── Reference check ──
  for (const edge of edges) {
    if (!stageIds.has(edge.fromStageId)) {
      fail({
        code: 'unknown-source-stage',
        message: `Edge references non-existent source stage '${edge.fromStageId}'`,
        // Deliberately the surviving END of the edge, not the dangling id:
        // the missing stage cannot be selected or scrolled to by a client.
        stageIds: stageIds.has(edge.toStageId) ? [edge.toStageId] : [],
        edge: edgeRef(edge),
      });
    }
    if (!stageIds.has(edge.toStageId)) {
      fail({
        code: 'unknown-target-stage',
        message: `Edge references non-existent target stage '${edge.toStageId}'`,
        stageIds: stageIds.has(edge.fromStageId) ? [edge.fromStageId] : [],
        edge: edgeRef(edge),
      });
    }
  }

  // ── Duplicate edge check ──
  const edgeSet = new Set<string>();
  for (const edge of edges) {
    const key = `${edge.fromStageId}→${edge.toStageId}:${edge.edgeType}`;
    if (edgeSet.has(key)) {
      fail({
        code: 'duplicate-edge',
        message: `Duplicate edge from '${edge.fromStageId}' to '${edge.toStageId}' with type '${edge.edgeType}'`,
        stageIds: [edge.fromStageId, edge.toStageId].filter((id) => stageIds.has(id)),
        edge: edgeRef(edge),
      });
    }
    edgeSet.add(key);
  }

  // If basic validation already failed, don't run cycle detection
  if (errors.length > 0) {
    return { valid: false, errors, warnings, issues };
  }

  // ── Cycle detection via Kahn's algorithm ──
  const analysis = analyze(stages, edges);
  if (analysis.unordered.length > 0) {
    const cycleNodes = analysis.unordered;
    fail({
      code: 'cycle',
      message: `Cycle detected involving stages: ${cycleNodes.join(', ')}`,
      stageIds: cycleNodes,
    });
    return { valid: false, errors, warnings, issues };
  }

  // ── Disconnected node check ──
  // All nodes should be reachable from roots OR have a path to a leaf
  const roots = analysis.roots;
  if (roots.length === 0 && stages.length > 0) {
    fail({
      code: 'no-root-stages',
      message: 'No root stages found — all stages have incoming edges',
      stageIds: [...stageIds],
    });
    return { valid: false, errors, warnings, issues };
  }

  // BFS from all roots
  const reachable = new Set<string>();
  const bfsQueue = [...roots];
  while (bfsQueue.length > 0) {
    const node = bfsQueue.shift()!;
    if (reachable.has(node)) continue;
    reachable.add(node);
    for (const neighbor of analysis.successors.get(node) ?? []) {
      if (!reachable.has(neighbor)) {
        bfsQueue.push(neighbor);
      }
    }
  }

  const unreachable = [...stageIds].filter((id) => !reachable.has(id));
  if (unreachable.length > 0) {
    warn({
      code: 'disconnected-stages',
      message: `Disconnected stages detected: ${unreachable.join(', ')}`,
      stageIds: unreachable,
    });
  }

  return { valid: errors.length === 0, errors, warnings, issues };
}

/** The edge fields an issue carries — `edgeType` omitted rather than `undefined` under `exactOptionalPropertyTypes`. */
function edgeRef(edge: StageEdge): NonNullable<DAGValidationIssue['edge']> {
  return {
    fromStageId: edge.fromStageId,
    toStageId: edge.toStageId,
    ...(edge.edgeType ? { edgeType: String(edge.edgeType) } : {}),
  };
}

/** Graph analysis over stage ids (edges to unknown stages are ignored). */
function analyze(stages: StageDefinition[], edges: StageEdge[]): GraphAnalysis {
  return analyzeGraph(
    stages.map((s) => s.id),
    edges.map((e) => ({ from: e.fromStageId, to: e.toStageId })),
  );
}

/**
 * Compute topological ordering of stages using Kahn's algorithm.
 * @throws DAGValidationError if the graph contains a cycle
 */
export function topologicalSort(
  stages: StageDefinition[],
  edges: StageEdge[],
): string[] {
  const analysis = analyze(stages, edges);
  if (analysis.unordered.length > 0) {
    throw new DAGValidationError('Cannot topologically sort: graph contains a cycle');
  }
  return analysis.order;
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
  return analyze(stages, edges).layers;
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
