// ────────────────────────────────────────────────────────────────
// IWorkflowDefinitionStore — persistence of workflow definitions as v2
// documents (P01 WP-1.7). One store replaces the definition, stage and
// edge repositories: a definition is read and written as a whole
// `WorkflowGraph`, and a graph save is one transaction.
// ────────────────────────────────────────────────────────────────

import type {
  DefinitionAuthor,
  DefinitionStatus,
  VersionKind,
  WorkflowDefinitionRecord,
  WorkflowDefinitionSummary,
  WorkflowDefinitionVersionRecord,
  WorkflowDefinitionVersionSummary,
  WorkflowGraph,
} from '@generatorai/workflow-spec';

export interface DefinitionListFilter {
  /** A project id, or `null` for global definitions only; omitted means all. */
  projectId?: string | null;
  status?: DefinitionStatus;
  /** Case-insensitive substring of the name. */
  q?: string;
  includeArchived?: boolean;
  /** Opaque cursor from the previous page. */
  cursor?: string;
  limit?: number;
}

export interface DefinitionListPage {
  items: WorkflowDefinitionSummary[];
  nextCursor?: string;
}

export interface NewDefinition {
  id: string;
  status: DefinitionStatus;
  graph: WorkflowGraph;
  /** An agent-authored draft's author (P06); absent for a person's. */
  authoredBy?: DefinitionAuthor | undefined;
}

export type ReplaceGraphResult =
  | { ok: true; record: WorkflowDefinitionRecord }
  | { ok: false; current: WorkflowDefinitionRecord };

export interface NewVersion {
  workflowDefinitionId: string;
  kind: VersionKind;
  graph: WorkflowGraph;
  /** sha256 of `canonical`. */
  contentHash: string;
  /** The canonical export text of `graph`. */
  canonical: string;
}

export interface IWorkflowDefinitionStore {
  list(filter?: DefinitionListFilter): Promise<DefinitionListPage>;
  /** Throws `NotFoundError`. */
  getGraph(id: string): Promise<WorkflowDefinitionRecord>;
  insert(def: NewDefinition): Promise<WorkflowDefinitionRecord>;
  /**
   * Replace the whole graph in ONE transaction when the stored revision
   * equals `expectedRevision`: stages are upserted by key (a kept key keeps
   * its row id), removed keys are deleted, edges are replaced, the revision
   * is bumped and `needsAttention` is cleared. Otherwise nothing changes and
   * the current record is returned.
   */
  replaceGraph(id: string, graph: WorkflowGraph, expectedRevision: number): Promise<ReplaceGraphResult>;
  /** Append an immutable version (the next version number). */
  insertVersion(v: NewVersion): Promise<WorkflowDefinitionVersionRecord>;
  findVersionByHash(workflowDefinitionId: string, kind: VersionKind, contentHash: string): Promise<WorkflowDefinitionVersionSummary | undefined>;
  /** Throws `NotFoundError`. */
  getVersion(versionId: string): Promise<WorkflowDefinitionVersionRecord>;
  listVersions(workflowDefinitionId: string): Promise<WorkflowDefinitionVersionSummary[]>;
  /** status = published, current version = `versionId`. */
  markPublished(workflowDefinitionId: string, versionId: string): Promise<WorkflowDefinitionRecord>;
  setArchived(workflowDefinitionId: string, archived: boolean): Promise<WorkflowDefinitionRecord>;
  /** Hard delete with every stage, edge and version. The caller checks for runs first. */
  delete(workflowDefinitionId: string): Promise<void>;
  countRuns(workflowDefinitionId: string): Promise<number>;
}
