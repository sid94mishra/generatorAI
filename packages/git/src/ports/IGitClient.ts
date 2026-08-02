// ────────────────────────────────────────────────────────────────
// IGitClient — port for local git operations (no VCS-host / PR concerns)
// ────────────────────────────────────────────────────────────────

export interface GitClientOptions {
  /** Root directory where `clone()` places bare/regular clones. */
  workspacesDir: string;
  /** Default timeout (ms) for long-running ops (clone/pull/push). */
  defaultTimeoutMs?: number;
}

export interface GitTreeEntry {
  type: 'blob' | 'tree';
  name: string;
  path: string;
  size?: number;
}

/** A private ref (name + target SHA). */
export interface GitRef {
  ref: string;
  sha: string;
}

/** One row of `git diff --numstat -z`. */
export interface GitNumstatEntry {
  /** `-1` for binary files. */
  additions: number;
  deletions: number;
  path: string;
  /** Set only for renames/copies. */
  oldPath?: string;
}

/** One row of `git diff --name-status -z`. */
export interface GitNameStatusEntry {
  /** Raw git status letter (A/M/D/R/C/T). */
  code: string;
  path: string;
  oldPath?: string;
}

/**
 * One row of `git diff --raw -z`, which carries BOTH blob SHAs plus the
 * status in a single command. This is what makes a change summary cost a
 * constant number of subprocesses instead of two per changed file.
 */
export interface GitRawDiffEntry {
  code: string;
  path: string;
  oldPath?: string;
  /** All-zero SHA is git's "absent on this side" sentinel; normalised to undefined. */
  oldSha?: string;
  newSha?: string;
}

/** One blob from `git ls-tree -r --long`. */
export interface GitBlobEntry {
  path: string;
  sha: string;
  size: number;
}

/**
 * Local git operations. Intentionally excludes VCS-host operations like
 * opening pull requests — those belong to a source-control provider
 * (see @generatorai/source-control).
 */
export interface IGitClient {
  cloneToDirectory(repoUrl: string, targetDir: string, branch?: string): Promise<string>;
  clone(repoUrl: string, branch?: string): Promise<string>;
  pull(repoDir: string, branch?: string): Promise<void>;
  checkoutNewBranch(repoDir: string, branchName: string): Promise<void>;
  commitAndPush(repoDir: string, message: string, branch?: string): Promise<void>;
  commit(repoDir: string, message: string): Promise<boolean>;
  push(repoDir: string, branch?: string): Promise<void>;
  getStatus(repoDir: string): Promise<string>;
  getDiff(repoDir: string, staged?: boolean): Promise<string>;
  firstCommit(repoDir: string): Promise<string | null>;
  diffNameStatus(repoDir: string, range: string): Promise<string>;
  isGitRepo(dir: string): Promise<boolean>;
  initIfNeeded(dir: string): Promise<boolean>;
  lsFiles(dir: string): Promise<string[]>;
  currentBranch(repoDir: string): Promise<string | null>;
  cleanup(repoDir: string): Promise<void>;
  bareClone(repoUrl: string, targetDir: string): Promise<string>;
  createWorktree(
    repoPath: string,
    worktreePath: string,
    branchName: string,
    baseBranch?: string,
  ): Promise<string>;
  removeWorktree(repoPath: string, worktreePath: string): Promise<void>;
  listWorktrees(repoPath: string): Promise<string[]>;
  fetchAll(repoPath: string): Promise<void>;
  getBranches(repoPath: string): Promise<string[]>;
  pruneWorktrees(repoPath: string): Promise<void>;
  lsTree(repoPath: string, subPath?: string, ref?: string): Promise<GitTreeEntry[]>;
  showFile(repoPath: string, filePath: string, ref?: string): Promise<string>;
  getRemoteUrl(repoDir: string, remote?: string): Promise<string | null>;

  // ── Plumbing (snapshots / checkpoints) ────────────────────────
  //
  // These operate on git object plumbing only. None of them mutate the
  // user's index, HEAD, branches or remotes.

  /** Absolute path of the repository's git directory (worktree-aware). */
  absoluteGitDir(repoDir: string): Promise<string | null>;
  /**
   * Stage the entire working tree into a *throwaway* index file and write it
   * out as a tree object. The repository's real index is untouched.
   * Reusing the same `indexFile` across calls lets git's stat cache skip
   * re-hashing unchanged files, making repeated snapshots O(changed files).
   * Returns the tree SHA, or `null` when the operation fails.
   */
  writeTreeFromWorktree(repoDir: string, indexFile: string): Promise<string | null>;
  /** Create a commit object pointing at `treeSha`. Returns the commit SHA. */
  commitTree(
    repoDir: string,
    treeSha: string,
    message: string,
    parentSha?: string,
  ): Promise<string>;
  /** Point `ref` at `sha` (creates the ref if missing). */
  updateRef(repoDir: string, ref: string, sha: string): Promise<void>;
  /** Delete `ref`. No-op when it does not exist. */
  deleteRef(repoDir: string, ref: string): Promise<void>;
  /** List refs under `prefix` (e.g. `refs/generatorai/checkpoints/`). */
  listRefs(repoDir: string, prefix: string): Promise<GitRef[]>;
  /** Resolve a revision to a SHA, or null when it cannot be resolved. */
  revParse(repoDir: string, rev: string): Promise<string | null>;
  /** Whether an object exists in the repository. */
  objectExists(repoDir: string, sha: string): Promise<boolean>;
  /** `git diff --numstat -z --find-renames` between two tree-ishes. */
  diffNumstat(
    repoDir: string,
    from: string,
    to?: string,
    pathspec?: string[],
  ): Promise<GitNumstatEntry[]>;
  /** `git diff --name-status -z --find-renames` between two tree-ishes. */
  diffNameStatusZ(
    repoDir: string,
    from: string,
    to?: string,
    pathspec?: string[],
  ): Promise<GitNameStatusEntry[]>;
  /**
   * `git diff --raw -z --find-renames` — status AND both blob SHAs in one
   * call. Prefer this over per-file `blobShaAt` when summarising a diff.
   */
  diffRaw(
    repoDir: string,
    from: string,
    to?: string,
    pathspec?: string[],
  ): Promise<GitRawDiffEntry[]>;
  /** Every blob in a tree with its SHA and size (`git ls-tree -r --long`). */
  lsTreeBlobs(repoDir: string, treeish: string): Promise<GitBlobEntry[]>;
  /** Unified patch between two tree-ishes, optionally scoped to one path. */
  diffPatch(
    repoDir: string,
    from: string,
    to?: string,
    filePath?: string,
    contextLines?: number,
  ): Promise<string>;
  /** Byte size of a blob object (`git cat-file -s`), or null. */
  blobSize(repoDir: string, sha: string): Promise<number | null>;
  /** Blob SHA for `path` inside `treeish`, or null when absent. */
  blobShaAt(repoDir: string, treeish: string, filePath: string): Promise<string | null>;
  /**
   * Read a blob directly by object id — one subprocess instead of the three
   * a tree-path lookup needs. Returns null when the object is absent (it may
   * have been pruned), so callers must keep a fallback path.
   */
  readBlobById(repoDir: string, sha: string): Promise<string | null>;
  /**
   * Restore `paths` in the working tree from `treeish` (binary-safe, via a
   * throwaway index + `git checkout-index`).
   */
  restorePathsFromTree(
    repoDir: string,
    treeish: string,
    indexFile: string,
    paths: string[],
  ): Promise<void>;
}
