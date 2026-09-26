// ────────────────────────────────────────────────────────────────
// DAG domain types — the in-memory graph the v1 scheduler reconciles,
// built from a run's pinned `WorkflowGraph` and keyed by stage KEY.
// ────────────────────────────────────────────────────────────────

import type { EdgeSpec, StageSpec } from '@generatorai/workflow-spec';

/** A node in the in-memory DAG. */
export interface StageNode {
  /** The stage spec (from the run's pinned definition version). */
  stage: StageSpec;
  /** Keys of the stages this node depends on (incoming edges). */
  dependencyIds: string[];
  /** Keys of the stages that depend on this node (outgoing edges). */
  dependentIds: string[];
  /** Edges from this node */
  outgoingEdges: EdgeSpec[];
  /** Edges to this node */
  incomingEdges: EdgeSpec[];
}

/** In-memory representation of a complete DAG. */
export interface DAG {
  /** All nodes indexed by stage key */
  nodes: Map<string, StageNode>;
  /** All edges */
  edges: EdgeSpec[];
  /** Root stages (no incoming edges / dependencies) */
  rootIds: string[];
  /** Leaf stages (no outgoing edges / dependents) */
  leafIds: string[];
  /** Topologically sorted stage keys */
  topologicalOrder: string[];
  /** Execution layers — stages in each layer can run in parallel */
  executionLayers: string[][];
}
