// ────────────────────────────────────────────────────────────────
// GitClient — local git operations (clone, worktree, status, diff, commit)
// ────────────────────────────────────────────────────────────────
//
// Extracted from the legacy core `GitManager`. VCS-host operations (opening
// pull requests) intentionally live in @generatorai/source-control instead —
// this class is purely about the local git working copy.

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { ILogger } from '@generatorai/shared';
import { GitError } from '@generatorai/shared';
import type { GitProcessRunOptions, IGitProcessRunner } from './ports/IGitProcessRunner.js';
import type {
  AddWorktreeOptions,
  GitAheadBehind,
  GitBlobEntry,
  GitClientOptions,
  GitCommitResult,
  GitMergeResult,
  GitMergeTreeResult,
  GitNameStatusEntry,
  GitNumstatEntry,
  GitRawDiffEntry,
  GitRef,
  GitTreeEntry,
  IGitClient,
  MergeOptions,
  ShadowRepoOptions,
  WriteTreeOptions,
} from './ports/IGitClient.js';

/**
 * Runner decorator that pins every command to a shadow git directory.
 *
 * `GIT_WORK_TREE` is the command's cwd, so the same client works for any
 * mount; `GIT_DIR` is the private repository that receives objects, refs
 * and index files. Because both are explicit, git never looks for (or
 * touches) a `.git` inside the work tree — a linked worktree's `.git` file
 * and a nested repository's `.git` directory are just ordinary entries.
 */
class ShadowGitRunner implements IGitProcessRunner {
  constructor(
    private readonly base: IGitProcessRunner,
    private readonly gitDir: string,
  ) {}

  run(command: string, args: string[], options: GitProcessRunOptions) {
    return this.base.run(command, args, {
      ...options,
      env: {
        ...(options.env ?? {}),
        GIT_DIR: this.gitDir,
        GIT_WORK_TREE: options.cwd,
      },
    });
  }
}

/** git uses an all-zero SHA to mean "absent on this side". */
function normalizeSha(sha: string | undefined): string | undefined {
  if (!sha) return undefined;
  return /^0+$/.test(sha) ? undefined : sha;
}

/**
 * How long a positive `isGitRepo` answer is trusted without re-asking git.
 *
 * A directory that is inside a work tree does not stop being one; the TTL is
 * only a guard against a workspace that is deleted or moved out from under a
 * long-lived process, where a stale `true` would turn into a failed git
 * command rather than a wrong answer.
 */
const REPO_PROBE_TTL_MS = 5 * 60_000;

/**
 * How long a resolved (or unresolvable) default branch is trusted.
 *
 * Short on purpose: `origin/HEAD` is created by `clone` and by an explicit
 * `git remote set-head`, so a repo that has no answer now can grow one a
 * moment later, and a repo whose default branch was renamed upstream should
 * not stay wrong for the lifetime of the process. A minute is long enough to
 * collapse the burst of calls a single UI refresh makes.
 */
const DEFAULT_BRANCH_TTL_MS = 60_000;

export class GitClient implements IGitClient {
  private readonly workspacesDir: string;
  private readonly timeout: number;
  private readonly runner: IGitProcessRunner;
  private readonly options: GitClientOptions;
  /** Set on clients produced by `withGitDir`. */
  private readonly scopedGitDir: string | undefined;
  /**
   * Directories already known to be inside a work tree.
   *
   * `isGitRepo` spawned a `git rev-parse --is-inside-work-tree` process on
   * EVERY call, and the checkpoint path calls it twice per chat turn (once
   * before the turn, once after) against the same directory. Measured on a
   * live server that was 25 of the git processes spawned during a short chat
   * session — a third of them — each costing ~300 ms of process start on
   * Windows, for an answer that cannot change.
   *
   * Only positive answers are cached: a directory that is NOT a repo becomes
   * one as soon as `initIfNeeded` runs, so caching `false` would defeat it.
   */
  private readonly repoProbeCache = new Map<string, number>();
  /**
   * Resolved default branches, keyed by `repoDir\0remote`.
   *
   * `defaultBranch` costs up to three git invocations and the last of them
   * (`ls-remote`) talks to the network, so a UI that asks once per rendered
   * row would be unusable without this. Negative answers are cached too —
   * a repo with no `origin/HEAD` is exactly the case that pays the full
   * three-probe price.
   */
  private readonly defaultBranchCache = new Map<string, { value: string | null; at: number }>();
  /**
   * `git --version` never changes while the process runs, so it is resolved
   * at most once per client.
   */
  private gitVersionCache: { value: string | null } | undefined;

  constructor(
    private readonly baseRunner: IGitProcessRunner,
    private readonly logger: ILogger,
    options: GitClientOptions,
    scope?: { gitDir: string },
  ) {
    this.options = options;
    this.workspacesDir = options.workspacesDir;
    this.timeout = options.defaultTimeoutMs ?? 120_000;
    this.scopedGitDir = scope?.gitDir;
    this.runner = scope ? new ShadowGitRunner(baseRunner, scope.gitDir) : baseRunner;
  }

  withGitDir(gitDir: string): IGitClient {
    return new GitClient(this.baseRunner, this.logger, this.options, { gitDir });
  }

  async initShadowRepo(gitDir: string, workTree: string, opts: ShadowRepoOptions = {}): Promise<boolean> {
    try {
      await fs.mkdir(gitDir, { recursive: true });
      const env = { GIT_DIR: gitDir, GIT_WORK_TREE: workTree };
      const exists = await fs
        .access(path.join(gitDir, 'HEAD'))
        .then(() => true)
        .catch(() => false);
      if (!exists) {
        const init = await this.baseRunner.run('git', ['init', '-q', '-b', 'main'], {
          cwd: workTree,
          timeout: 10_000,
          env,
        });
        if (init.exitCode !== 0) {
          this.logger.warn(`[Git] shadow init failed at ${gitDir}: ${init.stderr}`);
          return false;
        }
      }
      if (!exists) {
        // Explicit, because `git init` with GIT_DIR outside the tree may
        // record the repository as bare on some versions.
        await this.baseRunner.run('git', ['config', 'core.bare', 'false'], { cwd: workTree, timeout: 5_000, env });
        await this.baseRunner.run('git', ['config', 'core.autocrlf', opts.autocrlf ?? 'false'], {
          cwd: workTree,
          timeout: 5_000,
          env,
        });
      } else if (opts.autocrlf !== undefined) {
        await this.baseRunner.run('git', ['config', 'core.autocrlf', opts.autocrlf], {
          cwd: workTree,
          timeout: 5_000,
          env,
        });
      }
      if (opts.alternatesObjectsDir) {
        const infoDir = path.join(gitDir, 'objects', 'info');
        await fs.mkdir(infoDir, { recursive: true });
        await fs.writeFile(path.join(infoDir, 'alternates'), opts.alternatesObjectsDir + '\n', 'utf-8');
      }
      if (opts.excludes?.length) {
        const infoDir = path.join(gitDir, 'info');
        await fs.mkdir(infoDir, { recursive: true });
        await fs.writeFile(path.join(infoDir, 'exclude'), opts.excludes.join('\n') + '\n', 'utf-8');
      }
      return true;
    } catch (err) {
      this.logger.warn(`[Git] initShadowRepo failed at ${gitDir}: ${err}`);
      return false;
    }
  }

  async isClean(repoDir: string): Promise<boolean> {
    const result = await this.runner.run('git', ['status', '--porcelain', '--untracked-files=normal'], {
      cwd: repoDir,
      timeout: 30_000,
    });
    if (result.exitCode !== 0) {
      throw new GitError(`Failed to read status in ${repoDir}: ${result.stderr}`);
    }
    return result.stdout.trim().length === 0;
  }

  async branchExists(repoDir: string, branch: string): Promise<boolean> {
    const sha = await this.revParse(repoDir, `refs/heads/${branch}`);
    return sha !== null;
  }

  async createBranch(repoDir: string, name: string, base?: string): Promise<void> {
    const args = ['branch', name];
    if (base) args.push(base);
    const result = await this.runner.run('git', args, { cwd: repoDir, timeout: 15_000 });
    if (result.exitCode !== 0) {
      throw new GitError(`Failed to create branch ${name}: ${result.stderr}`);
    }
  }

  async checkoutBranch(repoDir: string, branch: string): Promise<void> {
    const result = await this.runner.run('git', ['checkout', '-q', branch], { cwd: repoDir, timeout: 60_000 });
    if (result.exitCode !== 0) {
      throw new GitError(`Failed to check out ${branch}: ${result.stderr}`);
    }
  }

  async worktreeHoldingBranch(repoPath: string, branch: string): Promise<string | null> {
    const result = await this.runner.run('git', ['worktree', 'list', '--porcelain'], {
      cwd: repoPath,
      timeout: 10_000,
    });
    if (result.exitCode !== 0) return null;
    let current: string | null = null;
    for (const line of result.stdout.split('\n')) {
      if (line.startsWith('worktree ')) current = line.slice('worktree '.length).trim();
      else if (line.startsWith('branch ')) {
        const ref = line.slice('branch '.length).trim();
        if (ref === `refs/heads/${branch}` || ref === branch) return current;
      }
    }
    return null;
  }

  async addWorktree(repoPath: string, worktreePath: string, opts: AddWorktreeOptions): Promise<void> {
    await fs.mkdir(path.dirname(worktreePath), { recursive: true });
    const args = ['worktree', 'add'];
    if (opts.newBranch) {
      args.push('-b', opts.newBranch, worktreePath);
      const start = opts.base ?? opts.branch;
      if (start) args.push(start);
    } else if (opts.branch) {
      args.push(worktreePath, opts.branch);
    } else {
      args.push('--detach', worktreePath);
    }
    const result = await this.runner.run('git', args, { cwd: repoPath, timeout: this.timeout });
    if (result.exitCode !== 0) {
      throw new GitError(`Failed to create worktree at ${worktreePath}: ${result.stderr}`);
    }
    this.logger.info(`[Git] Created worktree at ${worktreePath}${opts.newBranch ? ` (new branch ${opts.newBranch})` : opts.branch ? ` (branch ${opts.branch})` : ''}`);
  }

  async commonObjectsDir(repoDir: string): Promise<string | null> {
    try {
      const result = await this.runner.run('git', ['rev-parse', '--git-common-dir'], {
        cwd: repoDir,
        timeout: 5_000,
      });
      if (result.exitCode !== 0) return null;
      const common = result.stdout.trim();
      if (!common) return null;
      return path.join(path.resolve(repoDir, common), 'objects');
    } catch {
      return null;
    }
  }

  async getConfig(repoDir: string, key: string): Promise<string | null> {
    try {
      const result = await this.runner.run('git', ['config', '--get', key], { cwd: repoDir, timeout: 5_000 });
      if (result.exitCode !== 0) return null;
      const value = result.stdout.trim();
      return value.length > 0 ? value : null;
    } catch {
      return null;
    }
  }

  async scrubLegacyCheckpointData(repoDir: string, opts: { dryRun?: boolean } = {}): Promise<{ refs: string[]; files: string[] }> {
    const refs = (await this.listRefs(repoDir, 'refs/generatorai/')).map((r) => r.ref);
    const files: string[] = [];
    const gitDir = await this.absoluteGitDir(repoDir);
    if (gitDir) {
      for (const name of await fs.readdir(gitDir).catch(() => [] as string[])) {
        if (/^generatorai-.*\.index$/.test(name)) files.push(path.join(gitDir, name));
      }
    }
    if (!opts.dryRun) {
      for (const ref of refs) await this.deleteRef(repoDir, ref);
      for (const file of files) await fs.rm(file, { force: true }).catch(() => undefined);
    }
    return { refs, files };
  }

  async nestedRepos(dir: string): Promise<string[]> {
    const out: string[] = [];
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === '.git' || entry.name === 'node_modules') continue;
        try {
          await fs.access(path.join(dir, entry.name, '.git'));
          out.push(entry.name);
        } catch {
          /* not a repo */
        }
      }
    } catch {
      /* unreadable */
    }
    return out.sort();
  }

  /**
   * Clone a repository into a specific target directory (per-run isolation).
   * Always performs a fresh clone — no reuse of existing clones.
   */
  async cloneToDirectory(repoUrl: string, targetDir: string, branch?: string): Promise<string> {
    await fs.mkdir(path.dirname(targetDir), { recursive: true });

    const args = ['clone', '--depth', '1'];
    if (branch) args.push('--branch', branch);
    // `--`: a URL or directory starting with `-` is never read as an option (C-20).
    args.push('--', repoUrl, targetDir);

    const result = await this.runner.run('git', args, {
      cwd: path.dirname(targetDir),
      timeout: this.timeout,
    });

    if (result.exitCode !== 0) {
      throw new GitError(`Failed to clone ${repoUrl}: ${result.stderr}`);
    }

    this.logger.info(`[Git] Cloned ${repoUrl} to ${targetDir}`);
    return targetDir;
  }

  /**
   * Clone a repository into the workspaces directory (reuse + pull if present).
   */
  async clone(repoUrl: string, branch?: string): Promise<string> {
    const repoName = this.extractRepoName(repoUrl);
    const targetDir = path.join(this.workspacesDir, repoName);

    await fs.mkdir(this.workspacesDir, { recursive: true });

    try {
      await fs.access(path.join(targetDir, '.git'));
      this.logger.info(`[Git] Repository already cloned at ${targetDir}, pulling latest`);
      await this.pull(targetDir, branch);
      return targetDir;
    } catch {
      // Not cloned yet, proceed
    }

    const args = ['clone', '--depth', '1'];
    if (branch) args.push('--branch', branch);
    args.push(repoUrl, targetDir);

    const result = await this.runner.run('git', args, {
      cwd: this.workspacesDir,
      timeout: this.timeout,
    });

    if (result.exitCode !== 0) {
      throw new GitError(`Failed to clone ${repoUrl}: ${result.stderr}`);
    }

    this.logger.info(`[Git] Cloned ${repoUrl} to ${targetDir}`);
    return targetDir;
  }

  /** Pull latest changes. */
  async pull(repoDir: string, branch?: string): Promise<void> {
    const args = [...(await this.remoteUrlArgs(repoDir, 'origin')), 'pull', 'origin'];
    if (branch) args.push(branch);

    const result = await this.runner.run('git', args, {
      cwd: repoDir,
      timeout: this.timeout,
    });

    if (result.exitCode !== 0) {
      throw new GitError(`Failed to pull in ${repoDir}: ${result.stderr}`);
    }

    this.logger.info(`[Git] Pulled latest in ${repoDir}`);
  }

  /** Create and checkout a new branch. */
  async checkoutNewBranch(repoDir: string, branchName: string): Promise<void> {
    const result = await this.runner.run('git', ['checkout', '-b', branchName], {
      cwd: repoDir,
      timeout: 30_000,
    });

    if (result.exitCode !== 0) {
      throw new GitError(`Failed to create branch ${branchName}: ${result.stderr}`);
    }

    this.logger.info(`[Git] Created and checked out branch ${branchName}`);
  }

  /** Stage all changes, commit (if any), and push. */
  async commitAndPush(repoDir: string, message: string, branch?: string): Promise<void> {
    const committed = await this.commit(repoDir, message);
    if (!committed) return;
    await this.push(repoDir, branch);
  }

  /**
   * Stage all changes and commit. Returns `false` when there was nothing to
   * commit (clean working tree), `true` when a commit was created.
   */
  async commit(repoDir: string, message: string): Promise<boolean> {
    let result = await this.runner.run('git', ['add', '-A'], {
      cwd: repoDir,
      timeout: 30_000,
    });
    if (result.exitCode !== 0) {
      throw new GitError(`Failed to stage files: ${result.stderr}`);
    }

    // Nothing staged → nothing to commit.
    result = await this.runner.run('git', ['diff', '--cached', '--quiet'], {
      cwd: repoDir,
      timeout: 10_000,
    });
    if (result.exitCode === 0) {
      this.logger.info('[Git] No changes to commit');
      return false;
    }

    // The message goes through stdin (`-F -`), never argv: generated messages
    // legitimately contain backticks and quotes, which the process runner's
    // argument guard would otherwise reject as shell metacharacters.
    result = await this.runner.run('git', ['commit', '-F', '-', '--allow-empty-message'], {
      cwd: repoDir,
      timeout: 30_000,
      stdin: message,
    });
    if (result.exitCode !== 0) {
      throw new GitError(`Failed to commit: ${result.stderr}`);
    }

    this.logger.info(`[Git] Committed: "${message}"`);
    return true;
  }

  /** Push to origin (optionally a specific branch). */
  async push(repoDir: string, branch?: string): Promise<void> {
    const pushArgs = [...(await this.remoteUrlArgs(repoDir, 'origin')), 'push', 'origin'];
    if (branch) pushArgs.push(branch);

    const result = await this.runner.run('git', pushArgs, {
      cwd: repoDir,
      timeout: this.timeout,
    });

    if (result.exitCode !== 0) {
      throw new GitError(`Failed to push: ${result.stderr}`);
    }

    this.logger.info(`[Git] Pushed ${repoDir}${branch ? ` (${branch})` : ''}`);
  }

  /** Get the porcelain status of the repository (untracked expanded). */
  async getStatus(repoDir: string): Promise<string> {
    const result = await this.runner.run('git', ['status', '--porcelain', '-uall'], {
      cwd: repoDir,
      timeout: 10_000,
    });
    return result.stdout;
  }

  /** Get the diff of current changes (staged or unstaged). */
  async getDiff(repoDir: string, staged?: boolean): Promise<string> {
    const args = ['diff'];
    if (staged) args.push('--cached');

    const result = await this.runner.run('git', args, {
      cwd: repoDir,
      timeout: 30_000,
    });
    return result.stdout;
  }

  /** Return the root (first) commit hash, or null if the repo has no commits. */
  async firstCommit(repoDir: string): Promise<string | null> {
    try {
      const result = await this.runner.run('git', ['rev-list', '--max-parents=0', 'HEAD'], {
        cwd: repoDir,
        timeout: 5_000,
      });
      if (result.exitCode !== 0) return null;
      const line = result.stdout.trim().split(/\r?\n/)[0]?.trim();
      return line && line.length > 0 ? line : null;
    } catch {
      return null;
    }
  }

  /** Name-status list of files changed across `range` (e.g. `abc..HEAD`). */
  async diffNameStatus(repoDir: string, range: string): Promise<string> {
    const result = await this.runner.run('git', ['diff', '--name-status', range], {
      cwd: repoDir,
      timeout: 10_000,
    });
    return result.stdout;
  }

  /** Whether `dir` is inside a git working tree. */
  async isGitRepo(dir: string): Promise<boolean> {
    const cachedAt = this.repoProbeCache.get(dir);
    if (cachedAt !== undefined && Date.now() - cachedAt < REPO_PROBE_TTL_MS) return true;
    if (cachedAt !== undefined) this.repoProbeCache.delete(dir);

    try {
      const result = await this.runner.run('git', ['rev-parse', '--is-inside-work-tree'], {
        cwd: dir,
        timeout: 5_000,
      });
      const isRepo = result.exitCode === 0 && result.stdout.trim() === 'true';
      if (isRepo) this.repoProbeCache.set(dir, Date.now());
      return isRepo;
    } catch {
      return false;
    }
  }

  /**
   * Forget a cached `isGitRepo` answer. Call when a workspace directory is
   * removed, so a later directory reusing that path is probed afresh.
   */
  forgetRepoProbe(dir: string): void {
    this.repoProbeCache.delete(dir);
  }

  /**
   * Initialize an empty git repository at `dir` if it isn't already tracked.
   * Writes a minimal `.gitignore` (if missing) and a placeholder identity.
   * Returns true iff a new repo was created.
   */
  async initIfNeeded(dir: string): Promise<boolean> {
    if (await this.isGitRepo(dir)) return false;
    try {
      await fs.mkdir(dir, { recursive: true });
      const initResult = await this.runner.run('git', ['init', '-q', '-b', 'main'], {
        cwd: dir,
        timeout: 10_000,
      });
      if (initResult.exitCode !== 0) {
        this.logger.warn(`[Git] init failed at ${dir}: ${initResult.stderr}`);
        return false;
      }
      // `git init` just made this a work tree, so the next probe already knows
      // the answer and need not spawn a process to learn it.
      this.repoProbeCache.set(dir, Date.now());

      const gitignorePath = path.join(dir, '.gitignore');
      try {
        await fs.access(gitignorePath);
      } catch {
        const defaultIgnore = [
          '# Auto-generated defaults',
          'node_modules/',
          'dist/',
          'build/',
          'coverage/',
          '.next/',
          '.turbo/',
          '.cache/',
          '.env',
          '.env.local',
          '.env.*.local',
          '*.log',
          '# SQLite WAL sidecars',
          '*.db-shm',
          '*.db-wal',
          '*.db-journal',
          '# OS junk',
          '.DS_Store',
          'Thumbs.db',
          '',
        ].join('\n');
        try {
          await fs.writeFile(gitignorePath, defaultIgnore, 'utf-8');
        } catch {
          /* ignore write errors — we still have a valid repo */
        }
      }

      await this.runner.run('git', ['config', 'user.email', 'agent@generatorai.local'], {
        cwd: dir,
        timeout: 5_000,
      });
      await this.runner.run('git', ['config', 'user.name', 'GeneratorAI Agent'], {
        cwd: dir,
        timeout: 5_000,
      });
      this.logger.info(`[Git] Initialized git repo at ${dir}`);
      return true;
    } catch (err) {
      this.logger.warn(`[Git] initIfNeeded failed at ${dir}: ${err}`);
      return false;
    }
  }

  /**
   * List every file tracked or untracked by git in `dir`, honoring
   * `.gitignore`. Returns paths relative to `dir`. Empty array on failure.
   */
  async lsFiles(dir: string): Promise<string[]> {
    try {
      const result = await this.runner.run(
        'git',
        ['ls-files', '--others', '--cached', '--exclude-standard'],
        { cwd: dir, timeout: 15_000 },
      );
      if (result.exitCode !== 0) return [];
      return result.stdout
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    } catch {
      return [];
    }
  }

  /** Return the current branch name, or null (detached HEAD / no commits). */
  async currentBranch(repoDir: string): Promise<string | null> {
    try {
      const result = await this.runner.run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: repoDir,
        timeout: 5_000,
      });
      if (result.exitCode !== 0) return null;
      const branch = result.stdout.trim();
      return branch && branch !== 'HEAD' ? branch : null;
    } catch {
      return null;
    }
  }

  /** Clean up a cloned/working directory (recursive rm). */
  async cleanup(repoDir: string): Promise<void> {
    try {
      await fs.rm(repoDir, { recursive: true, force: true });
      this.logger.info(`[Git] Cleaned up ${repoDir}`);
    } catch (err) {
      this.logger.warn(`[Git] Failed to clean up ${repoDir}: ${err}`);
    }
  }

  // ══════════════════════════════════════════════════════════════
  // Bare clone + worktree ops
  // ══════════════════════════════════════════════════════════════

  /** Create a bare clone of a remote repository (used as central cache). */
  async bareClone(repoUrl: string, targetDir: string): Promise<string> {
    await fs.mkdir(path.dirname(targetDir), { recursive: true });

    const result = await this.runner.run('git', ['clone', '--bare', repoUrl, targetDir], {
      cwd: path.dirname(targetDir),
      timeout: this.timeout,
    });

    if (result.exitCode !== 0) {
      throw new GitError(`Failed to bare clone ${repoUrl}: ${result.stderr}`);
    }

    this.logger.info(`[Git] Bare cloned ${repoUrl} to ${targetDir}`);
    return targetDir;
  }

  /** Create a git worktree from a bare (or regular) repo. */
  async createWorktree(
    repoPath: string,
    worktreePath: string,
    branchName: string,
    baseBranch?: string,
  ): Promise<string> {
    await fs.mkdir(path.dirname(worktreePath), { recursive: true });

    const args = ['worktree', 'add', worktreePath, '-b', branchName];
    if (baseBranch) args.push(baseBranch);

    const result = await this.runner.run('git', args, {
      cwd: repoPath,
      timeout: this.timeout,
    });

    if (result.exitCode !== 0) {
      throw new GitError(`Failed to create worktree at ${worktreePath}: ${result.stderr}`);
    }

    this.logger.info(`[Git] Created worktree at ${worktreePath} (branch: ${branchName})`);
    return worktreePath;
  }

  /** Remove a git worktree (with manual fallback). */
  async removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
    const result = await this.runner.run(
      'git',
      ['worktree', 'remove', worktreePath, '--force'],
      { cwd: repoPath, timeout: 30_000 },
    );

    if (result.exitCode !== 0) {
      this.logger.warn(`[Git] git worktree remove failed, cleaning up manually: ${result.stderr}`);
      try {
        await fs.rm(worktreePath, { recursive: true, force: true });
        await this.runner.run('git', ['worktree', 'prune'], {
          cwd: repoPath,
          timeout: 10_000,
        });
      } catch (err) {
        this.logger.warn(`[Git] Manual worktree cleanup failed: ${err}`);
      }
      return;
    }

    this.logger.info(`[Git] Removed worktree at ${worktreePath}`);
  }

  /** List worktree paths for a repository. */
  async listWorktrees(repoPath: string): Promise<string[]> {
    const result = await this.runner.run('git', ['worktree', 'list', '--porcelain'], {
      cwd: repoPath,
      timeout: 10_000,
    });
    if (result.exitCode !== 0) return [];

    return result.stdout
      .split('\n')
      .filter((line) => line.startsWith('worktree '))
      .map((line) => line.replace('worktree ', ''));
  }

  /** Fetch all remotes and prune stale tracking branches. */
  async fetchAll(repoPath: string): Promise<void> {
    const result = await this.runner.run('git', ['fetch', '--all', '--prune'], {
      cwd: repoPath,
      timeout: this.timeout,
    });

    if (result.exitCode !== 0) {
      throw new GitError(`Failed to fetch in ${repoPath}: ${result.stderr}`);
    }

    this.logger.info(`[Git] Fetched all remotes in ${repoPath}`);
  }

  /** List all branches (local + remote). */
  async getBranches(repoPath: string): Promise<string[]> {
    const result = await this.runner.run(
      'git',
      ['branch', '-a', '--format=%(refname:short)'],
      { cwd: repoPath, timeout: 10_000 },
    );
    if (result.exitCode !== 0) return [];

    return result.stdout
      .split('\n')
      .map((b) => b.trim())
      .filter(Boolean);
  }

  /** Prune stale worktree references. */
  async pruneWorktrees(repoPath: string): Promise<void> {
    await this.runner.run('git', ['worktree', 'prune'], {
      cwd: repoPath,
      timeout: 10_000,
    });
  }

  /** List files in a git tree via `git ls-tree` (works for bare repos). */
  async lsTree(repoPath: string, subPath = '', ref = 'HEAD'): Promise<GitTreeEntry[]> {
    const treeRef = subPath ? `${ref}:${subPath.replace(/\/$/, '')}` : ref;

    const result = await this.runner.run('git', ['ls-tree', '-l', treeRef], {
      cwd: repoPath,
      timeout: 30_000,
    });

    if (result.exitCode !== 0) {
      throw new GitError(`Failed to list tree at "${subPath || '/'}": ${result.stderr}`);
    }

    return result.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const tabIdx = line.indexOf('\t');
        const meta = line.substring(0, tabIdx).trim();
        const name = line.substring(tabIdx + 1).trim();
        const parts = meta.split(/\s+/);
        const entryType = parts[1] as 'blob' | 'tree';
        const sizeStr = parts[3];
        const size =
          entryType === 'blob' && sizeStr && sizeStr !== '-' ? parseInt(sizeStr, 10) : undefined;
        const filePath = subPath ? `${subPath.replace(/\/$/, '')}/${name}` : name;
        return { type: entryType, name, path: filePath, size };
      });
  }

  /** Get file content via `git show` — works in bare repos. */
  async showFile(repoPath: string, filePath: string, ref = 'HEAD'): Promise<string> {
    const result = await this.runner.run('git', ['show', `${ref}:${filePath}`], {
      cwd: repoPath,
      timeout: 30_000,
    });

    if (result.exitCode !== 0) {
      throw new GitError(`File not found at "${filePath}": ${result.stderr}`);
    }

    return result.stdout;
  }

  /** Return the URL of `remote` (default `origin`), or null when unset. */
  async getRemoteUrl(repoDir: string, remote = 'origin'): Promise<string | null> {
    try {
      const result = await this.runner.run('git', ['remote', 'get-url', remote], {
        cwd: repoDir,
        timeout: 5_000,
      });
      if (result.exitCode !== 0) return null;
      const url = result.stdout.trim();
      return url.length > 0 ? url : null;
    } catch {
      return null;
    }
  }

  /**
   * `-c url.<absolute>.insteadOf=<relative>` for a remote configured as a
   * RELATIVE path, else nothing.
   *
   * Git resolves a relative remote URL against the process's working
   * directory, not against the repository that declared it. In the user's own
   * checkout the two coincide and `../origin.git` works. The app does its work
   * in a linked worktree somewhere else entirely (under its data directory),
   * where the same config line points at a directory that does not exist —
   * every push, fetch and default-branch lookup failed with "'../origin.git'
   * does not appear to be a git repository". The path is resolved against the
   * MAIN worktree, where it was written, and handed to git for this one
   * command; the repository's config is not touched.
   */
  private async remoteUrlArgs(repoDir: string, remote: string): Promise<string[]> {
    const url = await this.getRemoteUrl(repoDir, remote);
    if (!url || !/^\.{1,2}([\\/]|$)/.test(url)) return [];
    try {
      const common = await this.runner.run(
        'git',
        ['rev-parse', '--path-format=absolute', '--git-common-dir'],
        { cwd: repoDir, timeout: 5_000 },
      );
      if (common.exitCode !== 0) return [];
      const commonDir = common.stdout.trim();
      if (!commonDir) return [];
      // `<main>/.git` for an ordinary repository; a bare one IS the base.
      const base = path.basename(commonDir) === '.git' ? path.dirname(commonDir) : commonDir;
      const absolute = path.resolve(base, url);
      if (path.resolve(repoDir, url) === absolute) return []; // already right from here
      // `insteadOf`, not `remote.<name>.url`: that key is multi-valued, so a
      // `-c` value is ADDED to the configured one rather than replacing it, and
      // git still tries the relative path (and pushes to both).
      return ['-c', `url.${absolute}.insteadOf=${url}`];
    } catch {
      return [];
    }
  }

  // ── Private ──

  private extractRepoName(url: string): string {
    const cleaned = url.replace(/\/+$/, '');
    const match = cleaned.match(/\/([^/]+?)(\.git)?$/);
    return match?.[1] ?? 'repo';
  }

  // ══════════════════════════════════════════════════════════════
  // Plumbing — snapshots / checkpoints
  //
  // Everything below writes ONLY loose objects plus refs under a private
  // namespace. The user's index, HEAD, branches and remotes are never
  // touched, so `git status` / `git log` / `git push` stay unaffected.
  // ══════════════════════════════════════════════════════════════

  /** Deterministic identity so `commit-tree` never fails on unset user.name. */
  private snapshotEnv(indexFile?: string): Record<string, string> {
    const env: Record<string, string> = {
      GIT_AUTHOR_NAME: 'GeneratorAI Agent',
      GIT_AUTHOR_EMAIL: 'agent@generatorai.local',
      GIT_COMMITTER_NAME: 'GeneratorAI Agent',
      GIT_COMMITTER_EMAIL: 'agent@generatorai.local',
    };
    if (indexFile) env['GIT_INDEX_FILE'] = indexFile;
    return env;
  }

  /**
   * Config overrides applied to every snapshot/restore command.
   *
   * `core.autocrlf` is commonly `true` on Windows, which would make a
   * snapshot → restore round-trip lossy: `add` normalises CRLF→LF on the way
   * in and `checkout-index` re-expands LF→CRLF on the way out, silently
   * rewriting every line ending in files the agent never touched. Checkpoints
   * are a local undo buffer, not a shared history, so all EOL translation is
   * disabled to guarantee byte-exact restores.
   */
  private static readonly SNAPSHOT_CONFIG = [
    '-c',
    'core.autocrlf=false',
    '-c',
    'core.eol=lf',
    '-c',
    'core.safecrlf=false',
  ];

  private snapshotArgs(args: string[]): string[] {
    return [...GitClient.SNAPSHOT_CONFIG, ...args];
  }

  async absoluteGitDir(repoDir: string): Promise<string | null> {
    try {
      const result = await this.runner.run('git', ['rev-parse', '--absolute-git-dir'], {
        cwd: repoDir,
        timeout: 5_000,
      });
      if (result.exitCode !== 0) return null;
      const dir = result.stdout.trim();
      return dir.length > 0 ? dir : null;
    } catch {
      return null;
    }
  }

  /** Tail of the work queued against each throwaway index file. */
  private readonly indexQueues = new Map<string, Promise<unknown>>();

  /**
   * One snapshot at a time PER INDEX FILE.
   *
   * `git add` and `git write-tree` take `<index>.lock`. Checkpoints, the
   * Changes summary and the live capture all snapshot the same working tree
   * through the same throwaway index, from independent timers and requests —
   * and whenever two overlapped, the loser died with "Unable to create
   * '…/index.lock': File exists" and returned `null`. Its caller read that as
   * "no tree": the Changes tab fell to "0 changes" in the middle of a turn and
   * stayed there until something refetched. Queued, the second simply waits a
   * few milliseconds for the first.
   */
  async writeTreeFromWorktree(repoDir: string, indexFile: string, opts?: WriteTreeOptions): Promise<string | null> {
    const previous = this.indexQueues.get(indexFile) ?? Promise.resolve();
    const run = previous.then(
      () => this.writeTreeFromWorktreeNow(repoDir, indexFile, opts),
      () => this.writeTreeFromWorktreeNow(repoDir, indexFile, opts),
    );
    const tail = run.catch(() => undefined);
    this.indexQueues.set(indexFile, tail);
    void tail.then(() => {
      if (this.indexQueues.get(indexFile) === tail) this.indexQueues.delete(indexFile);
    });
    return run;
  }

  private async writeTreeFromWorktreeNow(repoDir: string, indexFile: string, opts?: WriteTreeOptions): Promise<string | null> {
    try {
      await fs.mkdir(path.dirname(indexFile), { recursive: true });

      // `add -A` against the throwaway index picks up creations, edits and
      // deletions while still honouring .gitignore. With `honourEol` the
      // repo's own autocrlf applies, so the tree is comparable to a commit.
      const addArgs = ['add', '-A', '--', '.'];
      const add = await this.runner.run('git', opts?.honourEol ? addArgs : this.snapshotArgs(addArgs), {
        cwd: repoDir,
        timeout: 120_000,
        env: this.snapshotEnv(indexFile),
      });
      if (add.exitCode !== 0) {
        this.logger.warn(`[Git] snapshot add failed in ${repoDir}: ${add.stderr}`);
        return null;
      }

      const write = await this.runner.run('git', this.snapshotArgs(['write-tree']), {
        cwd: repoDir,
        timeout: 60_000,
        env: this.snapshotEnv(indexFile),
      });
      if (write.exitCode !== 0) {
        this.logger.warn(`[Git] write-tree failed in ${repoDir}: ${write.stderr}`);
        return null;
      }

      const sha = write.stdout.trim();
      return sha.length > 0 ? sha : null;
    } catch (err) {
      this.logger.warn(`[Git] writeTreeFromWorktree failed in ${repoDir}: ${err}`);
      return null;
    }
  }

  async commitTree(
    repoDir: string,
    treeSha: string,
    message: string,
    parentSha?: string,
  ): Promise<string> {
    const args = ['commit-tree', treeSha, '-m', message];
    if (parentSha) args.push('-p', parentSha);

    const result = await this.runner.run('git', args, {
      cwd: repoDir,
      timeout: 15_000,
      env: this.snapshotEnv(),
    });
    if (result.exitCode !== 0) {
      throw new GitError(`Failed to create commit object: ${result.stderr}`);
    }
    const sha = result.stdout.trim();
    if (!sha) throw new GitError('commit-tree returned an empty SHA');
    return sha;
  }

  async updateRef(repoDir: string, ref: string, sha: string): Promise<void> {
    const result = await this.runner.run('git', ['update-ref', ref, sha], {
      cwd: repoDir,
      timeout: 10_000,
    });
    if (result.exitCode !== 0) {
      throw new GitError(`Failed to update ref ${ref}: ${result.stderr}`);
    }
  }

  async deleteRef(repoDir: string, ref: string): Promise<void> {
    await this.runner.run('git', ['update-ref', '-d', ref], {
      cwd: repoDir,
      timeout: 10_000,
    });
  }

  async listRefs(repoDir: string, prefix: string): Promise<GitRef[]> {
    try {
      const result = await this.runner.run(
        'git',
        ['for-each-ref', '--format=%(refname) %(objectname)', prefix],
        { cwd: repoDir, timeout: 10_000 },
      );
      if (result.exitCode !== 0) return [];
      return result.stdout
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((line) => {
          const idx = line.lastIndexOf(' ');
          return { ref: line.slice(0, idx), sha: line.slice(idx + 1) };
        })
        .filter((r) => r.ref.length > 0 && r.sha.length > 0);
    } catch {
      return [];
    }
  }

  async revParse(repoDir: string, rev: string): Promise<string | null> {
    try {
      const result = await this.runner.run('git', ['rev-parse', '--verify', '--quiet', rev], {
        cwd: repoDir,
        timeout: 5_000,
      });
      if (result.exitCode !== 0) return null;
      const sha = result.stdout.trim();
      return sha.length > 0 ? sha : null;
    } catch {
      return null;
    }
  }

  async objectExists(repoDir: string, sha: string): Promise<boolean> {
    try {
      const result = await this.runner.run('git', ['cat-file', '-e', `${sha}^{object}`], {
        cwd: repoDir,
        timeout: 5_000,
      });
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  async diffNumstat(
    repoDir: string,
    from: string,
    to?: string,
    pathspec?: string[],
  ): Promise<GitNumstatEntry[]> {
    const args = ['diff', '--numstat', '-z', '--find-renames=50%', from];
    if (to) args.push(to);
    if (pathspec?.length) args.push('--', ...pathspec);

    const result = await this.runner.run('git', this.snapshotArgs(args), {
      cwd: repoDir,
      timeout: 60_000,
    });
    if (result.exitCode !== 0) return [];

    // -z format: "<add>\t<del>\t<path>\0" or, for renames,
    // "<add>\t<del>\t\0<oldPath>\0<newPath>\0"
    const fields = result.stdout.split('\0');
    const out: GitNumstatEntry[] = [];
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      if (!field) continue;
      const parts = field.split('\t');
      if (parts.length < 3) continue;
      const additions = parts[0] === '-' ? -1 : parseInt(parts[0] ?? '0', 10) || 0;
      const deletions = parts[1] === '-' ? -1 : parseInt(parts[1] ?? '0', 10) || 0;
      const inline = parts[2] ?? '';
      if (inline === '') {
        const oldPath = fields[++i] ?? '';
        const newPath = fields[++i] ?? '';
        if (!newPath) continue;
        out.push({ additions, deletions, path: newPath, oldPath });
      } else {
        out.push({ additions, deletions, path: inline });
      }
    }
    return out;
  }

  async diffNameStatusZ(
    repoDir: string,
    from: string,
    to?: string,
    pathspec?: string[],
  ): Promise<GitNameStatusEntry[]> {
    const args = ['diff', '--name-status', '-z', '--find-renames=50%', from];
    if (to) args.push(to);
    if (pathspec?.length) args.push('--', ...pathspec);

    const result = await this.runner.run('git', this.snapshotArgs(args), {
      cwd: repoDir,
      timeout: 60_000,
    });
    if (result.exitCode !== 0) return [];

    // -z format: "<code>\0<path>\0" or "<R###>\0<oldPath>\0<newPath>\0"
    const fields = result.stdout.split('\0').filter((f) => f.length > 0);
    const out: GitNameStatusEntry[] = [];
    for (let i = 0; i < fields.length; i++) {
      const code = fields[i] ?? '';
      if (!code) continue;
      if (code.startsWith('R') || code.startsWith('C')) {
        const oldPath = fields[++i] ?? '';
        const newPath = fields[++i] ?? '';
        if (!newPath) continue;
        out.push({ code, path: newPath, oldPath });
      } else {
        const p = fields[++i] ?? '';
        if (!p) continue;
        out.push({ code, path: p });
      }
    }
    return out;
  }

  /**
   * `git diff --raw` gives status AND both blob SHAs per file in a single
   * command. Using it instead of per-file `blobShaAt`/`blobSize` turns a
   * change summary from O(2n) subprocesses into a constant handful — the
   * difference between "instant" and "seconds" on a large change set.
   *
   * -z format: "<meta>\0<path>\0" or, for renames/copies,
   * "<meta>\0<oldPath>\0<newPath>\0", where meta is
   * ":<oldMode> <newMode> <oldSha> <newSha> <status>".
   */
  async diffRaw(
    repoDir: string,
    from: string,
    to?: string,
    pathspec?: string[],
  ): Promise<GitRawDiffEntry[]> {
    const args = ['diff', '--raw', '-z', '--find-renames=50%', '--abbrev=40', from];
    if (to) args.push(to);
    if (pathspec?.length) args.push('--', ...pathspec);

    const result = await this.runner.run('git', this.snapshotArgs(args), {
      cwd: repoDir,
      timeout: 60_000,
    });
    if (result.exitCode !== 0) return [];

    const fields = result.stdout.split('\0').filter((f) => f.length > 0);
    const out: GitRawDiffEntry[] = [];
    for (let i = 0; i < fields.length; i++) {
      const meta = fields[i];
      if (!meta || !meta.startsWith(':')) continue;
      const parts = meta.slice(1).trim().split(/\s+/);
      // [oldMode, newMode, oldSha, newSha, status]
      if (parts.length < 5) continue;
      const oldSha = normalizeSha(parts[2]);
      const newSha = normalizeSha(parts[3]);
      const code = parts[4] ?? 'M';

      if (code.startsWith('R') || code.startsWith('C')) {
        const oldPath = fields[++i] ?? '';
        const newPath = fields[++i] ?? '';
        if (!newPath) continue;
        out.push({
          code,
          path: newPath,
          oldPath,
          ...(oldSha ? { oldSha } : {}),
          ...(newSha ? { newSha } : {}),
        });
      } else {
        const p = fields[++i] ?? '';
        if (!p) continue;
        out.push({
          code,
          path: p,
          ...(oldSha ? { oldSha } : {}),
          ...(newSha ? { newSha } : {}),
        });
      }
    }
    return out;
  }

  /** All blobs in a tree with SHA + size, in one command. */
  async lsTreeBlobs(repoDir: string, treeish: string): Promise<GitBlobEntry[]> {
    const result = await this.runner.run(
      'git',
      this.snapshotArgs(['ls-tree', '-r', '--long', '-z', treeish]),
      { cwd: repoDir, timeout: 60_000 },
    );
    if (result.exitCode !== 0) return [];

    const out: GitBlobEntry[] = [];
    for (const record of result.stdout.split('\0')) {
      if (!record) continue;
      const tab = record.indexOf('\t');
      if (tab === -1) continue;
      const meta = record.slice(0, tab).trim().split(/\s+/);
      // [mode, type, sha, size]
      if (meta.length < 4 || meta[1] !== 'blob') continue;
      const size = parseInt(meta[3] ?? '0', 10);
      out.push({
        path: record.slice(tab + 1),
        sha: meta[2] ?? '',
        size: Number.isFinite(size) ? size : 0,
      });
    }
    return out;
  }

  async diffPatch(
    repoDir: string,
    from: string,
    to?: string,
    filePath?: string | readonly string[],
    contextLines = 3,
  ): Promise<string> {
    const args = ['diff', `--unified=${contextLines}`, '--find-renames=50%', '--no-color', from];
    if (to) args.push(to);
    // A rename must carry both halves of the pathspec — git filters paths
    // before it detects renames, so the old path is invisible otherwise and
    // the file reads as a pure addition.
    const paths = (typeof filePath === 'string' ? [filePath] : (filePath ?? [])).filter(Boolean);
    if (paths.length > 0) args.push('--', ...paths);

    const result = await this.runner.run('git', this.snapshotArgs(args), {
      cwd: repoDir,
      timeout: 60_000,
    });
    return result.exitCode === 0 ? result.stdout : '';
  }

  async blobSize(repoDir: string, sha: string): Promise<number | null> {
    try {
      const result = await this.runner.run('git', ['cat-file', '-s', sha], {
        cwd: repoDir,
        timeout: 5_000,
      });
      if (result.exitCode !== 0) return null;
      const n = parseInt(result.stdout.trim(), 10);
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }

  async blobShaAt(repoDir: string, treeish: string, filePath: string): Promise<string | null> {
    return this.revParse(repoDir, `${treeish}:${filePath}`);
  }

  /**
   * Read a blob by its object id.
   *
   * The point is the spawn count. Reading a file through a tree path costs
   * three subprocesses — resolve the path to a sha, ask for its size, then
   * ask for its content — and on Windows a git spawn is ~300ms, so a
   * two-sided diff spends most of a second on process startup alone. When the
   * caller already knows the sha (the change summary reports both sides'
   * blobs) this collapses that side into one invocation.
   *
   * Returns null when the object is absent, which is expected rather than
   * exceptional: blobs written into a throwaway index are unreferenced, so
   * `git gc` may eventually prune them. Callers fall back to the slow path.
   */
  async readBlobById(repoDir: string, sha: string): Promise<string | null> {
    // Guard the argument: a sha reaches here from a client-supplied cache
    // key, and anything other than a plain object id could be interpreted as
    // a revision expression or an option.
    if (!/^[0-9a-f]{40}$/i.test(sha)) return null;
    try {
      const result = await this.runner.run('git', ['cat-file', 'blob', sha], {
        cwd: repoDir,
        timeout: 30_000,
      });
      if (result.exitCode !== 0) return null;
      return result.stdout;
    } catch {
      return null;
    }
  }

  async restorePathsFromTree(
    repoDir: string,
    treeish: string,
    indexFile: string,
    paths: string[],
  ): Promise<void> {
    if (paths.length === 0) return;
    await fs.mkdir(path.dirname(indexFile), { recursive: true });

    const env = this.snapshotEnv(indexFile);
    const read = await this.runner.run('git', this.snapshotArgs(['read-tree', treeish]), {
      cwd: repoDir,
      timeout: 60_000,
      env,
    });
    if (read.exitCode !== 0) {
      throw new GitError(`Failed to read tree ${treeish}: ${read.stderr}`);
    }

    // Chunked to stay well below ARG_MAX / Windows command-line limits.
    const CHUNK = 100;
    for (let i = 0; i < paths.length; i += CHUNK) {
      const chunk = paths.slice(i, i + CHUNK);
      const result = await this.runner.run(
        'git',
        this.snapshotArgs(['checkout-index', '-f', '--', ...chunk]),
        { cwd: repoDir, timeout: 60_000, env },
      );
      if (result.exitCode !== 0) {
        this.logger.warn(`[Git] checkout-index partial failure: ${result.stderr}`);
      }
    }
  }

  // ══════════════════════════════════════════════════════════════
  // Source control — remote sync, merge, review
  // ══════════════════════════════════════════════════════════════

  async fetch(repoDir: string, remote = 'origin', ref?: string): Promise<void> {
    const args = [...(await this.remoteUrlArgs(repoDir, remote)), 'fetch', remote];
    if (ref) args.push(ref);

    const result = await this.runner.run('git', args, {
      cwd: repoDir,
      timeout: this.timeout,
    });
    if (result.exitCode !== 0) {
      throw new GitError(`Failed to fetch ${remote}${ref ? ` ${ref}` : ''} in ${repoDir}: ${result.stderr}`);
    }
  }

  async defaultBranch(repoDir: string, remote = 'origin'): Promise<string | null> {
    const key = `${repoDir}\0${remote}`;
    const cached = this.defaultBranchCache.get(key);
    if (cached && Date.now() - cached.at < DEFAULT_BRANCH_TTL_MS) return cached.value;

    const value = await this.resolveDefaultBranch(repoDir, remote);
    this.defaultBranchCache.set(key, { value, at: Date.now() });
    return value;
  }

  /** The three probes behind `defaultBranch`, cheapest (and most local) first. */
  private async resolveDefaultBranch(repoDir: string, remote: string): Promise<string | null> {
    // 1. The local symbolic ref written by `clone` / `remote set-head`.
    try {
      const symbolic = await this.runner.run(
        'git',
        ['symbolic-ref', '--short', `refs/remotes/${remote}/HEAD`],
        { cwd: repoDir, timeout: 5_000 },
      );
      if (symbolic.exitCode === 0) {
        const short = symbolic.stdout.trim();
        // `origin/main` → `main`. A bare `main` (no prefix) is already right.
        const prefix = `${remote}/`;
        const branch = short.startsWith(prefix) ? short.slice(prefix.length) : short;
        if (branch) return branch;
      }
    } catch {
      /* fall through */
    }

    // 2. `remote show` — resolves the head even when the symbolic ref is
    //    missing, but contacts the remote.
    try {
      const show = await this.runner.run('git', [...(await this.remoteUrlArgs(repoDir, remote)), 'remote', 'show', remote], {
        cwd: repoDir,
        timeout: 30_000,
      });
      if (show.exitCode === 0) {
        const match = show.stdout.match(/^\s*HEAD branch:\s*(.+)$/m);
        const branch = match?.[1]?.trim();
        // git prints `(unknown)` for a remote whose HEAD it could not read.
        if (branch && branch !== '(unknown)') return branch;
      }
    } catch {
      /* fall through */
    }

    // 3. Ask the remote directly for its symref.
    try {
      const lsRemote = await this.runner.run('git', [...(await this.remoteUrlArgs(repoDir, remote)), 'ls-remote', '--symref', remote, 'HEAD'], {
        cwd: repoDir,
        timeout: 30_000,
      });
      if (lsRemote.exitCode === 0) {
        const match = lsRemote.stdout.match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD$/m);
        const branch = match?.[1]?.trim();
        if (branch) return branch;
      }
    } catch {
      /* give up */
    }

    return null;
  }

  async aheadBehind(repoDir: string, ref: string, upstream: string): Promise<GitAheadBehind | null> {
    try {
      const result = await this.runner.run(
        'git',
        ['rev-list', '--left-right', '--count', `${upstream}...${ref}`],
        { cwd: repoDir, timeout: 30_000 },
      );
      if (result.exitCode !== 0) return null;
      // "<left>\t<right>": left is reachable from upstream only (behind),
      // right from ref only (ahead).
      const parts = result.stdout.trim().split(/\s+/);
      if (parts.length < 2) return null;
      const behind = Number.parseInt(parts[0] ?? '', 10);
      const ahead = Number.parseInt(parts[1] ?? '', 10);
      if (!Number.isFinite(behind) || !Number.isFinite(ahead)) return null;
      return { ahead, behind };
    } catch {
      return null;
    }
  }

  async upstreamOf(repoDir: string, branch: string): Promise<string | null> {
    try {
      const result = await this.runner.run(
        'git',
        ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`],
        { cwd: repoDir, timeout: 5_000 },
      );
      if (result.exitCode !== 0) return null;
      const upstream = result.stdout.trim();
      return upstream.length > 0 ? upstream : null;
    } catch {
      return null;
    }
  }

  async isDetached(repoDir: string): Promise<boolean> {
    try {
      const result = await this.runner.run('git', ['rev-parse', '--symbolic-full-name', 'HEAD'], {
        cwd: repoDir,
        timeout: 5_000,
      });
      if (result.exitCode !== 0) return false;
      return result.stdout.trim() === 'HEAD';
    } catch {
      return false;
    }
  }

  async mergeInProgress(repoDir: string): Promise<boolean> {
    const gitDir = (await this.absoluteGitDir(repoDir)) ?? path.join(repoDir, '.git');
    return fs
      .access(path.join(gitDir, 'MERGE_HEAD'))
      .then(() => true)
      .catch(() => false);
  }

  async unmergedFiles(repoDir: string): Promise<string[]> {
    try {
      const result = await this.runner.run('git', ['diff', '--name-only', '--diff-filter=U'], {
        cwd: repoDir,
        timeout: 30_000,
      });
      if (result.exitCode !== 0) return [];
      return result.stdout
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    } catch {
      return [];
    }
  }

  /**
   * Ask git whether a merge would conflict without performing it.
   *
   * `merge-tree --write-tree` runs the whole merge in the object store, so the
   * working tree, index and HEAD are all untouched — which is what makes a
   * "would this conflict?" badge safe to render next to a branch the user has
   * uncommitted work in. It needs git >= 2.38; older git exits 129 on the
   * unknown flag, and that is reported as `supported: false` so callers fall
   * back to a real `--no-commit` merge rather than mistaking an empty list for
   * a clean result.
   */
  async mergeTrees(repoDir: string, base: string, ours: string, theirs: string): Promise<{ supported: boolean; tree: string | null; conflicts: string[] }> {
    let result;
    try {
      result = await this.runner.run('git', ['merge-tree', '--write-tree', '--name-only', `--merge-base=${base}`, ours, theirs], {
        cwd: repoDir,
        timeout: 120_000,
        env: this.snapshotEnv(),
      });
    } catch {
      return { supported: false, tree: null, conflicts: [] };
    }
    const lines = result.stdout.split('\n').map((l) => l.replace(/\r$/, ''));
    const tree = lines[0]?.trim() || null;
    if (result.exitCode === 0) return { supported: !!tree, tree, conflicts: [] };
    if (result.exitCode !== 1) return { supported: false, tree: null, conflicts: [] };
    const conflicts: string[] = [];
    for (const line of lines.slice(1)) {
      if (line.trim().length === 0) break; // the informational messages follow a blank line
      if (!conflicts.includes(line)) conflicts.push(line);
    }
    return { supported: true, tree: null, conflicts };
  }

  async checkoutTree(repoDir: string, fromTree: string, toTree: string, indexFile: string): Promise<void> {
    await fs.mkdir(path.dirname(indexFile), { recursive: true });
    const env = this.snapshotEnv(indexFile);
    const read = await this.runner.run('git', ['read-tree', fromTree], { cwd: repoDir, timeout: 60_000, env });
    if (read.exitCode !== 0) throw new GitError(`Failed to read tree ${fromTree}: ${read.stderr}`);
    // Stat data for the fresh index, so the two-way merge sees the files as up to date.
    await this.runner.run('git', ['update-index', '-q', '--refresh'], { cwd: repoDir, timeout: 120_000, env });
    const move = await this.runner.run('git', ['read-tree', '-m', '-u', fromTree, toTree], { cwd: repoDir, timeout: 120_000, env });
    if (move.exitCode !== 0) throw new GitError(`Failed to move ${repoDir} to tree ${toTree}: ${move.stderr || move.stdout}`);
  }

  async mergeTreeConflicts(repoDir: string, ours: string, theirs: string): Promise<GitMergeTreeResult> {
    let result;
    try {
      result = await this.runner.run(
        'git',
        ['merge-tree', '--write-tree', '--name-only', ours, theirs],
        { cwd: repoDir, timeout: 60_000 },
      );
    } catch {
      return { supported: false, conflicts: [] };
    }

    if (result.exitCode === 0) return { supported: true, conflicts: [] };
    if (result.exitCode !== 1) return { supported: false, conflicts: [] };

    // stdout is "<tree oid>\n<conflicted path>\n…" optionally followed by a
    // blank line and an informational messages section.
    const lines = result.stdout.split('\n').map((l) => l.replace(/\r$/, ''));
    const conflicts: string[] = [];
    const seen = new Set<string>();
    for (const line of lines.slice(1)) {
      if (line.trim().length === 0) break; // messages section starts here
      if (seen.has(line)) continue;
      seen.add(line);
      conflicts.push(line);
    }
    return { supported: true, conflicts };
  }

  async merge(repoDir: string, ref: string, opts: MergeOptions = {}): Promise<GitMergeResult> {
    const args = ['merge'];
    if (opts.noCommit) {
      // --no-ff as well, or a fast-forwardable merge would silently move HEAD
      // and leave nothing for the caller to inspect or abort.
      args.push('--no-commit', '--no-ff');
    } else if (opts.message) {
      args.push('-m', opts.message);
    }
    args.push(ref);

    const result = await this.runner.run('git', args, { cwd: repoDir, timeout: this.timeout });
    if (result.exitCode === 0) return { ok: true, conflicts: [] };

    const conflicts = await this.unmergedFiles(repoDir);
    if (conflicts.length > 0) {
      // A conflicted merge is an expected outcome, not an error: the caller
      // resolves the files and calls `commitMerge`, or `mergeAbort`s.
      this.logger.info(`[Git] Merge of ${ref} left ${conflicts.length} conflicted file(s) in ${repoDir}`);
      return { ok: false, conflicts };
    }
    throw new GitError(`Failed to merge ${ref} in ${repoDir}: ${result.stderr || result.stdout}`);
  }

  async mergeAbort(repoDir: string): Promise<void> {
    // Exit code is deliberately ignored: "there is nothing to abort" is the
    // common case for a caller cleaning up defensively.
    await this.runner
      .run('git', ['merge', '--abort'], { cwd: repoDir, timeout: 30_000 })
      .catch(() => undefined);
  }

  async commitMerge(repoDir: string, message: string): Promise<string> {
    const unmerged = await this.unmergedFiles(repoDir);
    if (unmerged.length > 0) {
      throw new GitError(
        `Cannot commit merge in ${repoDir}: ${unmerged.length} unresolved conflict(s): ${unmerged.join(', ')}`,
      );
    }

    await this.addAll(repoDir);

    // `--allow-empty` because a merge whose result equals HEAD is still a
    // legitimate merge commit — it records the second parent.
    const commit = await this.runner.run(
      'git',
      ['commit', '-F', '-', '--allow-empty-message', '--allow-empty'],
      { cwd: repoDir, timeout: 30_000, stdin: message },
    );
    if (commit.exitCode !== 0) {
      throw new GitError(`Failed to commit merge in ${repoDir}: ${commit.stderr || commit.stdout}`);
    }

    const sha = await this.revParse(repoDir, 'HEAD');
    if (!sha) throw new GitError(`Merge committed in ${repoDir} but HEAD could not be resolved`);
    return sha;
  }

  async addAll(repoDir: string): Promise<void> {
    const result = await this.runner.run('git', ['add', '-A'], { cwd: repoDir, timeout: 60_000 });
    if (result.exitCode !== 0) {
      throw new GitError(`Failed to stage files in ${repoDir}: ${result.stderr}`);
    }
  }

  async commitWithSha(repoDir: string, message: string): Promise<GitCommitResult | null> {
    await this.addAll(repoDir);

    const staged = await this.runner.run('git', ['diff', '--cached', '--quiet'], {
      cwd: repoDir,
      timeout: 10_000,
    });
    if (staged.exitCode === 0) {
      this.logger.info('[Git] No changes to commit');
      return null;
    }

    const commit = await this.runner.run('git', ['commit', '-F', '-', '--allow-empty-message'], {
      cwd: repoDir,
      timeout: 30_000,
      stdin: message,
    });
    if (commit.exitCode !== 0) {
      throw new GitError(`Failed to commit in ${repoDir}: ${commit.stderr || commit.stdout}`);
    }

    const sha = await this.revParse(repoDir, 'HEAD');
    if (!sha) throw new GitError(`Committed in ${repoDir} but HEAD could not be resolved`);
    return { sha, message };
  }

  async pushSetUpstream(repoDir: string, remote: string, branch: string): Promise<void> {
    const result = await this.runner.run('git', [...(await this.remoteUrlArgs(repoDir, remote)), 'push', '-u', remote, branch], {
      cwd: repoDir,
      timeout: this.timeout,
    });
    if (result.exitCode !== 0) {
      throw new GitError(`Failed to push ${branch} to ${remote}: ${result.stderr}`);
    }
    this.logger.info(`[Git] Pushed ${branch} to ${remote} (upstream set)`);
  }

  async log(repoDir: string, range: string, max = 100): Promise<string[]> {
    try {
      const result = await this.runner.run(
        'git',
        ['log', '--no-merges', '--pretty=format:%s', '-n', String(max), range],
        { cwd: repoDir, timeout: 30_000 },
      );
      if (result.exitCode !== 0) return [];
      return result.stdout
        .split('\n')
        .map((l) => l.replace(/\r$/, '').trim())
        .filter((l) => l.length > 0);
    } catch {
      return [];
    }
  }

  /**
   * Everything that differs from HEAD in the working copy — staged, unstaged
   * and untracked — in ONE git invocation.
   *
   * `status --porcelain=v1 -z` is used rather than `diff --name-status HEAD`
   * plus a second `ls-files --others` pass, because status already reports
   * untracked files and both sides of a rename. Untracked entries are mapped
   * to `A`: to a reviewer a brand new file is an addition, whether or not the
   * index knows about it yet.
   */
  async changedFilesSummary(repoDir: string): Promise<GitNameStatusEntry[]> {
    let result;
    try {
      result = await this.runner.run('git', ['status', '--porcelain=v1', '-uall', '-z'], {
        cwd: repoDir,
        timeout: 30_000,
      });
    } catch {
      return [];
    }
    if (result.exitCode !== 0) return [];

    // -z record: "XY <path>\0", and for renames/copies "XY <newPath>\0<oldPath>\0".
    const fields = result.stdout.split('\0');
    const out: GitNameStatusEntry[] = [];
    for (let i = 0; i < fields.length; i++) {
      const record = fields[i];
      if (!record || record.length < 4) continue;
      const index = record[0] ?? ' ';
      const worktree = record[1] ?? ' ';
      const filePath = record.slice(3);
      if (!filePath) continue;

      if (index === '?' || worktree === '?') {
        out.push({ code: 'A', path: filePath });
        continue;
      }

      // Prefer the index letter; fall back to the worktree letter when the
      // change is unstaged (" M", " D", …).
      const code = index !== ' ' ? index : worktree;
      if (code === ' ') continue;

      if (code === 'R' || code === 'C') {
        const oldPath = fields[++i] ?? '';
        out.push(oldPath ? { code, path: filePath, oldPath } : { code, path: filePath });
        continue;
      }
      out.push({ code, path: filePath });
    }
    return out;
  }

  async gitVersion(): Promise<string | null> {
    if (this.gitVersionCache) return this.gitVersionCache.value;

    let value: string | null = null;
    try {
      const result = await this.runner.run('git', ['--version'], {
        cwd: process.cwd(),
        timeout: 10_000,
      });
      if (result.exitCode === 0) {
        // "git version 2.45.1" / "git version 2.39.3 (Apple Git-146)"
        const match = result.stdout.match(/(\d+(?:\.\d+)*)/);
        value = match?.[1] ?? null;
      }
    } catch {
      value = null;
    }
    this.gitVersionCache = { value };
    return value;
  }
}
