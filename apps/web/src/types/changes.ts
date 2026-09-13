// ────────────────────────────────────────────────────────────────
// Change / checkpoint API types (web mirror of @generatorai/changes)
// ────────────────────────────────────────────────────────────────

export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed';
/**
 * What a repo in a change summary IS.
 *
 *   mount   — one of the chat's mounts (codebase or folder, any mode)
 *   nested  — a repository that lives inside a mount (`<alias>/<sub>`)
 *   linked / generated / root — the pre-mount vocabulary; still returned for
 *     workspaces created before the rewrite.
 */
export type ChangeRepoKind = 'mount' | 'nested' | 'linked' | 'generated' | 'root';
export type ChangeRevisionKind = 'baseline' | 'checkpoint' | 'working' | 'ref';

export interface ChangeRevision {
  kind: ChangeRevisionKind;
  id?: string;
  treeish?: string;
  label?: string;
  createdAt?: string;
  /** True when `treeish` is a real commit (its blobs are EOL-normalised). */
  normalized?: boolean;
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
  /**
   * True while the file's head blob still equals the blob the user accepted.
   * Any later edit moves the head blob and the file silently stops being
   * kept — there is no flag to invalidate.
   */
  kept?: boolean;
}

export interface ChangeSummaryRepo {
  alias: string;
  kind: ChangeRepoKind;
  hasBaseline: boolean;
  /**
   * THIS mount's resolved base / head.
   *
   * Optional only so an older server still type-checks. Read these, not the
   * response-level pair: that one describes the FIRST mount, which is why
   * "Undo" used to be hidden (or aimed at the wrong tree) on every other one.
   */
  base?: ChangeRevision;
  head?: ChangeRevision;
  stats: { files: number; additions: number; deletions: number };
  files: ChangeSummaryFile[];
  keptCount?: number;
  paths?: string[];
}

export interface ChangeSummary {
  workspaceId: string;
  hasGit: boolean;
  /** The FIRST repo's resolution. Prefer `repos[].base` / `repos[].head`. */
  base: ChangeRevision;
  head: ChangeRevision;
  repos: ChangeSummaryRepo[];
  stats: { files: number; additions: number; deletions: number };
  keptCount?: number;
}

// ── Per-file review (Keep / Undo) ──

/** One file, as both review routes name it. Path is repo-relative. */
export interface ChangeFileRef {
  alias: string;
  path: string;
}

export interface ReviewChangesResult {
  workspaceId: string;
  kept: number;
  unkept: number;
  keptCount: number;
}

export interface DiscardChangesResult {
  workspaceId: string;
  mounts: Array<{
    alias: string;
    ok: boolean;
    restored: number;
    deleted: number;
    preRestoreCheckpointId?: string | null;
    error?: string;
  }>;
  restoredCount: number;
  deletedCount: number;
  discardedCount: number;
  skipped: Array<{ alias: string; path: string; reason: string }>;
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
