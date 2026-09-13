// Integration tests for ChangeSummaryService against real temporary git repos.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { GitClient } from '@generatorai/git';
import type { IGitProcessRunner } from '@generatorai/git';
import type { CheckpointRecord, ILogger } from '@generatorai/shared';
import { ChangeSummaryService, type CheckpointLookup } from '../src/ChangeSummaryService.js';

/** Every git argv the tests have observed, so spawn counts can be asserted. */
const runCalls: string[][] = [];

const realRunner: IGitProcessRunner = {
  run(command, args, options) {
    runCalls.push(args);
    return new Promise((resolve) => {
      const started = Date.now();
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env ? { ...process.env, ...options.env } : process.env,
        shell: false,
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => (stdout += d.toString()));
      child.stderr.on('data', (d) => (stderr += d.toString()));
      child.on('close', (code) =>
        resolve({ exitCode: code ?? 0, stdout, stderr, durationMs: Date.now() - started }),
      );
      child.on('error', (err) =>
        resolve({ exitCode: 1, stdout, stderr: String(err), durationMs: Date.now() - started }),
      );
    });
  },
};

const silentLogger: ILogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as ILogger;

/** Minimal in-memory checkpoint lookup driven directly by the tests. */
class FakeCheckpoints implements CheckpointLookup {
  readonly rows: CheckpointRecord[] = [];

  add(partial: Partial<CheckpointRecord> & { treeSha: string; kind: CheckpointRecord['kind'] }) {
    const record: CheckpointRecord = {
      id: `ck_${this.rows.length + 1}`,
      workspaceId: 'ws',
      repoAlias: '.',
      seq: this.rows.length + 1,
      refKind: 'git_tree',
      refValue: partial.treeSha,
      fileCount: 0,
      additions: 0,
      deletions: 0,
      createdAt: new Date(),
      ...partial,
    } as CheckpointRecord;
    this.rows.push(record);
    return record;
  }

  async getBaseline(workspaceId: string, repoAlias: string) {
    return (
      this.rows.find(
        (r) => r.workspaceId === workspaceId && r.repoAlias === repoAlias && r.kind === 'baseline',
      ) ?? null
    );
  }
  async getById(id: string) {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async getLatest(workspaceId: string, repoAlias: string) {
    return (
      [...this.rows]
        .filter((r) => r.workspaceId === workspaceId && r.repoAlias === repoAlias)
        .sort((a, b) => b.seq - a.seq)[0] ?? null
    );
  }
}

async function removeDirWithRetry(dir: string, attempts = 5): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 150 * (i + 1)));
    }
  }
}

describe('ChangeSummaryService (real git)', () => {
  let tmpRoot: string;
  let repoDir: string;
  let git: GitClient;
  let checkpoints: FakeCheckpoints;
  let service: ChangeSummaryService;

  /** Snapshot the working tree and register it as a checkpoint. */
  async function snapshot(kind: CheckpointRecord['kind'], extra: Partial<CheckpointRecord> = {}) {
    const indexFile = path.join(tmpRoot, `idx-${Math.random().toString(36).slice(2)}`);
    const treeSha = await git.writeTreeFromWorktree(repoDir, indexFile);
    if (!treeSha) throw new Error('snapshot failed');
    return checkpoints.add({ kind, treeSha, ...extra });
  }

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gai-sum-'));
    repoDir = path.join(tmpRoot, 'repo');
    await fs.mkdir(repoDir, { recursive: true });
    git = new GitClient(realRunner, silentLogger, { workspacesDir: tmpRoot });
    await git.initIfNeeded(repoDir);
    checkpoints = new FakeCheckpoints();
    service = new ChangeSummaryService(git, checkpoints, silentLogger);
    runCalls.length = 0;
  });

  afterEach(async () => {
    await removeDirWithRetry(tmpRoot);
  });

  const params = () => ({ workspaceId: 'ws', rootPath: repoDir, autoInit: false });

  it('reports no changes while the working tree cannot be snapshotted, and retries next time', async () => {
    // A new chat's summary is requested while its shadow git store is still
    // being created, so the snapshot's `git add` fails. That used to diff the
    // baseline against nothing — every scaffold file read as deleted — and the
    // failure was cached for the whole TTL.
    await fs.writeFile(path.join(repoDir, 'scaffold.txt'), 'line\n'.repeat(19));
    await snapshot('baseline');

    let failAdds = 1;
    const flakyRunner: IGitProcessRunner = {
      run(command, args, options) {
        if (args.includes('add') && failAdds > 0) {
          failAdds -= 1;
          return Promise.resolve({ exitCode: 128, stdout: '', stderr: 'fatal: not a git repository', durationMs: 1 });
        }
        return realRunner.run(command, args, options);
      },
    };
    const flaky = new ChangeSummaryService(
      new GitClient(flakyRunner, silentLogger, { workspacesDir: tmpRoot }),
      checkpoints,
      silentLogger,
    );

    const first = await flaky.getSummary(params());
    expect(first.repos[0]!.files).toEqual([]);
    expect(first.repos[0]!.stats).toEqual({ files: 0, additions: 0, deletions: 0 });

    await fs.writeFile(path.join(repoDir, 'added.txt'), 'new\n');
    const second = await flaky.getSummary(params());
    expect(second.repos[0]!.files.map((f) => f.path)).toEqual(['added.txt']);
  });

  it('reports per-file stats without shipping any diff text', async () => {
    await fs.writeFile(path.join(repoDir, 'a.txt'), 'one\ntwo\n');
    await snapshot('baseline');

    await fs.writeFile(path.join(repoDir, 'a.txt'), 'one\ntwo\nthree\n');
    await fs.writeFile(path.join(repoDir, 'b.txt'), 'new\n');

    const summary = await service.getSummary(params());
    const repo = summary.repos[0]!;
    const byPath = new Map(repo.files.map((f) => [f.path, f]));

    expect(summary.hasGit).toBe(true);
    expect(byPath.get('a.txt')).toMatchObject({ status: 'modified', additions: 1, deletions: 0 });
    expect(byPath.get('b.txt')).toMatchObject({ status: 'added', additions: 1 });
    // No file in the summary carries content.
    expect(JSON.stringify(repo.files)).not.toContain('three');
    expect(repo.stats.files).toBe(2);
  });

  it('resolves a specific checkpoint as the base (per-turn diff)', async () => {
    await fs.writeFile(path.join(repoDir, 'a.txt'), 'v1\n');
    await snapshot('baseline');

    await fs.writeFile(path.join(repoDir, 'a.txt'), 'v2\n');
    await fs.writeFile(path.join(repoDir, 'turn1.txt'), 'from turn 1\n');
    const turn = await snapshot('turn', { turnId: 't1' });

    await fs.writeFile(path.join(repoDir, 'turn2.txt'), 'from turn 2\n');

    // Everything since the session started.
    const all = await service.getSummary(params());
    expect(all.repos[0]!.files.map((f) => f.path).sort()).toEqual([
      'a.txt',
      'turn1.txt',
      'turn2.txt',
    ]);

    // Only what changed after that turn's checkpoint.
    const sinceTurn = await service.getSummary({
      ...params(),
      base: { kind: 'checkpoint', id: turn.id },
    });
    expect(sinceTurn.repos[0]!.files.map((f) => f.path)).toEqual(['turn2.txt']);
    expect(sinceTurn.base.id).toBe(turn.id);
  });

  it('detects renames instead of reporting add + delete', async () => {    await fs.writeFile(path.join(repoDir, 'old-name.txt'), 'x'.repeat(200) + '\n');
    await snapshot('baseline');

    await fs.rename(
      path.join(repoDir, 'old-name.txt'),
      path.join(repoDir, 'new-name.txt'),
    );

    const summary = await service.getSummary(params());
    const files = summary.repos[0]!.files;
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      path: 'new-name.txt',
      oldPath: 'old-name.txt',
      status: 'renamed',
    });
  });

  it('flags binary files and does not count lines for them', async () => {
    await fs.writeFile(path.join(repoDir, 'seed.txt'), 'seed\n');
    await snapshot('baseline');

    await fs.writeFile(
      path.join(repoDir, 'image.bin'),
      Buffer.from([0x00, 0x01, 0x02, 0xff, 0x00, 0x7f]),
    );

    const summary = await service.getSummary(params());
    const bin = summary.repos[0]!.files.find((f) => f.path === 'image.bin');
    expect(bin).toMatchObject({ isBinary: true, additions: 0, deletions: 0 });
  });

  it('excludes runtime metadata paths from the change list', async () => {
    await fs.writeFile(path.join(repoDir, 'seed.txt'), 'seed\n');
    await snapshot('baseline');

    await fs.mkdir(path.join(repoDir, 'artifacts'), { recursive: true });
    await fs.writeFile(path.join(repoDir, 'artifacts', 'response.md'), '# out\n');
    await fs.writeFile(path.join(repoDir, '.workspace.json'), '{}\n');
    await fs.writeFile(path.join(repoDir, 'real.txt'), 'real\n');

    const summary = await service.getSummary(params());
    const paths = summary.repos[0]!.files.map((f) => f.path);
    expect(paths).toEqual(['real.txt']);
  });

  it('returns both file versions with a blob-pair cache key', async () => {
    await fs.writeFile(path.join(repoDir, 'a.txt'), 'before\n');
    await snapshot('baseline');
    await fs.writeFile(path.join(repoDir, 'a.txt'), 'after\n');

    const versions = await service.getFileVersions({ ...params(), filePath: 'a.txt' });
    expect(versions.old?.contents).toBe('before\n');
    expect(versions.new?.contents).toBe('after\n');
    expect(versions.isBinary).toBe(false);
    expect(versions.cacheKey).toMatch(/^[0-9a-f]{40}:[0-9a-f]{40}$/);
  });

  it('gives added files a null old side (so the renderer shows a pure addition)', async () => {
    await fs.writeFile(path.join(repoDir, 'seed.txt'), 'seed\n');
    await snapshot('baseline');
    await fs.writeFile(path.join(repoDir, 'fresh.txt'), 'brand new\n');

    const versions = await service.getFileVersions({ ...params(), filePath: 'fresh.txt' });
    expect(versions.old).toBeNull();
    expect(versions.new?.contents).toBe('brand new\n');
    expect(versions.cacheKey.startsWith('none:')).toBe(true);
  });

  // ── Known-blob fast path ──
  //
  // The client hands back the blob SHAs it learned from the summary so the
  // service can read those objects directly instead of re-deriving them.
  // That is the difference between ~9 git subprocesses and ~1, and on
  // Windows a spawn costs ~500ms — the whole reason opening a file used to
  // take seconds.

  it('returns identical content whether or not the blob SHAs are supplied', async () => {
    await fs.writeFile(path.join(repoDir, 'a.txt'), 'before\n');
    await snapshot('baseline');
    await fs.writeFile(path.join(repoDir, 'a.txt'), 'after\n');

    const derived = await service.getFileVersions({ ...params(), filePath: 'a.txt' });
    const [oldSha, newSha] = derived.cacheKey.split(':') as [string, string];

    const fast = await service.getFileVersions({
      ...params(),
      filePath: 'a.txt',
      blobs: { old: oldSha, new: newSha },
    });

    expect(fast.old?.contents).toBe(derived.old?.contents);
    expect(fast.new?.contents).toBe(derived.new?.contents);
    expect(fast.cacheKey).toBe(derived.cacheKey);
  });

  it('falls back to deriving when a supplied blob no longer exists', async () => {
    await fs.writeFile(path.join(repoDir, 'a.txt'), 'before\n');
    await snapshot('baseline');
    await fs.writeFile(path.join(repoDir, 'a.txt'), 'after\n');

    // Well-formed but absent: the fast path must not report the side as
    // empty, because that would silently render a wrong diff.
    const versions = await service.getFileVersions({
      ...params(),
      filePath: 'a.txt',
      blobs: { old: '0'.repeat(40), new: '1'.repeat(40) },
    });

    expect(versions.old?.contents).toBe('before\n');
    expect(versions.new?.contents).toBe('after\n');
  });

  it('serves the head side from the working tree without spawning git', async () => {
    await fs.writeFile(path.join(repoDir, 'seed.txt'), 'seed\n');
    await snapshot('baseline');
    await fs.writeFile(path.join(repoDir, 'fresh.txt'), 'on disk\n');

    const derived = await service.getFileVersions({ ...params(), filePath: 'fresh.txt' });
    const newSha = derived.cacheKey.split(':')[1]!;

    const spawnsBefore = runCalls.length;
    const fast = await service.getFileVersions({
      ...params(),
      filePath: 'fresh.txt',
      blobs: { new: newSha },
    });

    expect(fast.new?.contents).toBe('on disk\n');
    // Only repo discovery is allowed to shell out here; reading the content
    // itself must come from disk, verified by hashing rather than trusted.
    const catFiles = runCalls
      .slice(spawnsBefore)
      .filter((c) => c.includes('cat-file'));
    expect(catFiles).toHaveLength(0);
  });

  it('orders files the way a file tree does, not by raw path string', async () => {
    await fs.writeFile(path.join(repoDir, 'seed.txt'), 'seed\n');
    await snapshot('baseline');

    await fs.mkdir(path.join(repoDir, 'src', 'api'), { recursive: true });
    await fs.mkdir(path.join(repoDir, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repoDir, 'src', 'index.ts'), 'a\n');
    await fs.writeFile(path.join(repoDir, 'src', 'api', 'routes.ts'), 'b\n');
    await fs.writeFile(path.join(repoDir, 'docs', 'guide.md'), 'c\n');
    await fs.writeFile(path.join(repoDir, 'package.json'), '{}\n');

    const summary = await service.getSummary(params());
    const paths = summary.repos[0]!.files.map((f) => f.path);

    // Directories before files at every level, each group alphabetical —
    // exactly what the tree renders. A plain string sort would interleave
    // `package.json` between the two directories (because `/` < most name
    // characters) and put `src/index.ts` before `src/api/routes.ts`.
    // `seed.txt` is in the baseline and unmodified, so it is not a change.
    expect(paths).toEqual([
      'docs/guide.md',
      'src/api/routes.ts',
      'src/index.ts',
      'package.json',
    ]);
  });

  it('produces a unified patch for one file only', async () => {
    await fs.writeFile(path.join(repoDir, 'a.txt'), 'one\n');
    await fs.writeFile(path.join(repoDir, 'b.txt'), 'untouched\n');
    await snapshot('baseline');
    await fs.writeFile(path.join(repoDir, 'a.txt'), 'two\n');
    await fs.writeFile(path.join(repoDir, 'b.txt'), 'changed too\n');

    const result = await service.getFilePatch({ ...params(), filePath: 'a.txt' });
    expect(result.patch).toContain('-one');
    expect(result.patch).toContain('+two');
    expect(result.patch).not.toContain('changed too');
    expect(result.truncated).toBe(false);
  });

  it('falls back to the first commit when no baseline checkpoint exists', async () => {
    await fs.writeFile(path.join(repoDir, 'a.txt'), 'v1\n');
    await git.commit(repoDir, 'initial');
    await fs.writeFile(path.join(repoDir, 'a.txt'), 'v2\n');

    // No checkpoints registered at all.
    const summary = await service.getSummary(params());
    expect(summary.base.label).toBe('First commit');
    expect(summary.repos[0]!.files.map((f) => f.path)).toContain('a.txt');
  });

  it('a commit base against a CRLF checkout reports only real edits (EOL-normalised working tree)', async () => {
    // Windows default: files are checked out with CRLF while the commit's
    // blobs are LF. Snapshots are byte-exact (autocrlf off), so diffing one
    // against a real commit used to mark every line of every file changed.
    const g = (...args: string[]) =>
      realRunner.run('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repoDir, timeout: 15_000 });
    await g('config', 'core.autocrlf', 'true');
    await fs.writeFile(path.join(repoDir, 'a.txt'), 'one\r\r\ntwo\r\r\n');
    await fs.writeFile(path.join(repoDir, 'b.txt'), 'x\r\r\n');
    await g('add', '-A');
    await g('commit', '-q', '-m', 'initial');
    await fs.writeFile(path.join(repoDir, 'b.txt'), 'x\r\r\ny\r\r\n');

    const summary = await service.getSummary({ ...params(), base: { kind: 'ref', id: 'HEAD' } });
    expect(summary.base.normalized).toBe(true);
    expect(summary.repos[0]!.files.map((f) => f.path)).toEqual(['b.txt']);
    expect(summary.repos[0]!.files[0]).toMatchObject({ additions: 1, deletions: 0 });
  });

  it('reports each repo\'s OWN base and head, not just the first repo\'s', async () => {
    // Two mounts: one with a checkpoint baseline, one with only a commit.
    // The response-level `base` describes the first; `repos[].base` is what
    // a per-file action has to read, and it differs per mount.
    const second = path.join(tmpRoot, 'second');
    await fs.mkdir(second, { recursive: true });
    await git.initIfNeeded(second);
    await fs.writeFile(path.join(second, 's.txt'), 'v1\n');
    await git.commit(second, 'initial');
    await fs.writeFile(path.join(second, 's.txt'), 'v2\n');

    await fs.writeFile(path.join(repoDir, 'a.txt'), 'a1\n');
    await snapshot('baseline');
    await fs.writeFile(path.join(repoDir, 'a.txt'), 'a2\n');

    const summary = await service.getSummary({
      ...params(),
      mounts: [
        { alias: '.', path: repoDir },
        { alias: 'second', path: second },
      ],
    });

    const root = summary.repos.find((r) => r.alias === '.')!;
    const other = summary.repos.find((r) => r.alias === 'second')!;
    expect(root.base.label).toBe('Session start');
    expect(root.base.id).toBeDefined();
    // The second mount never had a baseline captured, so it anchors on its
    // own HEAD — a revision the top-level `base` knows nothing about, and one
    // with no checkpoint id at all (which is exactly what used to make the
    // per-file discard unavailable there).
    expect(other.base.label).toBe('Worktree HEAD');
    expect(other.base.id).toBeUndefined();
    expect(other.base.normalized).toBe(true);
    expect(other.base.treeish).toBeDefined();
    expect(other.base.treeish).not.toBe(root.base.treeish);
    for (const repo of summary.repos) expect(repo.head.kind).toBe('working');
  });

  it('marks the first-commit fallback normalized, so a CRLF checkout is not all-changed', async () => {
    const g = (...args: string[]) =>
      realRunner.run('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repoDir, timeout: 15_000 });
    await g('config', 'core.autocrlf', 'true');
    await fs.writeFile(path.join(repoDir, 'a.txt'), 'one\r\r\ntwo\r\r\n');
    await fs.writeFile(path.join(repoDir, 'b.txt'), 'x\r\r\n');
    await g('add', '-A');
    await g('commit', '-q', '-m', 'initial');
    await fs.writeFile(path.join(repoDir, 'b.txt'), 'x\r\r\ny\r\r\n');

    // No checkpoints at all: the base falls back to the first commit, which
    // is a real commit and so EOL-normalised like any other.
    const summary = await service.getSummary(params());
    expect(summary.base.label).toBe('First commit');
    expect(summary.base.normalized).toBe(true);
    expect(summary.repos[0]!.files.map((f) => f.path)).toEqual(['b.txt']);
  });

  it('reads one file the same way the summary counted it (EOL parity)', async () => {
    const g = (...args: string[]) =>
      realRunner.run('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repoDir, timeout: 15_000 });
    await g('config', 'core.autocrlf', 'true');
    await fs.writeFile(path.join(repoDir, 'a.txt'), 'one\r\r\ntwo\r\r\n');
    await g('add', '-A');
    await g('commit', '-q', '-m', 'initial');

    const base = { kind: 'ref' as const, id: 'HEAD' };
    // Untouched file against a commit base: the summary reports no change, so
    // the per-file read must agree rather than showing a full rewrite.
    const summary = await service.getSummary({ ...params(), base });
    expect(summary.repos[0]!.files).toEqual([]);

    const versions = await service.getFileVersions({ ...params(), base, filePath: 'a.txt' });
    const [oldSha, newSha] = versions.cacheKey.split(':');
    expect(oldSha).toBe(newSha);

    const patch = await service.getFilePatch({ ...params(), base, filePath: 'a.txt' });
    expect(patch.patch).toBe('');
  });

  it('looks the base side of a renamed file up under its old path', async () => {
    await fs.writeFile(path.join(repoDir, 'old-name.txt'), 'x'.repeat(200) + '\n');
    await snapshot('baseline');
    await fs.rename(path.join(repoDir, 'old-name.txt'), path.join(repoDir, 'new-name.txt'));

    // Without `oldPath` the base lookup misses and the rename reads as a
    // pure addition — no old side at all.
    const blind = await service.getFileVersions({ ...params(), filePath: 'new-name.txt' });
    expect(blind.old).toBeNull();

    const versions = await service.getFileVersions({
      ...params(),
      filePath: 'new-name.txt',
      oldPath: 'old-name.txt',
    });
    expect(versions.old?.contents).toBe('x'.repeat(200) + '\n');
    expect(versions.new?.contents).toBe('x'.repeat(200) + '\n');

    const patch = await service.getFilePatch({
      ...params(),
      filePath: 'new-name.txt',
      oldPath: 'old-name.txt',
    });
    expect(patch.patch).toContain('old-name.txt');
    expect(patch.patch).toContain('new-name.txt');
  });

  it('includes the full path list only when the tree view asks for it', async () => {
    await fs.writeFile(path.join(repoDir, 'a.txt'), 'a\n');
    await fs.mkdir(path.join(repoDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(repoDir, 'src', 'b.ts'), 'export {}\n');
    await snapshot('baseline');

    const without = await service.getSummary(params());
    expect(without.repos[0]!.paths).toBeUndefined();

    const withTree = await service.getSummary({ ...params(), includeTree: true });
    expect(withTree.repos[0]!.paths).toEqual(
      expect.arrayContaining(['a.txt', 'src/b.ts']),
    );
  });

  it('detects the language for syntax highlighting', async () => {
    await fs.writeFile(path.join(repoDir, 'seed.txt'), 'seed\n');
    await snapshot('baseline');
    await fs.writeFile(path.join(repoDir, 'app.ts'), 'export const x = 1;\n');
    await fs.writeFile(path.join(repoDir, 'Dockerfile'), 'FROM node:22\n');

    const summary = await service.getSummary(params());
    const byPath = new Map(summary.repos[0]!.files.map((f) => [f.path, f]));
    expect(byPath.get('app.ts')?.lang).toBe('typescript');
    expect(byPath.get('Dockerfile')?.lang).toBe('dockerfile');
  });

  it('handles deleted files (no new side, no working blob)', async () => {
    await fs.writeFile(path.join(repoDir, 'gone.txt'), 'bye\n');
    await snapshot('baseline');
    await fs.rm(path.join(repoDir, 'gone.txt'));

    const summary = await service.getSummary(params());
    const file = summary.repos[0]!.files.find((f) => f.path === 'gone.txt');
    expect(file).toMatchObject({ status: 'deleted', deletions: 1 });

    const versions = await service.getFileVersions({ ...params(), filePath: 'gone.txt' });
    expect(versions.old?.contents).toBe('bye\n');
    expect(versions.new).toBeNull();
  });

  it('returns an empty summary for a workspace with no repos', async () => {
    const emptyDir = path.join(tmpRoot, 'empty');
    await fs.mkdir(emptyDir, { recursive: true });

    const summary = await service.getSummary({
      workspaceId: 'ws',
      rootPath: emptyDir,
      autoInit: false,
    });
    expect(summary.hasGit).toBe(false);
    expect(summary.repos).toEqual([]);
    expect(summary.stats.files).toBe(0);
  });
});
