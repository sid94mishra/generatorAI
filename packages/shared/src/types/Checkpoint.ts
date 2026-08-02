// ────────────────────────────────────────────────────────────────
// Checkpoint Types — workspace snapshots (git shadow refs)
// ────────────────────────────────────────────────────────────────
//
// A checkpoint is an immutable snapshot of a workspace repository's working
// tree, stored as a git commit object reachable ONLY from a private ref under
// `refs/generatorai/checkpoints/…`. It never touches the user's index, HEAD,
// branches or remotes.
//
// Checkpoints are the baseline primitive for:
//   • per-turn / per-stage diffs ("what did this message change?")
//   • stable review-comment anchors
//   • rewind / restore

/** Why a checkpoint was captured. */
export type CheckpointKind =
  /** Workspace creation / post-clone — the "everything since the start" baseline. */
  | 'baseline'
  /** Captured immediately before a user prompt is submitted. */
  | 'turn'
  /** Captured at a workflow stage boundary. */
  | 'stage'
  /** Captured at an automation execution-run boundary. */
  | 'autorun'
  /** Rolling, debounced snapshot taken while the agent is writing files. */
  | 'live'
  /** Explicitly created by the user. */
  | 'manual'
  /** Safety snapshot written immediately before a restore (enables redo). */
  | 'pre_restore';

/** Storage backend that materialised the snapshot. */
export type CheckpointRefKind = 'git_tree';

/** Provenance of a checkpoint — at most one branch is populated. */
export interface CheckpointProvenance {
  sessionId?: string;
  chatId?: string;
  turnId?: string;
  workflowRunId?: string;
  stageRunId?: string;
  automationExecutionRunId?: string;
  /**
   * Which side of the unit of work this snapshot represents.
   *
   * A turn/stage produces TWO checkpoints sharing one `turnId`/`stageRunId`:
   * `before` (the state the prompt was written against) and `after` (the
   * state the agent left behind). The pair is what makes "what did this turn
   * change?" answerable without guessing at adjacent sequence numbers.
   */
  phase?: 'before' | 'after';
  /** First ~200 chars of the prompt that triggered this checkpoint. */
  promptExcerpt?: string;
}

/** Aggregate change counts between a checkpoint and its parent. */
export interface CheckpointStats {
  fileCount: number;
  additions: number;
  deletions: number;
}

/** Persisted checkpoint row. */
export interface CheckpointRecord extends CheckpointProvenance, CheckpointStats {
  id: string;
  workspaceId: string;
  /** Repo alias within the workspace (`.` = workspace root). */
  repoAlias: string;
  /** Monotonic per (workspaceId, repoAlias). */
  seq: number;
  kind: CheckpointKind;
  label?: string;
  refKind: CheckpointRefKind;
  /** Commit SHA the private ref points at. */
  refValue: string;
  /** Tree SHA — the actual snapshot content (used for all diffs). */
  treeSha: string;
  parentId?: string;
  createdAt: Date;
}

/** Parameters for creating a checkpoint. */
export interface CreateCheckpointParams extends CheckpointProvenance {
  workspaceId: string;
  /** Absolute path of the repository to snapshot. */
  repoDir: string;
  /** Alias to record for this repo (`.` for the workspace root). */
  repoAlias?: string;
  kind: CheckpointKind;
  label?: string;
  /**
   * When true (default) the checkpoint is skipped if the resulting tree is
   * identical to the previous checkpoint for the same (workspace, alias).
   */
  skipIfUnchanged?: boolean;
}

/** Filters when listing checkpoints. */
export interface CheckpointFilters {
  workspaceId: string;
  repoAlias?: string;
  kinds?: CheckpointKind[];
  /** Exclude rolling `live` checkpoints (default true). */
  excludeLive?: boolean;
  limit?: number;
}

/** One file's aggregate delta between two checkpoints. */
export interface CheckpointDiffFile {
  path: string;
  oldPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  isBinary: boolean;
}

/** Result of `restore`. */
export interface RestoreCheckpointResult {
  /** Checkpoint written immediately before the restore (redo anchor). */
  preRestoreCheckpointId: string | null;
  restoredPaths: string[];
  deletedPaths: string[];
  /** Paths intentionally not touched (symlinks / hard links / errors). */
  skipped: Array<{ path: string; reason: string }>;
}

/** Retention policy for checkpoint pruning. */
export interface CheckpointRetentionPolicy {
  /** Keep at most this many non-baseline checkpoints per (workspace, alias). */
  maxPerRepo: number;
  /** Delete checkpoints older than this many days. */
  maxAgeDays: number;
  /** Rolling `live` checkpoints are kept for this many minutes only. */
  liveMaxAgeMinutes: number;
}

export const DEFAULT_CHECKPOINT_RETENTION: CheckpointRetentionPolicy = {
  maxPerRepo: 100,
  maxAgeDays: 30,
  liveMaxAgeMinutes: 60,
};
