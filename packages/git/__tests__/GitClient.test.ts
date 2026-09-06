// ────────────────────────────────────────────────────────────────
// GitClient integration tests — exercised against real temp git repos
// ────────────────────────────────────────────────────────────────

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

const execFileAsync = promisify(execFile);

// Real process runner backed by node:child_process — validates that the
// GitClient's argument construction produces correct git behavior.
class NodeGitRunner implements IGitProcessRunner {
  async run(
    command: string,
    args: string[],
    options: GitProcessRunOptions,
  ): Promise<GitProcessRunResult> {
    const start = Date.now();
    try {
      const { stdout, stderr } = await execFileAsync(command, args, {
        cwd: options.cwd,
        timeout: options.timeout ?? 30_000,
        env: options.env ? { ...process.env, ...options.env } : process.env,
        maxBuffer: 32 * 1024 * 1024,
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

const silentLogger: ILogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};

// A recording logger to assert on log side effects where relevant.
function makeClient(workspacesDir: string): GitClient {
  return new GitClient(new NodeGitRunner(), silentLogger, {
    workspacesDir,
    defaultTimeoutMs: 60_000,
  });
}

async function writeFile(dir: string, rel: string, content: string): Promise<void> {
  const full = path.join(dir, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf-8');
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
  // Best effort — leave the temp dir for the OS to reap if still locked.
}

let tmpRoot: string;
let git: GitClient;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gitclient-'));
  git = makeClient(path.join(tmpRoot, 'workspaces'));
});

afterEach(async () => {
  await removeDirWithRetry(tmpRoot);
});

describe('GitClient.initIfNeeded', () => {
  it('initializes a repo and writes a default .gitignore', async () => {
    const dir = path.join(tmpRoot, 'proj');
    await fs.mkdir(dir, { recursive: true });
    await writeFile(dir, 'index.js', 'console.log(1)\n');

    const created = await git.initIfNeeded(dir);
    expect(created).toBe(true);
    expect(await git.isGitRepo(dir)).toBe(true);

    const ignore = await fs.readFile(path.join(dir, '.gitignore'), 'utf-8');
    expect(ignore).toContain('node_modules/');
    expect(ignore).toContain('dist/');
  });

  it('returns false when the directory is already a repo', async () => {
    const dir = path.join(tmpRoot, 'proj2');
    await fs.mkdir(dir, { recursive: true });
    expect(await git.initIfNeeded(dir)).toBe(true);
    expect(await git.initIfNeeded(dir)).toBe(false);
  });

  it('does not overwrite an existing .gitignore', async () => {
    const dir = path.join(tmpRoot, 'proj3');
    await fs.mkdir(dir, { recursive: true });
    await writeFile(dir, '.gitignore', 'custom-ignore\n');
    await git.initIfNeeded(dir);
    const ignore = await fs.readFile(path.join(dir, '.gitignore'), 'utf-8');
    expect(ignore.trim()).toBe('custom-ignore');
  });
});

describe('GitClient.isGitRepo', () => {
  it('returns false for a plain directory', async () => {
    const dir = path.join(tmpRoot, 'plain');
    await fs.mkdir(dir, { recursive: true });
    expect(await git.isGitRepo(dir)).toBe(false);
  });

  it('returns false for a non-existent directory', async () => {
    expect(await git.isGitRepo(path.join(tmpRoot, 'nope'))).toBe(false);
  });
});

describe('GitClient.commit / status / diff', () => {
  async function initWithFile(): Promise<string> {
    const dir = path.join(tmpRoot, 'repo');
    await fs.mkdir(dir, { recursive: true });
    await git.initIfNeeded(dir);
    await writeFile(dir, 'a.txt', 'hello\n');
    return dir;
  }

  it('commit returns true when there are changes, false when clean', async () => {
    const dir = await initWithFile();
    expect(await git.commit(dir, 'first')).toBe(true);
    // Nothing new → clean tree
    expect(await git.commit(dir, 'noop')).toBe(false);
  });

  it('getStatus reports untracked and modified files (porcelain)', async () => {
    const dir = await initWithFile();
    await git.commit(dir, 'first');

    await writeFile(dir, 'a.txt', 'hello world\n'); // modify
    await writeFile(dir, 'b.txt', 'new\n'); // untracked
    const status = await git.getStatus(dir);
    expect(status).toMatch(/ M a\.txt|M  a\.txt|MM a\.txt/);
    expect(status).toContain('?? b.txt');
  });

  it('getDiff returns unstaged unified diff', async () => {
    const dir = await initWithFile();
    await git.commit(dir, 'first');
    await writeFile(dir, 'a.txt', 'hello world\n');
    const diff = await git.getDiff(dir, false);
    expect(diff).toContain('a.txt');
    expect(diff).toContain('+hello world');
    expect(diff).toContain('-hello');
  });

  it('getDiff(staged) returns staged diff only', async () => {
    const dir = await initWithFile();
    await git.commit(dir, 'first');
    await writeFile(dir, 'a.txt', 'staged change\n');
    // stage the change
    await new NodeGitRunner().run('git', ['add', 'a.txt'], { cwd: dir });
    const staged = await git.getDiff(dir, true);
    expect(staged).toContain('+staged change');
    const unstaged = await git.getDiff(dir, false);
    expect(unstaged.trim()).toBe('');
  });
});

describe('GitClient.firstCommit / diffNameStatus', () => {
  it('firstCommit returns null before any commit, hash after', async () => {
    const dir = path.join(tmpRoot, 'fc');
    await fs.mkdir(dir, { recursive: true });
    await git.initIfNeeded(dir);
    expect(await git.firstCommit(dir)).toBeNull();
    await writeFile(dir, 'x.txt', '1\n');
    await git.commit(dir, 'c1');
    const first = await git.firstCommit(dir);
    expect(first).toMatch(/^[0-9a-f]{7,40}$/);
  });

  it('diffNameStatus lists added/modified/deleted between baseline and HEAD', async () => {
    const dir = path.join(tmpRoot, 'ns');
    await fs.mkdir(dir, { recursive: true });
    await git.initIfNeeded(dir);
    await writeFile(dir, 'keep.txt', 'a\n');
    await writeFile(dir, 'remove.txt', 'b\n');
    await git.commit(dir, 'baseline');
    const base = await git.firstCommit(dir);
    expect(base).not.toBeNull();

    // Modify keep, delete remove, add fresh
    await writeFile(dir, 'keep.txt', 'a changed\n');
    await fs.rm(path.join(dir, 'remove.txt'));
    await writeFile(dir, 'fresh.txt', 'c\n');
    await git.commit(dir, 'changes');

    const ns = await git.diffNameStatus(dir, `${base}..HEAD`);
    expect(ns).toMatch(/M\s+keep\.txt/);
    expect(ns).toMatch(/D\s+remove\.txt/);
    expect(ns).toMatch(/A\s+fresh\.txt/);
  });

  it('detects renames in name-status output', async () => {
    const dir = path.join(tmpRoot, 'rn');
    await fs.mkdir(dir, { recursive: true });
    await git.initIfNeeded(dir);
    await writeFile(dir, 'old-name.txt', 'stable content that is long enough to detect rename\n');
    await git.commit(dir, 'baseline');
    const base = await git.firstCommit(dir);

    await fs.rename(path.join(dir, 'old-name.txt'), path.join(dir, 'new-name.txt'));
    await git.commit(dir, 'rename');

    const ns = await git.diffNameStatus(dir, `${base}..HEAD`);
    // git renders renames as R<score>\told\tnew (rename detection is default on)
    expect(ns).toMatch(/R\d*\s+old-name\.txt\s+new-name\.txt|A\s+new-name\.txt/);
  });
});

describe('GitClient.lsFiles', () => {
  it('lists tracked + untracked while honoring .gitignore', async () => {
    const dir = path.join(tmpRoot, 'ls');
    await fs.mkdir(dir, { recursive: true });
    await git.initIfNeeded(dir); // writes .gitignore with node_modules/
    await writeFile(dir, 'src/app.ts', 'export {}\n');
    await writeFile(dir, 'node_modules/dep/index.js', 'ignored\n');
    const files = await git.lsFiles(dir);
    expect(files).toContain('src/app.ts');
    expect(files.some((f) => f.includes('node_modules'))).toBe(false);
  });

  it('returns empty array for a non-repo directory', async () => {
    const dir = path.join(tmpRoot, 'nonrepo');
    await fs.mkdir(dir, { recursive: true });
    expect(await git.lsFiles(dir)).toEqual([]);
  });
});

describe('GitClient.currentBranch', () => {
  it('reports the initial branch name after a commit', async () => {
    const dir = path.join(tmpRoot, 'br');
    await fs.mkdir(dir, { recursive: true });
    await git.initIfNeeded(dir); // -b main
    await writeFile(dir, 'f.txt', '1\n');
    await git.commit(dir, 'c1');
    expect(await git.currentBranch(dir)).toBe('main');
  });

  it('checkoutNewBranch switches branch', async () => {
    const dir = path.join(tmpRoot, 'br2');
    await fs.mkdir(dir, { recursive: true });
    await git.initIfNeeded(dir);
    await writeFile(dir, 'f.txt', '1\n');
    await git.commit(dir, 'c1');
    await git.checkoutNewBranch(dir, 'feature/x');
    expect(await git.currentBranch(dir)).toBe('feature/x');
  });
});

describe('GitClient.getBranches', () => {
  it('lists local branches', async () => {
    const dir = path.join(tmpRoot, 'branches');
    await fs.mkdir(dir, { recursive: true });
    await git.initIfNeeded(dir);
    await writeFile(dir, 'f.txt', '1\n');
    await git.commit(dir, 'c1');
    await git.checkoutNewBranch(dir, 'dev');
    const branches = await git.getBranches(dir);
    expect(branches).toContain('main');
    expect(branches).toContain('dev');
  });
});

describe('GitClient bare clone + worktree lifecycle', () => {
  async function makeOriginRepo(): Promise<string> {
    const origin = path.join(tmpRoot, 'origin');
    await fs.mkdir(origin, { recursive: true });
    await git.initIfNeeded(origin);
    await writeFile(origin, 'README.md', '# Origin\n');
    await git.commit(origin, 'init');
    return origin;
  }

  it('bareClone creates a bare mirror, then worktrees can be added/removed', async () => {
    const origin = await makeOriginRepo();
    const bare = path.join(tmpRoot, 'cache', 'origin.git');
    await git.bareClone(origin, bare);
    expect(await git.isGitRepo(bare).catch(() => false)).toBe(false); // bare has no worktree

    const wtPath = path.join(tmpRoot, 'wt', 'feature');
    await git.createWorktree(bare, wtPath, 'feature/1', 'main');
    expect(await git.isGitRepo(wtPath)).toBe(true);
    // File from origin is present in the worktree
    const readme = await fs.readFile(path.join(wtPath, 'README.md'), 'utf-8');
    expect(readme).toContain('# Origin');

    const list = await git.listWorktrees(bare);
    expect(list.some((p) => p.replace(/\\/g, '/').endsWith('wt/feature'))).toBe(true);

    await git.removeWorktree(bare, wtPath);
    await expect(fs.access(wtPath)).rejects.toBeTruthy();
  });

  it('lsTree + showFile read from the bare repo', async () => {
    const origin = await makeOriginRepo();
    await writeFile(origin, 'src/lib.ts', 'export const x = 1\n');
    await git.commit(origin, 'add lib');
    const bare = path.join(tmpRoot, 'cache2', 'origin.git');
    await git.bareClone(origin, bare);

    const rootEntries = await git.lsTree(bare);
    expect(rootEntries.find((e) => e.name === 'README.md')?.type).toBe('blob');
    expect(rootEntries.find((e) => e.name === 'src')?.type).toBe('tree');

    const subEntries = await git.lsTree(bare, 'src');
    expect(subEntries.find((e) => e.name === 'lib.ts')?.path).toBe('src/lib.ts');

    const content = await git.showFile(bare, 'src/lib.ts');
    expect(content).toContain('export const x = 1');
  });

  it('showFile throws GitError for a missing path', async () => {
    const origin = await makeOriginRepo();
    const bare = path.join(tmpRoot, 'cache3', 'origin.git');
    await git.bareClone(origin, bare);
    await expect(git.showFile(bare, 'does-not-exist.txt')).rejects.toThrow();
  });
});

describe('GitClient clone + pull + push + remote', () => {
  it('cloneToDirectory clones a local origin and getRemoteUrl resolves', async () => {
    const origin = path.join(tmpRoot, 'origin-c');
    await fs.mkdir(origin, { recursive: true });
    await git.initIfNeeded(origin);
    await writeFile(origin, 'file.txt', 'v1\n');
    await git.commit(origin, 'v1');

    const target = path.join(tmpRoot, 'clone-target');
    await git.cloneToDirectory(origin, target);
    expect(await git.isGitRepo(target)).toBe(true);
    const remote = await git.getRemoteUrl(target);
    expect(remote?.replace(/\\/g, '/')).toContain('origin-c');
  });

  it('commitAndPush pushes commits to a bare origin', async () => {
    // bare origin so push has somewhere to go
    const seed = path.join(tmpRoot, 'seed');
    await fs.mkdir(seed, { recursive: true });
    await git.initIfNeeded(seed);
    await writeFile(seed, 'a.txt', '1\n');
    await git.commit(seed, 'seed');
    const bareOrigin = path.join(tmpRoot, 'bare-origin.git');
    await git.bareClone(seed, bareOrigin);

    const work = path.join(tmpRoot, 'work');
    await git.cloneToDirectory(bareOrigin, work);
    await writeFile(work, 'a.txt', '2\n');
    const branch = await git.currentBranch(work);
    await git.commitAndPush(work, 'update', branch ?? undefined);

    // Verify origin advanced: clone fresh and read file
    const verify = path.join(tmpRoot, 'verify');
    await git.cloneToDirectory(bareOrigin, verify);
    const content = await fs.readFile(path.join(verify, 'a.txt'), 'utf-8');
    expect(content.trim()).toBe('2');
  });

  it('commitAndPush is a no-op when the tree is clean', async () => {
    const seed = path.join(tmpRoot, 'seed2');
    await fs.mkdir(seed, { recursive: true });
    await git.initIfNeeded(seed);
    await writeFile(seed, 'a.txt', '1\n');
    await git.commit(seed, 'seed');
    const bareOrigin = path.join(tmpRoot, 'bare-origin2.git');
    await git.bareClone(seed, bareOrigin);
    const work = path.join(tmpRoot, 'work2');
    await git.cloneToDirectory(bareOrigin, work);
    // No changes → should not throw even though push would fail with nothing
    await expect(git.commitAndPush(work, 'noop')).resolves.toBeUndefined();
  });
});

describe('GitClient error handling', () => {
  it('cloneToDirectory throws GitError on invalid url', async () => {
    const target = path.join(tmpRoot, 'bad-clone');
    await expect(
      git.cloneToDirectory(path.join(tmpRoot, 'nonexistent-origin'), target),
    ).rejects.toThrow();
  });

  it('cleanup removes a directory and is safe on missing dir', async () => {
    const dir = path.join(tmpRoot, 'to-clean');
    await fs.mkdir(dir, { recursive: true });
    await writeFile(dir, 'f.txt', '1\n');
    await git.cleanup(dir);
    await expect(fs.access(dir)).rejects.toBeTruthy();
    // second call on missing dir must not throw
    await expect(git.cleanup(dir)).resolves.toBeUndefined();
  });

  it('getRemoteUrl returns null when no remote is configured', async () => {
    const dir = path.join(tmpRoot, 'no-remote');
    await fs.mkdir(dir, { recursive: true });
    await git.initIfNeeded(dir);
    expect(await git.getRemoteUrl(dir)).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────
// isGitRepo caching.
//
// The checkpoint path calls `isGitRepo` twice per chat turn against the same
// directory, and each call spawned a `git rev-parse --is-inside-work-tree`
// process. On a live server 25 of the git processes spawned during a short
// chat session were this probe — a third of them — each ~300 ms of process
// start on Windows, for an answer that cannot change.
// ────────────────────────────────────────────────────────────────

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
  probeCount(): number {
    return this.calls.filter((c) => c.includes('--is-inside-work-tree')).length;
  }
}

describe('GitClient.isGitRepo caching', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gitclient-probe-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  function countingClient(): { client: GitClient; runner: CountingRunner } {
    const runner = new CountingRunner(new NodeGitRunner());
    const client = new GitClient(runner, silentLogger, { workspacesDir: dir, defaultTimeoutMs: 60_000 });
    return { client, runner };
  }

  it('asks git once for a repo and reuses the answer', async () => {
    const { client, runner } = countingClient();
    await client.initIfNeeded(dir);
    const probesAfterInit = runner.probeCount();

    expect(await client.isGitRepo(dir)).toBe(true);
    expect(await client.isGitRepo(dir)).toBe(true);
    expect(await client.isGitRepo(dir)).toBe(true);

    // `initIfNeeded` primes the cache, so none of the three calls spawn git.
    expect(runner.probeCount()).toBe(probesAfterInit);
  });

  it('does NOT cache a negative answer, so a later init is still seen', async () => {
    const { client } = countingClient();
    const plain = path.join(dir, 'not-a-repo');
    await fs.mkdir(plain, { recursive: true });

    expect(await client.isGitRepo(plain)).toBe(false);
    await client.initIfNeeded(plain);
    // Caching `false` would make this still report false and break every
    // caller that inits on demand.
    expect(await client.isGitRepo(plain)).toBe(true);
  });

  it('re-probes after the cached answer is forgotten', async () => {
    const { client, runner } = countingClient();
    await client.initIfNeeded(dir);
    await client.isGitRepo(dir);
    const before = runner.probeCount();

    client.forgetRepoProbe(dir);
    await client.isGitRepo(dir);

    expect(runner.probeCount()).toBe(before + 1);
  });

  it('keeps separate answers per directory', async () => {
    const { client } = countingClient();
    const a = path.join(dir, 'a');
    const b = path.join(dir, 'b');
    await fs.mkdir(a, { recursive: true });
    await fs.mkdir(b, { recursive: true });
    await client.initIfNeeded(a);

    expect(await client.isGitRepo(a)).toBe(true);
    // `b` is inside `a`'s parent but is not itself a work tree, and a cached
    // answer for `a` must not leak into it.
    expect(await client.isGitRepo(b)).toBe(false);
  });
});
