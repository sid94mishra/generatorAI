// ────────────────────────────────────────────────────────────────
// DAG Domain Types — Data structures for directed acyclic graphs
// ────────────────────────────────────────────────────────────────

import type { StageDefinition, StageEdge } from '@generatorai/shared';

/**
 * Result of DAG validation.
 */
export interface DAGValidationResult {
  /** Whether the DAG is valid */
  valid: boolean;
  /** List of validation error messages */
  errors: string[];
  /** List of validation warning messages */
  warnings: string[];
}

/**
 * A node in the in-memory DAG representation.
 */
export interface StageNode {
  /** The stage definition */
  stage: StageDefinition;
  /** IDs of stages this node depends on (incoming edges) */
  dependencyIds: string[];
  /** IDs of stages that depend on this node (outgoing edges) */
  dependentIds: string[];
  /** Edges from this node */
  outgoingEdges: StageEdge[];
  /** Edges to this node */
  incomingEdges: StageEdge[];
}

/**
 * In-memory representation of a complete DAG.
 */
export interface DAG {
  /** All nodes indexed by stage definition ID */
  nodes: Map<string, StageNode>;
  /** All edges */
  edges: StageEdge[];
  /** Root stages (no incoming edges / dependencies) */
  rootIds: string[];
  /** Leaf stages (no outgoing edges / dependents) */
  leafIds: string[];
  /** Topologically sorted stage IDs */
  topologicalOrder: string[];
  /** Execution layers — stages in each layer can run in parallel */
  executionLayers: string[][];
}

/**
 * An execution layer — a group of stages that can run in parallel.
 */
export interface ExecutionLayer {
  /** Layer index (0-based) */
  index: number;
  /** Stage IDs in this layer */
  stageIds: string[];
}
