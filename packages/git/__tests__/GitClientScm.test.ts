// ────────────────────────────────────────────────────────────────
// GitClient source-control ops — fetch / default branch / merge / review
// ────────────────────────────────────────────────────────────────
//
// Exercised against real temp git repos, like GitClient.test.ts. The one
// exception is the `merge-tree --write-tree` output parser, which is also
// driven through a stub runner: the flag needs git >= 2.38, and a machine
// with older git would otherwise never execute the parsing branch at all.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GitClient } from '../src/GitClient.js';
import type {
  IGitProcessRunner,
  GitProcessRunOptions,
  GitProcessRunResult,
} from '../src/ports/IGitProcessRunner.js';
import type { ILogger } from '@generatorai/shared';
import { GitError } from '@generatorai/shared';

const execFileAsync = promisify(execFile);

class NodeGitRunner implements IGitProcessRunner {
  async run(
    command: string,
    args: string[],
    options: GitProcessRunOptions,
  ): Promise<GitProcessRunResult> {
    const start = Date.now();
    try {
      const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        const child = execFile(
          command,
          args,
          {
            cwd: options.cwd,
            timeout: options.timeout ?? 30_000,
            env: options.env ? { ...process.env, ...options.env } : process.env,
            maxBuffer: 32 * 1024 * 1024,
          },
          (error, out, errOut) => (error ? reject(Object.assign(error, { stdout: out, stderr: errOut })) : resolve({ stdout: out, stderr: errOut })),
        );
        // `git commit -F -` reads the message from stdin; close it either way.
        child.stdin?.end(options.stdin ?? '');
      });
      return { exitCode: 0, stdout, stderr, durationMs: Date.now() - start };
    } catch (err: unknown) {
      const e = err as { code?: number; stdout?: string; stderr?: string; message?: string };
      return {
        exitCode: typeof e.code === 'number' ? e.code : 1,
        stdout: e.stdout ?? '',
        stderr: e.stderr ?? e.message ?? '',
        durationMs: Date.now() - start,
      };
    }
  }
}

/** Counts what actually reached git, so caching is observable. */
class CountingRunner implements IGitProcessRunner {
  readonly calls: string[] = [];
  constructor(private readonly inner: IGitProcessRunner) {}
  async run(
    command: string,
    args: string[],
    options: GitProcessRunOptions,
  ): Promise<GitProcessRunResult> {
    this.calls.push(args.join(' '));
    return this.inner.run(command, args, options);
  }
}

const silentLogger: ILogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};

function makeClient(workspacesDir: string, runner: IGitProcessRunner = new NodeGitRunner()): GitClient {
  return new GitClient(runner, silentLogger, { workspacesDir, defaultTimeoutMs: 60_000 });
}

async function writeFile(dir: string, rel: string, content: string): Promise<void> {
  const full = path.join(dir, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf-8');
}

/** Raw git, for setup steps GitClient deliberately does not expose. */
async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    'git',
    ['-c', 'user.email=test@generatorai.local', '-c', 'user.name=Test', ...args],
    { cwd, maxBuffer: 32 * 1024 * 1024 },
  );
  return stdout;
}

// Windows keeps brief file locks on git pack/index files after a process
// exits, so a single rm can throw EBUSY. Retry with backoff before giving up.
async function removeDirWithRetry(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    }
  }
}

let tmpRoot: string;
let git: GitClient;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gitscm-'));
  git = makeClient(path.join(tmpRoot, 'workspaces'));
});

afterEach(async () => {
  await removeDirWithRetry(tmpRoot);
});

/**
 * A repo on `main` with `conflict.txt` committed, plus a `feature` branch that
 * rewrites the same line — so merging feature into main always conflicts.
 * `initIfNeeded` pins the initial branch to `main` and writes the identity, so
 * this is stable regardless of the machine's `init.defaultBranch`.
 */
async function makeConflictingRepo(name = 'proj'): Promise<string> {
  const dir = path.join(tmpRoot, name);
  await fs.mkdir(dir, { recursive: true });
  await git.initIfNeeded(dir);
  await writeFile(dir, 'conflict.txt', 'base\n');
  await writeFile(dir, 'stable.txt', 'untouched\n');
  await git.commit(dir, 'base');

  await git.createBranch(dir, 'feature');
  await git.checkoutBranch(dir, 'feature');
  await writeFile(dir, 'conflict.txt', 'from feature\n');
  await git.commit(dir, 'feature edit');

  await git.checkoutBranch(dir, 'main');
  await writeFile(dir, 'conflict.txt', 'from main\n');
  await git.commit(dir, 'main edit');
  return dir;
}

describe('GitClient.mergeTreeConflicts', () => {
  it('detects a conflicting merge without touching the working tree', async () => {
    const dir = await makeConflictingRepo();

    const result = await git.mergeTreeConflicts(dir, 'main', 'feature');

    if (result.supported) {
      expect(result.conflicts).toContain('conflict.txt');
    } else {
      // git < 2.38 has no `--write-tree`; callers must fall back to `merge`.
      expect(result.conflicts).toEqual([]);
    }

    // Whatever the answer, the probe must be side-effect free.
    expect(await fs.readFile(path.join(dir, 'conflict.txt'), 'utf-8')).toBe('from main\n');
    expect(await git.isClean(dir)).toBe(true);
    expect(await git.mergeInProgress(dir)).toBe(false);
    expect(await git.unmergedFiles(dir)).toEqual([]);
    expect(await git.currentBranch(dir)).toBe('main');
  });

  it('reports no conflicts for a mergeable branch', async () => {
    const dir = path.join(tmpRoot, 'clean');
    await fs.mkdir(dir, { recursive: true });
    await git.initIfNeeded(dir);
    await writeFile(dir, 'a.txt', 'alpha\n');
    await git.commit(dir, 'base');

    await git.createBranch(dir, 'side');
    await git.checkoutBranch(dir, 'side');
    await writeFile(dir, 'b.txt', 'bravo\n');
    await git.commit(dir, 'add b');

    await git.checkoutBranch(dir, 'main');
    await writeFile(dir, 'c.txt', 'charlie\n');
    await git.commit(dir, 'add c');

    const result = await git.mergeTreeConflicts(dir, 'main', 'side');
    expect(result.conflicts).toEqual([]);
    expect(await git.isClean(dir)).toBe(true);
    // The side branch's file must NOT have appeared in the working tree.
    await expect(fs.access(path.join(dir, 'b.txt'))).rejects.toBeTruthy();
  });

  it('returns supported:false for an exit code git only emits on unknown flags', async () => {
    const dir = await makeConflictingRepo('unsupported');
    const stub: IGitProcessRunner = {
      async run() {
        return { exitCode: 129, stdout: 'usage: git merge-tree ...', stderr: '', durationMs: 0 };
      },
    };
    const client = makeClient(path.join(tmpRoot, 'ws'), stub);
    expect(await client.mergeTreeConflicts(dir, 'main', 'feature')).toEqual({
      supported: false,
      conflicts: [],
    });
  });

  it('parses the tree oid, conflicted paths and trailing message section', async () => {
    // Shape of real `merge-tree --write-tree --name-only` output on conflict.
    const stdout = [
      '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
      'src/a.ts',
      'src/b.ts',
      'src/a.ts',
      '',
      'Auto-merging src/a.ts',
      'CONFLICT (content): Merge conflict in src/a.ts',
      '',
    ].join('\n');
    const stub: IGitProcessRunner = {
      async run() {
        return { exitCode: 1, stdout, stderr: '', durationMs: 0 };
      },
    };
    const client = makeClient(path.join(tmpRoot, 'ws'), stub);

    const result = await client.mergeTreeConflicts(tmpRoot, 'main', 'feature');
    expect(result.supported).toBe(true);
    // De-duplicated, tree oid dropped, messages section excluded.
    expect(result.conflicts).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('treats a clean exit as a clean merge', async () => {
    const stub: IGitProcessRunner = {
      async run() {
        return {
          exitCode: 0,
          stdout: '4b825dc642cb6eb9a060e54bf8d69288fbee4904\n',
          stderr: '',
          durationMs: 0,
        };
      },
    };
    const client = makeClient(path.join(tmpRoot, 'ws'), stub);
    expect(await client.mergeTreeConflicts(tmpRoot, 'main', 'feature')).toEqual({
      supported: true,
      conflicts: [],
    });
  });
});

describe('GitClient.merge / mergeAbort / commitMerge', () => {
  it('reports conflicts instead of throwing, and mergeAbort restores a clean tree', async () => {
    const dir = await makeConflictingRepo();

    const result = await git.merge(dir, 'feature', { noCommit: true });
    expect(result.ok).toBe(false);
    expect(result.conflicts).toEqual(['conflict.txt']);

    // Mid-conflict state is observable.
    expect(await git.unmergedFiles(dir)).toEqual(['conflict.txt']);
    expect(await git.mergeInProgress(dir)).toBe(true);
    expect(await git.isClean(dir)).toBe(false);

    await git.mergeAbort(dir);

    expect(await git.mergeInProgress(dir)).toBe(false);
    expect(await git.unmergedFiles(dir)).toEqual([]);
    expect(await git.isClean(dir)).toBe(true);
    expect(await fs.readFile(path.join(dir, 'conflict.txt'), 'utf-8')).toBe('from main\n');
  });

  it('mergeAbort is a no-op when no merge is in progress', async () => {
    const dir = await makeConflictingRepo('noop');
    await expect(git.mergeAbort(dir)).resolves.toBeUndefined();
    expect(await git.isClean(dir)).toBe(true);
  });

  it('merges cleanly and commits with a message', async () => {
    const dir = path.join(tmpRoot, 'ff');
    await fs.mkdir(dir, { recursive: true });
    await git.initIfNeeded(dir);
    await writeFile(dir, 'a.txt', 'alpha\n');
    await git.commit(dir, 'base');

    await git.createBranch(dir, 'side');
    await git.checkoutBranch(dir, 'side');
    await writeFile(dir, 'b.txt', 'bravo\n');
    await git.commit(dir, 'add b');

    await git.checkoutBranch(dir, 'main');
    await writeFile(dir, 'c.txt', 'charlie\n');
    await git.commit(dir, 'add c');

    const result = await git.merge(dir, 'side', { message: 'merge side' });
    expect(result).toEqual({ ok: true, conflicts: [] });
    expect(await fs.readFile(path.join(dir, 'b.txt'), 'utf-8')).toBe('bravo\n');
  });

  it('commitMerge refuses while conflicts are unresolved, then succeeds once they are', async () => {
    const dir = await makeConflictingRepo('resolve');

    const merged = await git.merge(dir, 'feature', { noCommit: true });
    expect(merged.ok).toBe(false);

    await expect(git.commitMerge(dir, 'resolved')).rejects.toBeInstanceOf(GitError);

    // Editing the file is not enough — the index keeps the conflict stages
    // until the resolution is staged, which is exactly what `commitMerge`
    // refuses to guess at.
    await writeFile(dir, 'conflict.txt', 'resolved by hand\n');
    await expect(git.commitMerge(dir, 'resolved')).rejects.toBeInstanceOf(GitError);

    await git.addAll(dir);
    const sha = await git.commitMerge(dir, 'resolved');
    expect(sha).toMatch(/^[0-9a-f]{40}$/);

    expect(await git.mergeInProgress(dir)).toBe(false);
    expect(await git.isClean(dir)).toBe(true);
    // A merge commit has two parents.
    const parents = (await runGit(dir, ['rev-list', '--parents', '-n', '1', 'HEAD'])).trim().split(/\s+/);
    expect(parents).toHaveLength(3);
  });

  it('throws when the merge fails for a reason other than conflicts', async () => {
    const dir = await makeConflictingRepo('dirty');
    // An uncommitted local edit to the very file the merge would overwrite:
    // git refuses before it creates any unmerged index entries.
    await writeFile(dir, 'conflict.txt', 'local uncommitted\n');

    await expect(git.merge(dir, 'feature', { noCommit: true })).rejects.toBeInstanceOf(GitError);
    expect(await git.unmergedFiles(dir)).toEqual([]);
  });
});

describe('GitClient.defaultBranch', () => {
  /** A bare "origin" plus a working clone of it, so `origin/HEAD` is real. */
  async function makeCloneOfOrigin(): Promise<{ origin: string; work: string }> {
    const seed = path.join(tmpRoot, 'seed');
    await fs.mkdir(seed, { recursive: true });
    await git.initIfNeeded(seed); // -b main
    await writeFile(seed, 'README.md', '# Seed\n');
    await git.commit(seed, 'init');

    const origin = path.join(tmpRoot, 'origin.git');
    await git.bareClone(seed, origin);

    const work = path.join(tmpRoot, 'work');
    await git.cloneToDirectory(origin, work);
    return { origin, work };
  }

  it('resolves from refs/remotes/origin/HEAD', async () => {
    const { work } = await makeCloneOfOrigin();
    expect(await git.defaultBranch(work)).toBe('main');
  });

  it('caches the answer so a second call spawns no git process', async () => {
    const { work } = await makeCloneOfOrigin();

    const runner = new CountingRunner(new NodeGitRunner());
    const client = makeClient(path.join(tmpRoot, 'ws'), runner);

    expect(await client.defaultBranch(work)).toBe('main');
    const afterFirst = runner.calls.length;
    expect(afterFirst).toBeGreaterThan(0);

    expect(await client.defaultBranch(work)).toBe('main');
    expect(runner.calls.length).toBe(afterFirst);
  });

  it('caches the negative answer for a repo with no remote at all', async () => {
    const dir = path.join(tmpRoot, 'no-remote');
    await fs.mkdir(dir, { recursive: true });
    await git.initIfNeeded(dir);
    await writeFile(dir, 'a.txt', 'a\n');
    await git.commit(dir, 'init');

    const runner = new CountingRunner(new NodeGitRunner());
    const client = makeClient(path.join(tmpRoot, 'ws'), runner);

    expect(await client.defaultBranch(dir)).toBeNull();
    const afterFirst = runner.calls.length;
    // All three probes were tried before giving up.
    expect(afterFirst).toBeGreaterThanOrEqual(3);

    expect(await client.defaultBranch(dir)).toBeNull();
    expect(runner.calls.length).toBe(afterFirst);
  });
});

describe('GitClient.aheadBehind / upstreamOf / isDetached', () => {
  it('counts commits on each side of a divergence', async () => {
    const dir = path.join(tmpRoot, 'diverge');
    await fs.mkdir(dir, { recursive: true });
    await git.initIfNeeded(dir);
    await writeFile(dir, 'a.txt', '0\n');
    await git.commit(dir, 'base');

    await git.createBranch(dir, 'dev');
    await git.checkoutBranch(dir, 'dev');
    await writeFile(dir, 'a.txt', '1\n');
    await git.commit(dir, 'dev 1');
    await writeFile(dir, 'a.txt', '2\n');
    await git.commit(dir, 'dev 2');

    await git.checkoutBranch(dir, 'main');
    await writeFile(dir, 'b.txt', 'main\n');
    await git.commit(dir, 'main 1');

    expect(await git.aheadBehind(dir, 'dev', 'main')).toEqual({ ahead: 2, behind: 1 });
    expect(await git.aheadBehind(dir, 'main', 'dev')).toEqual({ ahead: 1, behind: 2 });
    // Identical refs.
    expect(await git.aheadBehind(dir, 'main', 'main')).toEqual({ ahead: 0, behind: 0 });
    // Unresolvable ref.
    expect(await git.aheadBehind(dir, 'nope', 'main')).toBeNull();
  });

  it('reports the tracking branch and detached HEAD', async () => {
    const seed = path.join(tmpRoot, 'seed2');
    await fs.mkdir(seed, { recursive: true });
    await git.initIfNeeded(seed);
    await writeFile(seed, 'a.txt', 'a\n');
    await git.commit(seed, 'init');

    const origin = path.join(tmpRoot, 'origin2.git');
    await git.bareClone(seed, origin);
    const work = path.join(tmpRoot, 'work2');
    await git.cloneToDirectory(origin, work);

    expect(await git.upstreamOf(work, 'main')).toBe('origin/main');
    expect(await git.upstreamOf(work, 'nope')).toBeNull();

    expect(await git.isDetached(work)).toBe(false);
    const head = await git.revParse(work, 'HEAD');
    await runGit(work, ['checkout', '--detach', head!]);
    expect(await git.isDetached(work)).toBe(true);
  });
});

describe('GitClient.commitWithSha / addAll', () => {
  it('returns the new sha, then null when there is nothing to commit', async () => {
    const dir = path.join(tmpRoot, 'commits');
    await fs.mkdir(dir, { recursive: true });
    await git.initIfNeeded(dir);
    await writeFile(dir, 'a.txt', 'alpha\n');

    const first = await git.commitWithSha(dir, 'first commit');
    expect(first).not.toBeNull();
    expect(first!.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(first!.message).toBe('first commit');
    expect(first!.sha).toBe(await git.revParse(dir, 'HEAD'));

    // Clean tree — nothing to do.
    expect(await git.commitWithSha(dir, 'second commit')).toBeNull();

    await writeFile(dir, 'a.txt', 'beta\n');
    const second = await git.commitWithSha(dir, 'second commit');
    expect(second).not.toBeNull();
    expect(second!.sha).not.toBe(first!.sha);
  });

  it('addAll stages untracked and deleted files alike', async () => {
    const dir = path.join(tmpRoot, 'addall');
    await fs.mkdir(dir, { recursive: true });
    await git.initIfNeeded(dir);
    await writeFile(dir, 'keep.txt', 'k\n');
    await writeFile(dir, 'gone.txt', 'g\n');
    await git.commit(dir, 'init');

    await fs.rm(path.join(dir, 'gone.txt'));
    await writeFile(dir, 'new.txt', 'n\n');
    await git.addAll(dir);

    const staged = await runGit(dir, ['diff', '--cached', '--name-status']);
    expect(staged).toContain('D\tgone.txt');
    expect(staged).toContain('A\tnew.txt');
  });
});

describe('GitClient.log', () => {
  it('returns subject lines for a range and an empty array for a bad range', async () => {
    const dir = path.join(tmpRoot, 'log');
    await fs.mkdir(dir, { recursive: true });
    await git.initIfNeeded(dir);
    await writeFile(dir, 'a.txt', '0\n');
    await git.commit(dir, 'base');
    const base = await git.revParse(dir, 'HEAD');

    await writeFile(dir, 'a.txt', '1\n');
    await git.commit(dir, 'second');
    await writeFile(dir, 'a.txt', '2\n');
    await git.commit(dir, 'third');

    expect(await git.log(dir, `${base}..HEAD`)).toEqual(['third', 'second']);
    expect(await git.log(dir, `${base}..HEAD`, 1)).toEqual(['third']);
    expect(await git.log(dir, 'does-not-exist..HEAD')).toEqual([]);
  });
});

describe('GitClient.changedFilesSummary', () => {
  it('reports modified, untracked and renamed files', async () => {
    const dir = path.join(tmpRoot, 'summary');
    await fs.mkdir(dir, { recursive: true });
    await git.initIfNeeded(dir);
    await writeFile(dir, 'a.txt', 'alpha\n');
    await writeFile(dir, 'b.txt', 'bravo bravo bravo bravo\n');
    await git.commit(dir, 'init');

    // Unstaged modification.
    await writeFile(dir, 'a.txt', 'alpha changed\n');
    // Untracked file.
    await writeFile(dir, 'fresh.txt', 'new\n');
    // Staged rename (content unchanged, so git detects it as R).
    await fs.rename(path.join(dir, 'b.txt'), path.join(dir, 'c.txt'));
    await runGit(dir, ['add', '-A', '--', 'b.txt', 'c.txt']);

    const summary = await git.changedFilesSummary(dir);
    const byPath = new Map(summary.map((e) => [e.path, e]));

    expect(byPath.get('a.txt')).toEqual({ code: 'M', path: 'a.txt' });
    expect(byPath.get('fresh.txt')).toEqual({ code: 'A', path: 'fresh.txt' });
    expect(byPath.get('c.txt')).toEqual({ code: 'R', path: 'c.txt', oldPath: 'b.txt' });
    expect(byPath.has('b.txt')).toBe(false);
  });

  it('reports deletions and returns nothing for a clean tree', async () => {
    const dir = path.join(tmpRoot, 'summary2');
    await fs.mkdir(dir, { recursive: true });
    await git.initIfNeeded(dir);
    await writeFile(dir, 'a.txt', 'alpha\n');
    await writeFile(dir, 'b.txt', 'bravo\n');
    await git.commit(dir, 'init');

    expect(await git.changedFilesSummary(dir)).toEqual([]);

    await fs.rm(path.join(dir, 'b.txt'));
    const summary = await git.changedFilesSummary(dir);
    expect(summary).toEqual([{ code: 'D', path: 'b.txt' }]);
  });

  it('handles paths with spaces', async () => {
    const dir = path.join(tmpRoot, 'summary3');
    await fs.mkdir(dir, { recursive: true });
    await git.initIfNeeded(dir);
    await writeFile(dir, 'a file with spaces.txt', 'x\n');

    const summary = await git.changedFilesSummary(dir);
    expect(summary).toContainEqual({ code: 'A', path: 'a file with spaces.txt' });
  });
});

describe('GitClient.fetch / pushSetUpstream', () => {
  it('pushes a new branch with upstream tracking and fetches it back', async () => {
    const seed = path.join(tmpRoot, 'seed3');
    await fs.mkdir(seed, { recursive: true });
    await git.initIfNeeded(seed);
    await writeFile(seed, 'a.txt', 'a\n');
    await git.commit(seed, 'init');

    const origin = path.join(tmpRoot, 'origin3.git');
    await git.bareClone(seed, origin);

    // A full clone, not `cloneToDirectory`: that one passes `--depth 1`, which
    // implies `--single-branch`, so the fetch refspec would never create
    // `refs/remotes/origin/feature/x` and `@{upstream}` could not resolve.
    const work = path.join(tmpRoot, 'work3');
    await runGit(tmpRoot, ['clone', '--quiet', origin, work]);

    await git.checkoutNewBranch(work, 'feature/x');
    await writeFile(work, 'b.txt', 'b\n');
    await git.commit(work, 'feature commit');
    await git.pushSetUpstream(work, 'origin', 'feature/x');

    expect(await git.upstreamOf(work, 'feature/x')).toBe('origin/feature/x');

    // A second clone can now fetch that branch.
    const other = path.join(tmpRoot, 'work4');
    await runGit(tmpRoot, ['clone', '--quiet', origin, other]);
    await git.fetch(other, 'origin', 'feature/x');
    expect(await git.revParse(other, 'FETCH_HEAD')).toBe(await git.revParse(work, 'HEAD'));
  });

  it('fetch throws GitError for an unknown remote', async () => {
    const dir = path.join(tmpRoot, 'norem');
    await fs.mkdir(dir, { recursive: true });
    await git.initIfNeeded(dir);
    await writeFile(dir, 'a.txt', 'a\n');
    await git.commit(dir, 'init');

    await expect(git.fetch(dir, 'nope')).rejects.toBeInstanceOf(GitError);
  });
});

describe('GitClient.gitVersion', () => {
  it('parses the version and caches it', async () => {
    const runner = new CountingRunner(new NodeGitRunner());
    const client = makeClient(path.join(tmpRoot, 'ws'), runner);

    const version = await client.gitVersion();
    expect(version).toMatch(/^\d+\.\d+/);

    const after = runner.calls.length;
    expect(await client.gitVersion()).toBe(version);
    expect(runner.calls.length).toBe(after);
  });
});
