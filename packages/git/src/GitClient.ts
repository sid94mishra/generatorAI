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
  GitBlobEntry,
  GitClientOptions,
  GitNameStatusEntry,
  GitNumstatEntry,
  GitRawDiffEntry,
  GitRef,
  GitTreeEntry,
  IGitClient,
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
    args.push(repoUrl, targetDir);

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
    const args = ['pull', 'origin'];
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

    result = await this.runner.run('git', ['commit', '-m', message, '--allow-empty-message'], {
      cwd: repoDir,
      timeout: 30_000,
    });
    if (result.exitCode !== 0) {
      throw new GitError(`Failed to commit: ${result.stderr}`);
    }

    this.logger.info(`[Git] Committed: "${message}"`);
    return true;
  }

  /** Push to origin (optionally a specific branch). */
  async push(repoDir: string, branch?: string): Promise<void> {
    const pushArgs = ['push', 'origin'];
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

  async writeTreeFromWorktree(repoDir: string, indexFile: string, opts?: WriteTreeOptions): Promise<string | null> {
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
    filePath?: string,
    contextLines = 3,
  ): Promise<string> {
    const args = ['diff', `--unified=${contextLines}`, '--find-renames=50%', '--no-color', from];
    if (to) args.push(to);
    if (filePath) args.push('--', filePath);

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
}
