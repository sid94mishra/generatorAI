// Integration tests for CheckpointService against real temporary git repos.
//
// Windows note: git holds brief file handles, so cleanup retries and
// `fileParallelism: false` (see vitest.config.ts) are load-bearing.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { GitClient } from '@generatorai/git';
import type { IGitProcessRunner } from '@generatorai/git';
import type { CheckpointFilters, CheckpointRecord, ILogger } from '@generatorai/shared';
import { CheckpointService } from '../src/CheckpointService.js';
import { GitShadowRefStore, checkpointRefName } from '../src/GitShadowRefStore.js';
import type { ICheckpointRepository } from '../src/ports/ICheckpointRepository.js';

// ── Test doubles ──

const realRunner: IGitProcessRunner = {
  run(command, args, options) {
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

class InMemoryCheckpointRepository implements ICheckpointRepository {
  readonly rows: CheckpointRecord[] = [];

  async create(record: CheckpointRecord): Promise<void> {
    this.rows.push(record);
  }
  async findById(id: string): Promise<CheckpointRecord | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async list(filters: CheckpointFilters): Promise<CheckpointRecord[]> {
    return this.rows
      .filter((r) => r.workspaceId === filters.workspaceId)
      .filter((r) => (filters.repoAlias ? r.repoAlias === filters.repoAlias : true))
      .filter((r) => (filters.kinds?.length ? filters.kinds.includes(r.kind) : true))
      .filter((r) => (filters.excludeLive === false ? true : r.kind !== 'live'))
      .sort((a, b) => b.seq - a.seq)
      .slice(0, filters.limit ?? 200);
  }
  async findLatest(workspaceId: string, repoAlias: string): Promise<CheckpointRecord | null> {
    return (
      this.rows
        .filter((r) => r.workspaceId === workspaceId && r.repoAlias === repoAlias)
        .sort((a, b) => b.seq - a.seq)[0] ?? null
    );
  }
  async maxSeq(workspaceId: string, repoAlias: string): Promise<number> {
    return this.rows
      .filter((r) => r.workspaceId === workspaceId && r.repoAlias === repoAlias)
      .reduce((max, r) => Math.max(max, r.seq), 0);
  }
  async findByTurn(workspaceId: string, turnId: string): Promise<CheckpointRecord[]> {
    return this.rows.filter((r) => r.workspaceId === workspaceId && r.turnId === turnId);
  }
  async findByStageRun(workspaceId: string, stageRunId: string): Promise<CheckpointRecord[]> {
    return this.rows.filter((r) => r.workspaceId === workspaceId && r.stageRunId === stageRunId);
  }
  async delete(id: string): Promise<void> {
    const idx = this.rows.findIndex((r) => r.id === id);
    if (idx >= 0) this.rows.splice(idx, 1);
  }
  async deleteByWorkspace(workspaceId: string): Promise<void> {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      if (this.rows[i]!.workspaceId === workspaceId) this.rows.splice(i, 1);
    }
  }
}

// ── Helpers ──

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

// ── Suite ──

describe('CheckpointService (real git)', () => {
  let tmpRoot: string;
  let repoDir: string;
  let git: GitClient;
  let store: GitShadowRefStore;
  let repo: InMemoryCheckpointRepository;
  let service: CheckpointService;

  const WORKSPACE_ID = 'ws_test';

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gai-ckpt-'));
    repoDir = path.join(tmpRoot, 'repo');
    await fs.mkdir(repoDir, { recursive: true });

    git = new GitClient(realRunner, silentLogger, { workspacesDir: tmpRoot });
    store = new GitShadowRefStore(git, silentLogger);
    repo = new InMemoryCheckpointRepository();
    service = new CheckpointService(store, repo, git, silentLogger);
  });

  afterEach(async () => {
    await removeDirWithRetry(tmpRoot);
  });

  it('git-inits a plain directory and captures a baseline', async () => {
    await fs.writeFile(path.join(repoDir, 'a.txt'), 'hello\n');

    const cp = await service.create({
      workspaceId: WORKSPACE_ID,
      repoDir,
      kind: 'baseline',
    });

    expect(cp).not.toBeNull();
    expect(cp!.kind).toBe('baseline');
    expect(cp!.seq).toBe(1);
    expect(cp!.treeSha).toMatch(/^[0-9a-f]{40}$/);
    expect(cp!.fileCount).toBeGreaterThanOrEqual(1);
    expect(await git.isGitRepo(repoDir)).toBe(true);
  });

  it('does not touch HEAD, the index or branches', async () => {
    await fs.writeFile(path.join(repoDir, 'a.txt'), 'hello\n');
    await service.create({ workspaceId: WORKSPACE_ID, repoDir, kind: 'baseline' });

    // No commits on HEAD → rev-parse HEAD must still fail.
    expect(await git.revParse(repoDir, 'HEAD')).toBeNull();
    // Working tree still reports the file as untracked.
    expect(await git.getStatus(repoDir)).toContain('a.txt');
    // The snapshot lives under the private namespace only.
    const refs = await git.listRefs(repoDir, 'refs/generatorai/');
    expect(refs.length).toBe(1);
    expect(refs[0]!.ref).toContain('refs/generatorai/checkpoints/');
  });

  it('skips a capture when nothing changed', async () => {
    await fs.writeFile(path.join(repoDir, 'a.txt'), 'hello\n');
    const first = await service.create({ workspaceId: WORKSPACE_ID, repoDir, kind: 'baseline' });
    const second = await service.create({ workspaceId: WORKSPACE_ID, repoDir, kind: 'turn' });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('captures a new checkpoint after an edit and links the parent', async () => {
    await fs.writeFile(path.join(repoDir, 'a.txt'), 'hello\n');
    const base = await service.create({ workspaceId: WORKSPACE_ID, repoDir, kind: 'baseline' });

    await fs.writeFile(path.join(repoDir, 'a.txt'), 'hello\nworld\n');
    const turn = await service.create({
      workspaceId: WORKSPACE_ID,
      repoDir,
      kind: 'turn',
      turnId: 'turn_1',
      promptExcerpt: 'add a line',
    });

    expect(turn).not.toBeNull();
    expect(turn!.parentId).toBe(base!.id);
    expect(turn!.seq).toBe(2);
    expect(turn!.additions).toBe(1);
    expect(turn!.turnId).toBe('turn_1');
  });

  it('diffs two checkpoints with per-file stats and rename detection', async () => {
    await fs.writeFile(path.join(repoDir, 'a.txt'), 'one\ntwo\nthree\n');
    const base = await service.create({ workspaceId: WORKSPACE_ID, repoDir, kind: 'baseline' });

    await fs.writeFile(path.join(repoDir, 'a.txt'), 'one\ntwo\nthree\nfour\n');
    await fs.writeFile(path.join(repoDir, 'b.txt'), 'new file\n');
    const head = await service.create({ workspaceId: WORKSPACE_ID, repoDir, kind: 'turn' });

    const files = await service.diffTrees(repoDir, base!.treeSha, head!.treeSha);
    const byPath = new Map(files.map((f) => [f.path, f]));

    expect(byPath.get('a.txt')).toMatchObject({ status: 'modified', additions: 1, deletions: 0 });
    expect(byPath.get('b.txt')).toMatchObject({ status: 'added', additions: 1 });
  });

  it('produces a unified patch for a single file', async () => {
    await fs.writeFile(path.join(repoDir, 'a.txt'), 'one\n');
    const base = await service.create({ workspaceId: WORKSPACE_ID, repoDir, kind: 'baseline' });
    await fs.writeFile(path.join(repoDir, 'a.txt'), 'two\n');
    const head = await service.create({ workspaceId: WORKSPACE_ID, repoDir, kind: 'turn' });

    const patch = await service.patchForFile(repoDir, base!.treeSha, head!.treeSha, 'a.txt');
    expect(patch).toContain('diff --git');
    expect(patch).toContain('-one');
    expect(patch).toContain('+two');
  });

  it('reads a file at a specific checkpoint', async () => {
    await fs.writeFile(path.join(repoDir, 'a.txt'), 'original\n');
    const base = await service.create({ workspaceId: WORKSPACE_ID, repoDir, kind: 'baseline' });
    await fs.writeFile(path.join(repoDir, 'a.txt'), 'changed\n');

    const content = await service.readFileAt(repoDir, base!.treeSha, 'a.txt');
    expect(content).toBe('original\n');
  });

  it('restores modified, deleted and newly-created files', async () => {
    await fs.writeFile(path.join(repoDir, 'keep.txt'), 'keep\n');
    await fs.writeFile(path.join(repoDir, 'edited.txt'), 'v1\n');
    await fs.writeFile(path.join(repoDir, 'removed.txt'), 'bye\n');
    const base = await service.create({ workspaceId: WORKSPACE_ID, repoDir, kind: 'baseline' });

    // Simulate agent activity.
    await fs.writeFile(path.join(repoDir, 'edited.txt'), 'v2\n');
    await fs.rm(path.join(repoDir, 'removed.txt'));
    await fs.mkdir(path.join(repoDir, 'nested'), { recursive: true });
    await fs.writeFile(path.join(repoDir, 'nested', 'created.txt'), 'brand new\n');

    const result = await service.restore(base!, repoDir);

    expect(result.preRestoreCheckpointId).not.toBeNull();
    expect(await fs.readFile(path.join(repoDir, 'edited.txt'), 'utf-8')).toBe('v1\n');
    expect(await fs.readFile(path.join(repoDir, 'removed.txt'), 'utf-8')).toBe('bye\n');
    await expect(fs.access(path.join(repoDir, 'nested', 'created.txt'))).rejects.toThrow();
    expect(await fs.readFile(path.join(repoDir, 'keep.txt'), 'utf-8')).toBe('keep\n');
  });

  it('restore is undoable via the pre-restore checkpoint', async () => {
    await fs.writeFile(path.join(repoDir, 'a.txt'), 'v1\n');
    const base = await service.create({ workspaceId: WORKSPACE_ID, repoDir, kind: 'baseline' });
    await fs.writeFile(path.join(repoDir, 'a.txt'), 'v2\n');
    await service.create({ workspaceId: WORKSPACE_ID, repoDir, kind: 'turn' });

    const undo = await service.restore(base!, repoDir);
    expect(await fs.readFile(path.join(repoDir, 'a.txt'), 'utf-8')).toBe('v1\n');

    const pre = await repo.findById(undo.preRestoreCheckpointId!);
    await service.restore(pre!, repoDir);
    expect(await fs.readFile(path.join(repoDir, 'a.txt'), 'utf-8')).toBe('v2\n');
  });

  it('restores from a plain commit, for mounts whose base is not a checkpoint', async () => {
    // The case the per-file discard could never serve: a git folder mounted
    // in place, whose "base" is its own HEAD commit rather than any
    // checkpoint row. `restoreFromRevision` takes the commit directly.
    const g = (...args: string[]) =>
      realRunner.run('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
        cwd: repoDir,
        timeout: 15_000,
      });
    await g('init', '-q');
    await fs.writeFile(path.join(repoDir, 'a.txt'), 'v1\n');
    await fs.writeFile(path.join(repoDir, 'b.txt'), 'keep\n');
    await g('add', '-A');
    await g('commit', '-q', '-m', 'initial');
    const head = (await git.revParse(repoDir, 'HEAD'))!;
    expect(head).toBeTruthy();

    await fs.writeFile(path.join(repoDir, 'a.txt'), 'v2\n');
    await fs.writeFile(path.join(repoDir, 'b.txt'), 'touched\n');
    await fs.writeFile(path.join(repoDir, 'extra.txt'), 'new file\n');

    // Scoped to one path: the other edits must survive untouched, which is
    // what makes this usable as a per-file "Undo".
    const result = await service.restoreFromRevision(
      WORKSPACE_ID,
      '.',
      repoDir,
      head,
      ['a.txt'],
      'Worktree HEAD',
    );

    expect(result.restoredPaths).toEqual(['a.txt']);
    expect(await fs.readFile(path.join(repoDir, 'a.txt'), 'utf-8')).toBe('v1\n');
    expect(await fs.readFile(path.join(repoDir, 'b.txt'), 'utf-8')).toBe('touched\n');
    expect(await fs.readFile(path.join(repoDir, 'extra.txt'), 'utf-8')).toBe('new file\n');

    // Undoable in turn, exactly like a checkpoint restore.
    const pre = await repo.findById(result.preRestoreCheckpointId!);
    expect(pre?.kind).toBe('pre_restore');
    expect(pre?.label).toBe('Before rewind to Worktree HEAD');
    await service.restore(pre!, repoDir);
    expect(await fs.readFile(path.join(repoDir, 'a.txt'), 'utf-8')).toBe('v2\n');
  });

  it('restoring from a revision deletes files the revision never had', async () => {
    const g = (...args: string[]) =>
      realRunner.run('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
        cwd: repoDir,
        timeout: 15_000,
      });
    await g('init', '-q');
    await fs.writeFile(path.join(repoDir, 'a.txt'), 'v1\n');
    await g('add', '-A');
    await g('commit', '-q', '-m', 'initial');
    const head = (await git.revParse(repoDir, 'HEAD'))!;

    await fs.writeFile(path.join(repoDir, 'added.txt'), 'agent wrote this\n');

    const result = await service.restoreFromRevision(WORKSPACE_ID, '.', repoDir, head);
    expect(result.deletedPaths).toContain('added.txt');
    await expect(fs.access(path.join(repoDir, 'added.txt'))).rejects.toThrow();
  });

  it('round-trips line endings byte-exactly (no autocrlf rewriting)', async () => {
    // Regression: with the user's global `core.autocrlf=true` (the Windows
    // default), `add` normalises CRLF→LF and `checkout-index` re-expands
    // LF→CRLF, so a restore would silently rewrite every line ending.
    const lf = 'alpha\nbeta\n';
    const crlf = 'alpha\r\nbeta\r\n';
    await fs.writeFile(path.join(repoDir, 'lf.txt'), lf);
    await fs.writeFile(path.join(repoDir, 'crlf.txt'), crlf);
    const base = await service.create({ workspaceId: WORKSPACE_ID, repoDir, kind: 'baseline' });

    await fs.writeFile(path.join(repoDir, 'lf.txt'), 'changed\n');
    await fs.writeFile(path.join(repoDir, 'crlf.txt'), 'changed\r\n');
    await service.restore(base!, repoDir);

    expect(await fs.readFile(path.join(repoDir, 'lf.txt'), 'utf-8')).toBe(lf);
    expect(await fs.readFile(path.join(repoDir, 'crlf.txt'), 'utf-8')).toBe(crlf);
  });

  it('restores binary files without corruption', async () => {
    const bytes = Buffer.from([0x00, 0x01, 0x0d, 0x0a, 0xff, 0x7f, 0x00, 0x1a]);
    await fs.writeFile(path.join(repoDir, 'blob.bin'), bytes);
    const base = await service.create({ workspaceId: WORKSPACE_ID, repoDir, kind: 'baseline' });

    await fs.writeFile(path.join(repoDir, 'blob.bin'), Buffer.from([0xaa, 0xbb]));
    await service.restore(base!, repoDir);

    const restored = await fs.readFile(path.join(repoDir, 'blob.bin'));
    expect(Buffer.compare(restored, bytes)).toBe(0);
  });

  it('captures files written outside the agent edit tools (bash/external)', async () => {
    await fs.writeFile(path.join(repoDir, 'a.txt'), 'v1\n');
    const base = await service.create({ workspaceId: WORKSPACE_ID, repoDir, kind: 'baseline' });

    // Simulates `rm` / `mv` run through a shell — invisible to editor-level
    // checkpointing, but fully captured by a working-tree snapshot.
    await fs.rm(path.join(repoDir, 'a.txt'));
    await fs.writeFile(path.join(repoDir, 'b.txt'), 'moved\n');
    const head = await service.create({ workspaceId: WORKSPACE_ID, repoDir, kind: 'turn' });

    const files = await service.diffTrees(repoDir, base!.treeSha, head!.treeSha);
    const paths = files.map((f) => f.path).sort();
    expect(paths).toContain('b.txt');
    expect(files.some((f) => f.status === 'deleted' || f.status === 'renamed')).toBe(true);
  });

  it('respects .gitignore so build output never enters a snapshot', async () => {
    await fs.writeFile(path.join(repoDir, '.gitignore'), 'node_modules/\n');
    await fs.mkdir(path.join(repoDir, 'node_modules', 'pkg'), { recursive: true });
    await fs.writeFile(path.join(repoDir, 'node_modules', 'pkg', 'index.js'), 'x\n');
    await fs.writeFile(path.join(repoDir, 'src.txt'), 'code\n');

    const cp = await service.create({ workspaceId: WORKSPACE_ID, repoDir, kind: 'baseline' });
    const files = await service.diffTrees(repoDir, '4b825dc642cb6eb9a060e54bf8d69288fbee4904', cp!.treeSha);
    expect(files.some((f) => f.path.startsWith('node_modules/'))).toBe(false);
    expect(files.some((f) => f.path === 'src.txt')).toBe(true);
  });

  it('serialises concurrent captures without producing duplicate seqs', async () => {
    await fs.writeFile(path.join(repoDir, 'a.txt'), 'v0\n');
    await service.create({ workspaceId: WORKSPACE_ID, repoDir, kind: 'baseline' });

    const results = await Promise.all([
      (async () => {
        await fs.writeFile(path.join(repoDir, 'c1.txt'), '1\n');
        return service.create({ workspaceId: WORKSPACE_ID, repoDir, kind: 'turn' });
      })(),
      (async () => {
        await fs.writeFile(path.join(repoDir, 'c2.txt'), '2\n');
        return service.create({ workspaceId: WORKSPACE_ID, repoDir, kind: 'turn' });
      })(),
    ]);

    const created = results.filter((r): r is CheckpointRecord => r !== null);
    const seqs = created.map((c) => c.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it('prunes past retention but always keeps the baseline', async () => {
    const pruningService = new CheckpointService(store, repo, git, silentLogger, {
      retention: { maxPerRepo: 2, maxAgeDays: 30, liveMaxAgeMinutes: 60 },
    });

    await fs.writeFile(path.join(repoDir, 'a.txt'), 'v0\n');
    await pruningService.create({ workspaceId: WORKSPACE_ID, repoDir, kind: 'baseline' });
    for (let i = 1; i <= 4; i++) {
      await fs.writeFile(path.join(repoDir, 'a.txt'), `v${i}\n`);
      await pruningService.create({ workspaceId: WORKSPACE_ID, repoDir, kind: 'turn' });
    }

    const pruned = await pruningService.prune(WORKSPACE_ID, repoDir);
    expect(pruned).toBe(2);

    const remaining = await repo.list({ workspaceId: WORKSPACE_ID, excludeLive: false });
    expect(remaining.some((c) => c.kind === 'baseline')).toBe(true);
    expect(remaining.filter((c) => c.kind === 'turn').length).toBe(2);
  });

  it('drops the private ref when a checkpoint is pruned', async () => {
    const pruningService = new CheckpointService(store, repo, git, silentLogger, {
      retention: { maxPerRepo: 1, maxAgeDays: 30, liveMaxAgeMinutes: 60 },
    });
    await fs.writeFile(path.join(repoDir, 'a.txt'), 'v0\n');
    await pruningService.create({ workspaceId: WORKSPACE_ID, repoDir, kind: 'baseline' });
    await fs.writeFile(path.join(repoDir, 'a.txt'), 'v1\n');
    const doomed = await pruningService.create({
      workspaceId: WORKSPACE_ID,
      repoDir,
      kind: 'turn',
    });
    await fs.writeFile(path.join(repoDir, 'a.txt'), 'v2\n');
    await pruningService.create({ workspaceId: WORKSPACE_ID, repoDir, kind: 'turn' });

    await pruningService.prune(WORKSPACE_ID, repoDir);

    const refs = await git.listRefs(repoDir, 'refs/generatorai/');
    const doomedRef = checkpointRefName(WORKSPACE_ID, doomed!.repoAlias, doomed!.seq);
    expect(refs.some((r) => r.ref === doomedRef)).toBe(false);
  });

  it('keeps checkpoints for multiple repo aliases independent', async () => {
    const otherDir = path.join(tmpRoot, 'frontend');
    await fs.mkdir(otherDir, { recursive: true });
    await fs.writeFile(path.join(repoDir, 'a.txt'), 'root\n');
    await fs.writeFile(path.join(otherDir, 'b.txt'), 'fe\n');

    const root = await service.create({ workspaceId: WORKSPACE_ID, repoDir, kind: 'baseline' });
    const fe = await service.create({
      workspaceId: WORKSPACE_ID,
      repoDir: otherDir,
      repoAlias: 'frontend',
      kind: 'baseline',
    });

    expect(root!.repoAlias).toBe('.');
    expect(fe!.repoAlias).toBe('frontend');
    expect(root!.seq).toBe(1);
    expect(fe!.seq).toBe(1);
    expect(await service.getLatest(WORKSPACE_ID, 'frontend')).toMatchObject({ id: fe!.id });
  });
});
