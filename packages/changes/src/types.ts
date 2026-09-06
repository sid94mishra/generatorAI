// ────────────────────────────────────────────────────────────────
// Change-set types — the centralized "what changed?" model
// ────────────────────────────────────────────────────────────────

export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed';

/** A single changed file within a repository. */
export interface ChangedFile {
  /** Alias-prefixed path (e.g. `frontend/src/app.ts`, or bare path for root repo). */
  path: string;
  status: ChangeStatus;
  /** Unified diff hunk for this file (may be empty for committed-only entries). */
  diff: string;
}

export type ChangeRepoKind =
  /** A workspace mount (the directory the agent was asked to work in). */
  | 'mount'
  /** A repository nested one level inside a mount (multi-repo folder). */
  | 'nested'
  /** Legacy: a registered worktree. */
  | 'linked'
  /** Legacy: an agent-generated subdirectory repo. */
  | 'generated'
  /** Legacy: the workspace root itself. */
  | 'root';

/**
 * A mount as the change engine sees it. `gitDir` is the mount's private
 * shadow repository (objects, refs, index files); when absent the mount's
 * own `.git` is used, which is only the case for workspaces that predate
 * shadow stores.
 */
export interface MountRef {
  alias: string;
  path: string;
  gitDir?: string;
  /** Commit the mount's branch started from / HEAD when it was mounted. */
  baseCommit?: string;
  /** Immediate child repositories, each with its own shadow store. */
  nested?: Array<{ name: string; gitDir?: string }>;
}

/** All changes within one repository/worktree inside a workspace. */
export interface ChangeRepo {
  /** `.` for the workspace root repo, else the subdir / worktree alias. */
  alias: string;
  kind: ChangeRepoKind;
  repoDir: string;
  files: ChangedFile[];
}

/** The complete change set across every repo/worktree in a workspace. */
export interface ChangeSet {
  hasGit: boolean;
  repos: ChangeRepo[];
}

/** A worktree registered against a workspace (linked project codebase). */
export interface WorktreeRef {
  alias: string;
  worktreePath: string;
}

export interface GetChangeSetParams {
  /** Absolute path to the workspace root directory. */
  rootPath: string;
  /** Registered worktrees (linked codebases). Legacy — prefer `mounts`. */
  worktrees?: WorktreeRef[];
  /** Workspace mounts. When present, ONLY these (and their nested repos) are tracked. */
  mounts?: MountRef[];
  /**
   * Legacy: auto-run `git init` in agent-generated subdirectories. Off by
   * default — a read request must never mutate the filesystem.
   */
  autoInit?: boolean;
}
