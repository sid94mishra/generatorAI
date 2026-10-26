// ────────────────────────────────────────────────────────────────
// SourceControlFlowService — against a REAL temp git repo with a bare
// "origin" remote. The provider is faked; every git operation is real, so
// the branch/commit/sync/push behaviour is exercised end to end.
//
// Note on git versions: `merge-tree --write-tree` needs git >= 2.38. On older
// git the service falls back to a real `--no-commit` merge that is aborted
// immediately. These tests assert on the OUTCOME (conflicts reported, tree
// untouched), never on which detection mechanism ran, so they pass on both.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GitClient } from '@generatorai/git';
import type {
  IGitProcessRunner,
  GitProcessRunOptions,
  GitProcessRunResult,
} from '@generatorai/git';
import type {
  ISourceControlProvider,
  SourceControlRegistry,
} from '@generatorai/source-control';
import type { PullRequestSummary } from '@generatorai/shared';
import { RepoReadinessService } from '../RepoReadinessService.js';
import { ScmTextGenerator } from '../ScmTextGenerator.js';
import { SourceControlFlowService, slugifyBranchHint } from '../SourceControlFlowService.js';
import type { IAgentHarness } from '../../../domain/ports/IAgentHarness.js';
import { silentLogger, settings } from './helpers.js';

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

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 });
  return stdout;
}

async function identify(repoDir: string): Promise<void> {
  await git(repoDir, 'config', 'user.email', 'test@generatorai.local');
  await git(repoDir, 'config', 'user.name', 'GeneratorAI Test');
  await git(repoDir, 'config', 'commit.gpgsign', 'false');
  // Byte-exact checkouts: Git for Windows defaults to core.autocrlf=true,
  // which rewrites files restored by `merge --abort` with CRLF endings.
  await git(repoDir, 'config', 'core.autocrlf', 'false');
}

async function write(dir: string, rel: string, content: string): Promise<void> {
  const full = path.join(dir, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf-8');
}

// Windows keeps brief locks on git pack files after a process exits.
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

const OPEN_PR: PullRequestSummary = {
  provider: 'github',
  number: 11,
  url: 'https://github.com/acme/web/pull/11',
  title: 'Existing',
  state: 'open',
  head: 'whatever',
  base: 'main',
};

function fakeProviderPair(opts: { existingPr?: PullRequestSummary | null } = {}) {
  const created: unknown[] = [];
  const provider = {
    id: 'github',
    findOpenPullRequestForHead: vi.fn(async () => opts.existingPr ?? null),
    createPullRequest: vi.fn(async (input: Record<string, unknown>) => {
      created.push(input);
      return {
        provider: 'github',
        number: 99,
        url: 'https://github.com/acme/web/pull/99',
        title: String(input['title']),
        state: 'open',
        head: String(input['head']),
        base: String(input['base']),
      } satisfies PullRequestSummary;
    }),
  } as unknown as ISourceControlProvider;
  const registry = {
    // The remote is a local path, so any host maps to the one fake provider.
    providerFor: () => provider,
    accountFor: () => ({
      id: 'acc-1',
      provider: 'github' as const,
      label: 'octocat',
      authMethod: 'token' as const,
      createdAt: new Date().toISOString(),
    }),
  } as unknown as SourceControlRegistry;
  return { provider, registry, created };
}

describe('SourceControlFlowService (real git)', () => {
  let root: string;
  let origin: string;
  let work: string;
  let seed: string;
  let baseGitClient: GitClient;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'scm-flow-'));
    // The bare origin; `hostedRemote` makes it read as github.com/acme/web for the PR steps.
    const ownerDir = path.join(root, 'acme');
    await fs.mkdir(ownerDir, { recursive: true });
    origin = path.join(ownerDir, 'web.git');
    await execFileAsync('git', ['-c', 'init.defaultBranch=main', 'init', '--bare', origin]);
    await execFileAsync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: origin });

    seed = path.join(root, 'seed');
    await execFileAsync('git', ['clone', '-c', 'core.autocrlf=false', origin, seed]);
    await identify(seed);
    await write(seed, 'README.md', '# web\n');
    await write(seed, 'shared.txt', 'line one\nline two\n');
    await git(seed, 'add', '-A');
    await git(seed, 'commit', '-m', 'chore: initial');
    await git(seed, 'branch', '-M', 'main');
    await git(seed, 'push', '-u', 'origin', 'main');

    // A FULL clone — `--depth 1` implies `--single-branch`, which breaks
    // `@{upstream}` resolution for a freshly pushed branch.
    work = path.join(root, 'work');
    await execFileAsync('git', ['clone', '-c', 'core.autocrlf=false', origin, work]);
    await identify(work);

    baseGitClient = new GitClient(new NodeGitRunner(), silentLogger, {
      workspacesDir: root,
      defaultTimeoutMs: 60_000,
    });
  });

  afterEach(async () => {
    await removeDirWithRetry(root);
  });

  /**
   * The real client, except the remote reads as hosted: the bare origin is a local path, which (rightly)
   * has no host to open a PR on. Pushes and fetches still go to the local origin.
   */
  function hostedRemote(client: GitClient): GitClient {
    const wrapped = Object.create(client) as GitClient;
    wrapped.getRemoteUrl = async (dir: string, remote?: string) =>
      (await client.getRemoteUrl(dir, remote)) ? 'https://github.com/acme/web.git' : null;
    return wrapped;
  }

  function makeService(registry: SourceControlRegistry, defaultBase: string | null = null) {
    const gitClient = hostedRemote(baseGitClient);
    const harness = {
      createConversation: vi.fn(),
      sendPromptAndWait: vi.fn(),
      deleteConversation: vi.fn(),
    } as unknown as IAgentHarness;
    const live = () => settings({ defaultBase });
    const readiness = new RepoReadinessService({
      git: gitClient,
      registry,
      logger: silentLogger,
      settings: live,
    });
    const text = new ScmTextGenerator({
      harness,
      logger: silentLogger,
      // No model → deterministic heuristic text, no harness traffic.
      generation: () => ({ provider: null, model: null }),
    });
    return new SourceControlFlowService({
      git: gitClient,
      registry,
      readiness,
      text,
      logger: silentLogger,
      settings: live,
    });
  }

  /** Push a change to `main` from the seed clone, simulating a moved base. */
  async function moveBase(rel: string, content: string, message: string): Promise<void> {
    await write(seed, rel, content);
    await git(seed, 'add', '-A');
    await git(seed, 'commit', '-m', message);
    await git(seed, 'push', 'origin', 'main');
  }

  it('(a) cuts a branch off the default branch, commits, pushes and opens a PR', async () => {
    const { registry, provider, created } = fakeProviderPair();
    const flow = makeService(registry);
    await write(work, 'src/a.ts', 'export const a = 1;\n');

    const result = await flow.run({
      repoDir: work,
      alias: '.',
      request: {
        commit: { message: 'feat: add a' },
        push: true,
        pullRequest: { title: 'Add a', body: 'Because.' },
      },
      context: { chatName: 'Add the A module' },
    });

    expect(result.status).toBe('ok');
    expect(result.branch).toMatch(/^generatorai\/add-the-a-module-[0-9a-f]{6}$/);
    expect(result.commit?.message).toBe('feat: add a');
    expect(result.pushed).toBe(true);
    expect(result.pullRequest).toMatchObject({ number: 99, base: 'main', head: result.branch });
    expect(result.steps.map((s) => `${s.id}:${s.status}`)).toEqual([
      'readiness:done',
      'branch:done',
      'commit:done',
      'sync:skipped',
      'push:done',
      'pull_request:done',
    ]);

    // The branch really is on the remote, and main was not touched.
    expect(await git(origin, 'branch', '--list', result.branch!)).toContain(result.branch);
    expect((await git(work, 'rev-parse', '--abbrev-ref', 'HEAD')).trim()).toBe(result.branch);
    expect(provider.createPullRequest).toHaveBeenCalledTimes(1);
    expect(created[0]).toMatchObject({ owner: 'acme', repo: 'web', base: 'main' });
  });

  it('(b) keeps an existing work branch instead of cutting a new one', async () => {
    const { registry } = fakeProviderPair();
    const flow = makeService(registry);
    await git(work, 'checkout', '-b', 'feature/mine');
    await write(work, 'src/b.ts', 'export const b = 1;\n');

    const result = await flow.run({
      repoDir: work,
      alias: '.',
      request: { commit: { message: 'feat: b' }, push: true },
    });

    expect(result.status).toBe('ok');
    expect(result.branch).toBeUndefined();
    expect(result.steps.find((s) => s.id === 'branch')?.status).toBe('skipped');
    expect((await git(work, 'rev-parse', '--abbrev-ref', 'HEAD')).trim()).toBe('feature/mine');
    expect(result.pushed).toBe(true);
  });

  it('(c) merges a non-conflicting moved base before pushing', async () => {
    const { registry } = fakeProviderPair();
    const flow = makeService(registry);
    await moveBase('CHANGELOG.md', '# changes\n', 'docs: add changelog');

    await write(work, 'src/c.ts', 'export const c = 1;\n');
    const result = await flow.run({
      repoDir: work,
      alias: '.',
      request: { commit: { message: 'feat: c' }, push: true },
      context: { hint: 'add c' },
    });

    expect(result.status).toBe('ok');
    expect(result.steps.find((s) => s.id === 'sync')).toMatchObject({
      status: 'done',
      detail: 'Merged origin/main',
    });
    // The base commit is now an ancestor of the work branch.
    const log = await git(work, 'log', '--pretty=%s');
    expect(log).toContain('docs: add changelog');
    expect(log).toContain('feat: c');
    expect(result.pushed).toBe(true);
  });

  it('(d) reports conflicts and leaves the working tree untouched', async () => {
    const { registry, provider } = fakeProviderPair();
    const flow = makeService(registry);
    await moveBase('shared.txt', 'THEIRS\nline two\n', 'fix: change line one');

    await write(work, 'shared.txt', 'OURS\nline two\n');
    const result = await flow.run({
      repoDir: work,
      alias: '.',
      request: { commit: { message: 'fix: our line one' }, push: true, pullRequest: {} },
    });

    expect(result.status).toBe('conflicts');
    expect(result.conflicts).toMatchObject({ base: 'main', mergeStarted: false });
    expect(result.conflicts?.files).toContain('shared.txt');
    expect(result.conflicts?.head).toBe(result.branch);
    expect(result.steps.find((s) => s.id === 'sync')).toMatchObject({
      status: 'failed',
      detail: 'Merge conflicts with origin/main',
    });
    // Nothing was pushed and no PR was attempted.
    expect(result.pushed).toBeUndefined();
    expect(provider.createPullRequest).not.toHaveBeenCalled();

    // The tree is untouched: no merge in progress, no markers, clean status.
    expect(await baseGitClient.mergeInProgress(work)).toBe(false);
    expect((await git(work, 'status', '--porcelain')).trim()).toBe('');
    expect(await fs.readFile(path.join(work, 'shared.txt'), 'utf-8')).toBe('OURS\nline two\n');
  });

  it('(e) start → continue → abort round-trip on a conflicted merge', async () => {
    const { registry } = fakeProviderPair();
    const flow = makeService(registry);
    await moveBase('shared.txt', 'THEIRS\nline two\n', 'fix: change line one');

    await git(work, 'checkout', '-b', 'feature/conflict');
    await write(work, 'shared.txt', 'OURS\nline two\n');
    await git(work, 'add', '-A');
    await git(work, 'commit', '-m', 'fix: our line one');

    const report = await flow.startConflictMerge({ repoDir: work, alias: '.', base: 'main' });
    expect(report).toMatchObject({ base: 'main', head: 'feature/conflict', mergeStarted: true });
    expect(report.files).toContain('shared.txt');
    expect(await baseGitClient.mergeInProgress(work)).toBe(true);
    expect(await fs.readFile(path.join(work, 'shared.txt'), 'utf-8')).toContain('<<<<<<<');

    // Still conflicted → refuses to commit.
    const blocked = await flow.continueAfterConflicts({ repoDir: work, alias: '.' });
    expect(blocked).toEqual({ ok: false, remaining: ['shared.txt'] });

    // Resolved → commits the merge.
    await write(work, 'shared.txt', 'OURS AND THEIRS\nline two\n');
    const done = await flow.continueAfterConflicts({ repoDir: work, alias: '.' });
    expect(done.ok).toBe(true);
    expect(done.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(done.remaining).toEqual([]);
    expect(await baseGitClient.mergeInProgress(work)).toBe(false);
    expect((await git(work, 'status', '--porcelain')).trim()).toBe('');

    // And abort restores a clean tree from a fresh conflicted merge.
    await moveBase('shared.txt', 'THEIRS AGAIN\nline two\n', 'fix: change line one again');
    const second = await flow.startConflictMerge({ repoDir: work, alias: '.', base: 'main' });
    expect(second.files).toContain('shared.txt');
    await flow.abortConflicts({ repoDir: work, alias: '.' });
    expect(await baseGitClient.mergeInProgress(work)).toBe(false);
    expect(await baseGitClient.isClean(work)).toBe(true);
    expect(await fs.readFile(path.join(work, 'shared.txt'), 'utf-8')).toBe(
      'OURS AND THEIRS\nline two\n',
    );
  });

  it('(e2) a merge from a non-default branch keeps its name through start and continue, whatever the caller guesses', async () => {
    const { registry } = fakeProviderPair();
    const flow = makeService(registry);
    await git(seed, 'checkout', '-b', 'release/2.0');
    await write(seed, 'shared.txt', 'RELEASE\nline two\n');
    await git(seed, 'add', '-A');
    await git(seed, 'commit', '-m', 'fix: release line one');
    await git(seed, 'push', 'origin', 'release/2.0');
    await git(seed, 'checkout', 'main');
    await git(work, 'checkout', '-b', 'feature/rel');
    await write(work, 'shared.txt', 'OURS\nline two\n');
    await git(work, 'add', '-A');
    await git(work, 'commit', '-m', 'fix: our line one');

    await flow.startConflictMerge({ repoDir: work, alias: '.', base: 'release/2.0' });
    // After a restart the client only knows the default branch; the merge in progress still names its source.
    expect(await flow.startConflictMerge({ repoDir: work, alias: '.', base: 'main' })).toMatchObject({ base: 'release/2.0' });
    await write(work, 'shared.txt', 'OURS AND RELEASE\nline two\n');
    expect((await flow.continueAfterConflicts({ repoDir: work, alias: '.', base: 'main' })).ok).toBe(true);
    expect((await git(work, 'log', '-1', '--format=%s')).trim()).toBe('Merge origin/release/2.0 into feature/rel');
  });

  it('(f) reuses an already-open pull request instead of creating one', async () => {
    const { registry, provider } = fakeProviderPair({ existingPr: OPEN_PR });
    const flow = makeService(registry);
    await git(work, 'checkout', '-b', 'feature/reuse');
    await write(work, 'src/f.ts', 'export const f = 1;\n');

    const result = await flow.run({
      repoDir: work,
      alias: '.',
      request: { commit: { message: 'feat: f' }, push: true, pullRequest: {} },
    });

    expect(result.status).toBe('ok');
    expect(result.pullRequest).toEqual(OPEN_PR);
    expect(provider.createPullRequest).not.toHaveBeenCalled();
    expect(result.steps.find((s) => s.id === 'pull_request')).toMatchObject({
      status: 'done',
      detail: 'Reused existing PR #11',
    });
  });

  it('(f2) a plain push to a branch with an open PR reports that PR as updated', async () => {
    const { registry, provider } = fakeProviderPair({ existingPr: OPEN_PR });
    const flow = makeService(registry);
    await git(work, 'checkout', '-b', 'feature/update');
    await write(work, 'src/u.ts', 'export const u = 1;\n');
    await git(work, 'add', '-A');
    await git(work, 'commit', '-m', 'feat: u');
    await git(work, 'push', '-u', 'origin', 'feature/update');
    await write(work, 'src/u.ts', 'export const u = 2;\n');

    const result = await flow.run({ repoDir: work, alias: '.', request: { commit: { message: 'fix: u' }, push: true } });

    expect(result.status).toBe('ok');
    expect(result.pullRequest).toEqual(OPEN_PR);
    expect(provider.createPullRequest).not.toHaveBeenCalled();
    expect(result.steps.find((s) => s.id === 'pull_request')).toMatchObject({ status: 'done', detail: 'Updated PR #11' });
  });

  /** Someone else pushed to the work branch (another machine, GitHub's "Update branch"). */
  async function pushToBranchElsewhere(branch: string, rel: string, content: string): Promise<void> {
    await git(seed, 'fetch', 'origin');
    await git(seed, 'checkout', '-B', branch, `origin/${branch}`);
    await write(seed, rel, content);
    await git(seed, 'add', '-A');
    await git(seed, 'commit', '-m', `edit ${rel} elsewhere`);
    await git(seed, 'push', 'origin', branch);
    await git(seed, 'checkout', 'main');
  }

  it('(k) merges new commits from the branch on the remote before pushing, so the push is not rejected', async () => {
    const { registry } = fakeProviderPair();
    const flow = makeService(registry);
    await git(work, 'checkout', '-b', 'feature/moved');
    await write(work, 'src/a.ts', 'export const a = 1;\n');
    await git(work, 'add', '-A');
    await git(work, 'commit', '-m', 'feat: a');
    await git(work, 'push', '-u', 'origin', 'feature/moved');
    await pushToBranchElsewhere('feature/moved', 'src/b.ts', 'export const b = 1;\n');
    await write(work, 'src/a.ts', 'export const a = 2;\n');

    const result = await flow.run({ repoDir: work, alias: '.', request: { commit: { message: 'fix: a' }, push: true } });

    expect(result.status).toBe('ok');
    expect(result.steps.find((s) => s.id === 'sync')?.detail).toBe('Merged origin/feature/moved');
    expect(await fs.readFile(path.join(work, 'src/b.ts'), 'utf8')).toBe('export const b = 1;\n');
    expect(result.readiness.ahead).toBe(0);
    expect(result.readiness.behind).toBe(0);
  });

  it('(l) a conflicting commit pushed to the remote branch stops at a conflict report naming that branch', async () => {
    const { registry } = fakeProviderPair();
    const flow = makeService(registry);
    await git(work, 'checkout', '-b', 'feature/clash');
    await write(work, 'shared.txt', 'line one\nline two\n');
    await git(work, 'push', '-u', 'origin', 'feature/clash');
    await pushToBranchElsewhere('feature/clash', 'shared.txt', 'line one\nTHEIRS\n');
    await write(work, 'shared.txt', 'line one\nOURS\n');

    const result = await flow.run({ repoDir: work, alias: '.', request: { commit: { message: 'fix: ours' }, push: true } });

    expect(result.status).toBe('conflicts');
    expect(result.conflicts).toMatchObject({ base: 'feature/clash', files: ['shared.txt'] });
    expect(result.steps.at(-1)).toMatchObject({ id: 'sync', status: 'failed', detail: 'Merge conflicts with origin/feature/clash' });
  });

  it('(g) blocks a push in a repo with no remote', async () => {
    const { registry } = fakeProviderPair();
    const flow = makeService(registry);
    const solo = path.join(root, 'solo');
    await fs.mkdir(solo, { recursive: true });
    await execFileAsync('git', ['-c', 'init.defaultBranch=main', 'init', solo]);
    await identify(solo);
    await write(solo, 'a.txt', 'a\n');
    await git(solo, 'add', '-A');
    await git(solo, 'commit', '-m', 'chore: init');
    await write(solo, 'b.txt', 'b\n');

    const result = await flow.run({
      repoDir: solo,
      alias: '.',
      request: { commit: { generate: false }, push: true },
    });

    expect(result.status).toBe('blocked');
    expect(result.steps).toEqual([
      { id: 'readiness', status: 'blocked', detail: 'No git remote configured' },
    ]);
    expect(result.readiness.hasRemote).toBe(false);
    // Nothing was committed.
    expect((await git(solo, 'status', '--porcelain')).trim()).toContain('b.txt');
  });

  it('(h) lists the remote branches for the PR base picker: default first, never the current branch', async () => {
    await git(seed, 'checkout', '-b', 'release/1.0');
    await git(seed, 'push', 'origin', 'release/1.0');
    await git(seed, 'checkout', 'main');
    await git(work, 'checkout', '-b', 'feature/pick');
    const flow = makeService(fakeProviderPair().registry);

    const list = await flow.branches({ repoDir: work, alias: '.' });

    expect(list).toMatchObject({ defaultBranch: 'main', current: 'feature/pick', fresh: true });
    expect(list.branches).toEqual(['main', 'release/1.0']);
  });

  it('(i) compares the branch with its base: commits, files, behind, and conflicts before any push', async () => {
    await git(work, 'checkout', '-b', 'feature/compare');
    await write(work, 'src/b.ts', 'export const b = 2;\n');
    await git(work, 'add', '-A');
    await git(work, 'commit', '-m', 'feat: add b');
    await write(work, 'shared.txt', 'line one CHANGED HERE\nline two\n');
    await git(work, 'add', '-A');
    await git(work, 'commit', '-m', 'fix: our line one');
    await write(work, 'notes.md', 'uncommitted\n');
    const flow = makeService(fakeProviderPair().registry);

    const clean = await flow.compare({ repoDir: work, alias: '.', base: 'main' });
    expect(clean.commits.map((c) => c.subject)).toEqual(['fix: our line one', 'feat: add b']);
    expect(clean.files.map((f) => `${f.status}:${f.path}`)).toEqual(['modified:shared.txt', 'added:src/b.ts']);
    expect(clean).toMatchObject({ behind: 0, uncommittedFiles: 1 });
    expect(clean.mergeable === 'clean' || clean.mergeable === 'unknown').toBe(true);

    await moveBase('shared.txt', 'line one THEIRS\nline two\n', 'fix: their line one');
    const conflicted = await flow.compare({ repoDir: work, alias: '.', base: 'main' });
    expect(conflicted.behind).toBe(1);
    if (conflicted.mergeable !== 'unknown') {
      expect(conflicted.mergeable).toBe('conflicts');
      expect(conflicted.conflictFiles).toEqual(['shared.txt']);
    }
  });

  it('(j) appends "Closes #n" to the PR body and reports metadata the host refused', async () => {
    const pair = fakeProviderPair();
    const addMeta = vi.fn(async () => ['GitHub could not add labels: not found']);
    Object.assign(pair.provider, { addPullRequestMetadata: addMeta });
    const flow = makeService(pair.registry);
    await git(work, 'checkout', '-b', 'feature/meta');
    await write(work, 'src/c.ts', 'export const c = 3;\n');

    const result = await flow.run({
      repoDir: work,
      alias: '.',
      request: {
        commit: { message: 'feat: c' },
        push: true,
        pullRequest: { title: 'Add c', body: 'Adds c.', labels: ['nope'], reviewers: ['ana'], closesIssues: [7, 7, 9] },
      },
    });

    expect(result.status).toBe('ok');
    expect(pair.created[0]).toMatchObject({ body: 'Adds c.\n\nCloses #7\nCloses #9' });
    expect(addMeta).toHaveBeenCalledWith(
      { owner: 'acme', repo: 'web', number: 99, host: expect.anything() },
      { reviewers: ['ana'], labels: ['nope'] },
    );
    expect(result.steps.at(-1)?.detail).toBe('Opened PR #99 · GitHub could not add labels: not found');
  });

  it('skips the commit step on a clean tree without blocking the rest', async () => {
    const { registry } = fakeProviderPair();
    const flow = makeService(registry);
    await git(work, 'checkout', '-b', 'feature/clean');
    await write(work, 'src/x.ts', 'export const x = 1;\n');
    await git(work, 'add', '-A');
    await git(work, 'commit', '-m', 'feat: x');

    const result = await flow.run({
      repoDir: work,
      alias: '.',
      request: { commit: { generate: false }, push: true },
    });

    expect(result.status).toBe('ok');
    expect(result.steps.find((s) => s.id === 'commit')).toMatchObject({
      status: 'skipped',
      detail: 'Nothing to commit',
    });
    expect(result.pushed).toBe(true);
  });

  it('generates commit text from the working diff', async () => {
    const { registry } = fakeProviderPair();
    const flow = makeService(registry);
    await write(work, 'src/gen/a.ts', 'export const a = 1;\n');
    const result = await flow.generate({
      repoDir: work,
      alias: '.',
      request: { kind: 'commit' },
    });
    expect(result).toMatchObject({ kind: 'commit', source: 'heuristic' });
    expect(result.message).toContain('src/gen');
  });

  it('builds an agent conflict prompt with the rules', () => {
    const { registry } = fakeProviderPair();
    const flow = makeService(registry);
    const prompt = flow.buildAgentConflictPrompt({
      base: 'main',
      head: 'feature/x',
      files: ['src/a.ts', 'src/b.ts'],
      mergeStarted: true,
    });
    expect(prompt).toContain('`origin/main`');
    expect(prompt).toContain('`feature/x`');
    expect(prompt).toContain('`src/a.ts`');
    expect(prompt).toContain('`src/b.ts`');
    expect(prompt).toContain('Keep the intent of BOTH sides');
    expect(prompt).toContain('<<<<<<<');
    expect(prompt).toContain('=======');
    expect(prompt).toContain('>>>>>>>');
    expect(prompt).toContain('`git commit`');
    expect(prompt).toContain('`git push`');
    expect(prompt).toContain('`git rebase`');
    expect(prompt).toContain('prefer the incoming base-branch change');
    expect(prompt).toContain('`git show :1:<file>` (ancestor)');
    expect(prompt).toContain('one line per file');
  });
});

describe('slugifyBranchHint', () => {
  it('lowercases, collapses separators and trims', () => {
    expect(slugifyBranchHint('Fix the  FLAKY login test!!')).toBe('fix-the-flaky-login-test');
  });

  it('caps at 32 characters without a trailing dash', () => {
    const slug = slugifyBranchHint('a'.repeat(20) + ' ' + 'b'.repeat(20));
    expect(slug.length).toBeLessThanOrEqual(32);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('falls back to "work" when nothing survives', () => {
    expect(slugifyBranchHint('!!! ???')).toBe('work');
    expect(slugifyBranchHint('')).toBe('work');
  });
});
