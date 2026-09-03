// ────────────────────────────────────────────────────────────────
// DAG Domain Types — Data structures for directed acyclic graphs
// ────────────────────────────────────────────────────────────────

import type { StageDefinition, StageEdge } from '@generatorai/shared';

/**
 * One validation finding, with the graph element responsible for it.
 *
 * Added alongside — never instead of — the flat `errors`/`warnings` string
 * arrays below, which stay byte-identical so every existing consumer (the
 * `/validate` route body, `buildDAG`'s thrown `DAGValidationError`, the CLI's
 * `workflow validate`) is unaffected. The strings alone are unnavigable: a
 * client that reads "Cycle detected involving stages: a, b" has to re-parse
 * English to work out which stages to highlight, and "Duplicate edge from 'a'
 * to 'b'" names no edge id at all. This carries the ids directly.
 */
export interface DAGValidationIssue {
  severity: 'error' | 'warning';
  /** Stable machine code, so a client can branch without matching prose. */
  code:
    | 'empty-graph'
    | 'stage-without-prompts'
    | 'self-edge'
    | 'unknown-source-stage'
    | 'unknown-target-stage'
    | 'duplicate-edge'
    | 'cycle'
    | 'no-root-stages'
    | 'disconnected-stages';
  /** Same prose as the matching `errors`/`warnings` entry. */
  message: string;
  /** Stages this finding is about — the ones a UI should select/highlight. */
  stageIds: string[];
  /** Set when the finding is about a specific edge rather than a stage. */
  edge?: { fromStageId: string; toStageId: string; edgeType?: string };
  /** Set when the finding is about one field of a stage (e.g. `prompts`). */
  field?: string;
}

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
  /**
   * The same findings as `errors`/`warnings`, in the order they were
   * produced, each carrying the stage/edge it belongs to. One issue per
   * string in those two arrays — never more, never fewer.
   */
  issues: DAGValidationIssue[];
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
