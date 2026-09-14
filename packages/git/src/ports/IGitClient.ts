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

/** Commits `ahead` of / `behind` an upstream ref. */
export interface GitAheadBehind {
  ahead: number;
  behind: number;
}

/** Result of the working-tree-free merge probe (`git merge-tree --write-tree`). */
export interface GitMergeTreeResult {
  /**
   * False when git could not answer the question at all — most often a git
   * older than 2.38 (no `--write-tree`), but also unresolvable refs. Callers
   * must fall back to a real `--no-commit` merge rather than treating an
   * empty `conflicts` list as "clean".
   */
  supported: boolean;
  conflicts: string[];
}

/** Outcome of a real `git merge`. */
export interface GitMergeResult {
  ok: boolean;
  conflicts: string[];
}

/** A commit created by `commitWithSha`. */
export interface GitCommitResult {
  sha: string;
  message: string;
}

/** Options for `merge`. */
export interface MergeOptions {
  /** Merge without creating the commit (`--no-commit --no-ff`). */
  noCommit?: boolean;
  /** Commit message for the merge commit (`-m`). Ignored when `noCommit`. */
  message?: string;
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
export interface WriteTreeOptions {
  /**
   * Stage with the repository's own line-ending configuration instead of the
   * byte-exact snapshot config. Snapshots disable `core.autocrlf` so a
   * restore is lossless — but that stores CRLF blobs, and comparing one
   * against a real commit (whose blobs git normalised to LF) reports every
   * line of every file as changed. Set this when the other side of the diff
   * is a commit rather than another snapshot.
   */
  honourEol?: boolean;
}

/** Options for `initShadowRepo`. */
export interface ShadowRepoOptions {
  /**
   * Absolute `objects/` directory of the origin repository. Written to
   * `objects/info/alternates` so unchanged blobs are shared rather than
   * duplicated — only content the agent creates costs disk.
   */
  alternatesObjectsDir?: string;
  /** Effective `core.autocrlf` of the origin repo, so EOL-normalised trees compare to its commits. */
  autocrlf?: string;
  /** Patterns for `info/exclude` (local-only ignores; the work tree's own .gitignore still applies). */
  excludes?: string[];
}

/** Options for `addWorktree`. */
export interface AddWorktreeOptions {
  /** Check out this existing branch (fails if another worktree holds it). */
  branch?: string;
  /** Create this branch, starting at `base` (or `branch`, or HEAD). */
  newBranch?: string;
  /** Start point for `newBranch`. */
  base?: string;
}

export interface IGitClient {
  /**
   * A client whose every command runs with `GIT_DIR=<gitDir>` and
   * `GIT_WORK_TREE=<repoDir argument>`. This is how checkpoints keep their
   * objects, refs and index files in a private "shadow" repository instead of
   * the user's own `.git`, and how non-git folders get change tracking
   * without ever being `git init`-ed.
   */
  withGitDir(gitDir: string): IGitClient;
  /**
   * Create (or verify) a shadow repository at `gitDir` for `workTree`.
   * Idempotent. Returns false when git could not create it.
   */
  initShadowRepo(gitDir: string, workTree: string, opts?: ShadowRepoOptions): Promise<boolean>;
  /** `git status --porcelain` is empty (tracked AND untracked). */
  isClean(repoDir: string): Promise<boolean>;
  /** Whether a local branch exists. */
  branchExists(repoDir: string, branch: string): Promise<boolean>;
  /** `git branch <name> [<base>]` — creates without checking out. */
  createBranch(repoDir: string, name: string, base?: string): Promise<void>;
  /** `git checkout <branch>` in an existing checkout. */
  checkoutBranch(repoDir: string, branch: string): Promise<void>;
  /** Path of the worktree that has `branch` checked out, or null. */
  worktreeHoldingBranch(repoPath: string, branch: string): Promise<string | null>;
  /** `git worktree add` with an existing or a new branch. */
  addWorktree(repoPath: string, worktreePath: string, opts: AddWorktreeOptions): Promise<void>;
  /** Absolute `objects/` directory shared by every worktree of the repo. */
  commonObjectsDir(repoDir: string): Promise<string | null>;
  /** One config value (`git config --get`), or null when unset. */
  getConfig(repoDir: string, key: string): Promise<string | null>;
  /** Immediate child directories of `dir` that are git repositories of their own. */
  nestedRepos(dir: string): Promise<string[]>;
  /**
   * Remove everything an earlier GeneratorAI wrote into a repository's own
   * git dir: `refs/generatorai/**` and the `generatorai-*.index` files.
   * Objects those refs kept alive become collectable by `git gc`. Never
   * touches branches, tags, HEAD or the index. Returns what was removed.
   */
  scrubLegacyCheckpointData(repoDir: string, opts?: { dryRun?: boolean }): Promise<{ refs: string[]; files: string[] }>;

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
  writeTreeFromWorktree(repoDir: string, indexFile: string, opts?: WriteTreeOptions): Promise<string | null>;
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
  /**
   * Unified patch between two tree-ishes, optionally scoped to a path.
   *
   * Several paths may be given: a rename needs BOTH sides in the pathspec,
   * because git applies the pathspec before it pairs the halves up, so
   * asking for the new path alone reports the file as freshly added.
   */
  diffPatch(
    repoDir: string,
    from: string,
    to?: string,
    filePath?: string | readonly string[],
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

  // ── Source control (remote sync / merge / review) ─────────────
  //
  // Still purely local git; "source control" here means the operations a
  // review-and-merge UI needs on top of the plumbing above.

  /** `git fetch <remote> [<ref>]`. Throws GitError on failure. */
  fetch(repoDir: string, remote?: string, ref?: string): Promise<void>;
  /**
   * Default branch of `origin`, e.g. `main`. Tries, in order:
   *   git symbolic-ref --short refs/remotes/origin/HEAD   (strip the `origin/` prefix)
   *   git remote show origin                              (parse "HEAD branch: x")
   *   git ls-remote --symref origin HEAD                  (parse "ref: refs/heads/x\tHEAD")
   * Null when none can be determined. Cached per repoDir for 60s (positive AND
   * negative results; a short TTL is fine for both).
   */
  defaultBranch(repoDir: string, remote?: string): Promise<string | null>;
  /**
   * `git rev-list --left-right --count <upstream>...<ref>` → commits `ahead` of
   * and `behind` upstream. Null when the refs can't be resolved.
   */
  aheadBehind(repoDir: string, ref: string, upstream: string): Promise<GitAheadBehind | null>;
  /** `git rev-parse --abbrev-ref <branch>@{upstream}` → e.g. `origin/main`, or null. */
  upstreamOf(repoDir: string, branch: string): Promise<string | null>;
  /** `git rev-parse --symbolic-full-name HEAD` === 'HEAD' (detached). */
  isDetached(repoDir: string): Promise<boolean>;
  /** True when `<gitdir>/MERGE_HEAD` exists (use `absoluteGitDir`, fall back to `<repoDir>/.git`). */
  mergeInProgress(repoDir: string): Promise<boolean>;
  /** `git diff --name-only --diff-filter=U` — paths with unresolved conflicts. */
  unmergedFiles(repoDir: string): Promise<string[]>;
  /**
   * Dry-run merge of `theirs` into `ours` WITHOUT touching the working tree,
   * via `git merge-tree --write-tree --name-only <ours> <theirs>` (git >= 2.38).
   * Exit 0 → clean. Exit 1 → conflicts. Any other exit code (old git that
   * lacks `--write-tree`, bad refs) → `{ supported: false, conflicts: [] }`.
   */
  mergeTreeConflicts(repoDir: string, ours: string, theirs: string): Promise<GitMergeTreeResult>;
  /**
   * `git merge [--no-commit --no-ff | -m <message>] <ref>`. Does NOT throw on a
   * conflicted merge: exit != 0 with unmerged files present →
   * `{ ok: false, conflicts: [...] }`. Exit != 0 with NO unmerged files (e.g.
   * local changes would be overwritten) → throws GitError.
   */
  merge(repoDir: string, ref: string, opts?: MergeOptions): Promise<GitMergeResult>;
  /** `git merge --abort` — swallows failure when no merge is in progress. */
  mergeAbort(repoDir: string): Promise<void>;
  /**
   * After conflicts are resolved: `git add -A` then commit with `message`.
   * Returns the new sha. Throws GitError when unmerged paths remain.
   */
  commitMerge(repoDir: string, message: string): Promise<string>;
  /** `git add -A`. Throws GitError on failure. */
  addAll(repoDir: string): Promise<void>;
  /** Stage everything and commit; returns `{ sha, message }`, or null when there was nothing to commit. */
  commitWithSha(repoDir: string, message: string): Promise<GitCommitResult | null>;
  /** `git push -u <remote> <branch>`. Throws GitError on failure. */
  pushSetUpstream(repoDir: string, remote: string, branch: string): Promise<void>;
  /** `git log --no-merges --pretty=format:%s -n <max> <range>` → subject lines. Empty array on failure. */
  log(repoDir: string, range: string, max?: number): Promise<string[]>;
  /** Name-status of staged + unstaged + untracked changes in the working tree. */
  changedFilesSummary(repoDir: string): Promise<GitNameStatusEntry[]>;
  /** `git --version` → e.g. `2.45.1`, or null. Cached for the client's lifetime. */
  gitVersion(): Promise<string | null>;
}
