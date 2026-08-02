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

export type ChangeRepoKind = 'linked' | 'generated' | 'root';

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
  /** Registered worktrees (linked codebases). */
  worktrees?: WorktreeRef[];
  /**
   * Auto-run `git init` in agent-generated subdirectories that have code but
   * no repo yet, so newly-generated codebases get a real change set.
   * Default true.
   */
  autoInit?: boolean;
}
