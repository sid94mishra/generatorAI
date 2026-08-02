// ────────────────────────────────────────────────────────────────
// Change / checkpoint API types (web mirror of @generatorai/changes)
// ────────────────────────────────────────────────────────────────

export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed';
export type ChangeRepoKind = 'linked' | 'generated' | 'root';
export type ChangeRevisionKind = 'baseline' | 'checkpoint' | 'working' | 'ref';

export interface ChangeRevision {
  kind: ChangeRevisionKind;
  id?: string;
  treeish?: string;
  label?: string;
  createdAt?: string;
}

export interface ChangeSummaryFile {
  path: string;
  oldPath?: string;
  status: ChangeStatus;
  additions: number;
  deletions: number;
  isBinary: boolean;
  isTooLarge: boolean;
  oldBlob?: string;
  newBlob?: string;
  lang?: string;
}

export interface ChangeSummaryRepo {
  alias: string;
  kind: ChangeRepoKind;
  hasBaseline: boolean;
  stats: { files: number; additions: number; deletions: number };
  files: ChangeSummaryFile[];
  paths?: string[];
}

export interface ChangeSummary {
  workspaceId: string;
  hasGit: boolean;
  base: ChangeRevision;
  head: ChangeRevision;
  repos: ChangeSummaryRepo[];
  stats: { files: number; additions: number; deletions: number };
}

export interface ChangeFileVersions {
  path: string;
  alias: string;
  old: { name: string; contents: string | null; blob?: string } | null;
  new: { name: string; contents: string | null; blob?: string } | null;
  isBinary: boolean;
  isTooLarge: boolean;
  cacheKey: string;
}

export interface ChangeFilePatch {
  path: string;
  alias: string;
  patch: string;
  truncated: boolean;
  cacheKey: string;
}

/**
 * Revision selector as it appears on the wire.
 *   'baseline' | 'working' | `checkpoint:<id>` | `turn:<turnId>` |
 *   `stage:<stageRunId>` | `ref:<rev>`
 */
export type RevisionSelector = string;

// ── File tree (browsing, not diffing) ──

export interface WorkspaceTreeRepo {
  alias: string;
  kind: ChangeRepoKind;
  /** Repo-relative paths, sorted. NOT alias-prefixed. */
  paths: string[];
  /** True when the repo has more files than the server will list. */
  truncated: boolean;
}

export interface WorkspaceTree {
  workspaceId: string;
  hasGit: boolean;
  repos: WorkspaceTreeRepo[];
  totalPaths: number;
}

export interface WorkspaceTreeFile {
  alias: string;
  path: string;
  /** null when the file is binary or over the inline budget. */
  contents: string | null;
  size: number;
  isBinary: boolean;
  isTooLarge: boolean;
  lang: string;
  cacheKey: string;
}

// ── Checkpoints ──

export type CheckpointKind =
  | 'baseline'
  | 'turn'
  | 'stage'
  | 'autorun'
  | 'live'
  | 'manual'
  | 'pre_restore';

export interface CheckpointRecord {
  id: string;
  workspaceId: string;
  repoAlias: string;
  seq: number;
  kind: CheckpointKind;
  label?: string;
  refKind: 'git_tree';
  refValue: string;
  treeSha: string;
  parentId?: string;
  sessionId?: string;
  chatId?: string;
  turnId?: string;
  workflowRunId?: string;
  stageRunId?: string;
  automationExecutionRunId?: string;
  /**
   * Which side of a turn/stage this snapshot is. Both share one turnId, so
   * `before`/`after` is what distinguishes "the state the prompt was written
   * against" from "the state the agent left behind".
   */
  phase?: 'before' | 'after';
  promptExcerpt?: string;
  fileCount: number;
  additions: number;
  deletions: number;
  createdAt: string;
}

export interface RestoreCheckpointResult {
  workspaceId: string;
  checkpointId: string;
  preRestoreCheckpointId: string | null;
  restoredPaths: string[];
  deletedPaths: string[];
  skipped: Array<{ path: string; reason: string }>;
}
