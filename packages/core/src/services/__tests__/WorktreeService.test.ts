// ────────────────────────────────────────────────────────────────
// WorktreeService — removal + orphan sweep
//
// `cleanupOrphanedWorktrees` used to `fs.rm` a stale worktree and delete its
// row without ever telling the parent clone, so the "cleanup" was itself an
// orphan generator: every sweep left another dangling entry in
// `git worktree list` that nothing would ever prune (P0-e).
// `removeWorktree` deleted the row even when `fs.rm` failed, permanently
// orphaning the directory it had just failed to delete.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as realFs from 'node:fs/promises';
import type { ProjectCodebase, WorktreeInfo, WorktreeStatus, ILogger } from '@generatorai/shared';
import type { IWorktreeRepository, IProjectCodebaseRepository } from '../../domain/ports/index.js';

const rmControl = vi.hoisted(() => ({ failFor: null as string | null }));
vi.mock('node:fs/promises', async (importOriginal) => {
  // `typeof realFs` rather than an inline `typeof import(...)`: the inline
  // form is what `consistent-type-imports` forbids, and the module is already
  // imported above for the tests' own filesystem work.
  const actual = await importOriginal<typeof realFs>();
  const rm: typeof actual.rm = async (...args) => {
    if (rmControl.failFor && String(args[0]) === rmControl.failFor) {
      const err = new Error('EBUSY: resource busy or locked') as NodeJS.ErrnoException;
      err.code = 'EBUSY';
      throw err;
    }
    return actual.rm(...args);
  };
  return { ...actual, default: { ...actual, rm }, rm };
});

const { WorktreeService } = await import('../WorktreeService.js');

function makeLogger(): ILogger {
  const logger: ILogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => logger),
  };
  return logger;
}

class FakeWorktreeRepo implements IWorktreeRepository {
  rows: WorktreeInfo[] = [];
  async create(w: WorktreeInfo): Promise<WorktreeInfo> {
    this.rows.push(w);
    return w;
  }
  async getById(id: string): Promise<WorktreeInfo> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) throw new Error(`worktree not found: ${id}`);
    return row;
  }
  async getByProjectId(projectId: string): Promise<WorktreeInfo[]> {
    return this.rows.filter((r) => r.projectId === projectId);
  }
  async getByCodebaseId(): Promise<WorktreeInfo[]> {
    return [];
  }
  async getByRunId(): Promise<WorktreeInfo[]> {
    return [];
  }
  async getByStatus(status: WorktreeStatus): Promise<WorktreeInfo[]> {
    return this.rows.filter((r) => r.status === status);
  }
  async updateStatus(): Promise<void> {}
  async delete(id: string): Promise<void> {
    const idx = this.rows.findIndex((r) => r.id === id);
    if (idx >= 0) this.rows.splice(idx, 1);
  }
  async deleteByProjectId(): Promise<void> {}
}

let tmpRoots: string[] = [];

async function tmpDir(): Promise<string> {
  const dir = await realFs.mkdtemp(path.join(os.tmpdir(), 'wts-test-'));
  tmpRoots.push(dir);
  return dir;
}

function makeService(opts: {
  worktreeRepo: FakeWorktreeRepo;
  codebase?: ProjectCodebase | null;
}) {
  const codebaseRepo = {
    getById: vi.fn(async () => {
      if (!opts.codebase) throw new Error('codebase not found');
      return opts.codebase;
    }),
    getByAlias: vi.fn(async () => undefined),
  } as unknown as IProjectCodebaseRepository;
  const gitManager = {
    createWorktree: vi.fn(async () => ''),
    removeWorktree: vi.fn(async (_clone: string, worktreePath: string) => {
      await realFs.rm(worktreePath, { recursive: true, force: true });
    }),
    pruneWorktrees: vi.fn(async () => {}),
  };
  const logger = makeLogger();
  const service = new WorktreeService(
    opts.worktreeRepo,
    codebaseRepo,
    {} as never,
    gitManager as never,
    logger,
  );
  return { service, gitManager, codebaseRepo, logger };
}

function seedRow(overrides: Partial<WorktreeInfo> & { worktreePath: string }): WorktreeInfo {
  return {
    id: overrides.id ?? 'wt-1',
    projectId: overrides.projectId ?? 'proj',
    codebaseId: overrides.codebaseId ?? 'cb',
    branchName: 'b',
    status: 'active',
    createdAt: new Date(),
    ...overrides,
  } as WorktreeInfo;
}

const gitCodebase = {
  id: 'cb',
  projectId: 'proj',
  alias: 'api',
  type: 'git-remote',
  clonePath: '/clones/api',
  status: 'ready',
  settings: {},
} as unknown as ProjectCodebase;

beforeEach(() => {
  rmControl.failFor = null;
});

afterEach(async () => {
  rmControl.failFor = null;
  for (const dir of tmpRoots) {
    await realFs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  tmpRoots = [];
});

describe('WorktreeService.removeWorktree', () => {
  it('unregisters from the parent clone and prunes its stale metadata', async () => {
    const dir = await tmpDir();
    const worktreePath = path.join(dir, 'api');
    await realFs.mkdir(worktreePath, { recursive: true });
    const repo = new FakeWorktreeRepo();
    await repo.create(seedRow({ worktreePath }));
    const { service, gitManager } = makeService({ worktreeRepo: repo, codebase: gitCodebase });

    await service.removeWorktree('wt-1');

    expect(gitManager.removeWorktree).toHaveBeenCalledWith('/clones/api', worktreePath);
    expect(gitManager.pruneWorktrees).toHaveBeenCalledWith('/clones/api');
    expect(repo.rows).toHaveLength(0);
  });

  it('keeps the tracking row when the directory cannot be removed', async () => {
    const dir = await tmpDir();
    const worktreePath = path.join(dir, 'api');
    await realFs.mkdir(worktreePath, { recursive: true });
    const repo = new FakeWorktreeRepo();
    await repo.create(seedRow({ worktreePath }));
    // A `local-dir` codebase is a plain copy — no git path to fall back on.
    const { service } = makeService({
      worktreeRepo: repo,
      codebase: { ...gitCodebase, type: 'local-dir' } as ProjectCodebase,
    });
    rmControl.failFor = worktreePath;

    await expect(service.removeWorktree('wt-1')).rejects.toThrow(/could not be removed/);

    // The row is the only record of `worktreePath`.
    expect(repo.rows).toHaveLength(1);
    await expect(realFs.stat(worktreePath)).resolves.toBeDefined();
  });

  it('still removes a worktree whose codebase has already been deleted', async () => {
    const dir = await tmpDir();
    const worktreePath = path.join(dir, 'api');
    await realFs.mkdir(worktreePath, { recursive: true });
    const repo = new FakeWorktreeRepo();
    await repo.create(seedRow({ worktreePath }));
    const { service } = makeService({ worktreeRepo: repo, codebase: null });

    await service.removeWorktree('wt-1');

    expect(repo.rows).toHaveLength(0);
  });
});

describe('WorktreeService.cleanupOrphanedWorktrees', () => {
  it('unregisters stale worktrees from git instead of bare-rm-ing them', async () => {
    const dir = await tmpDir();
    const stalePath = path.join(dir, 'stale');
    await realFs.mkdir(stalePath, { recursive: true });
    const repo = new FakeWorktreeRepo();
    await repo.create(seedRow({ id: 'wt-stale', worktreePath: stalePath, status: 'completed' }));
    const { service, gitManager } = makeService({ worktreeRepo: repo, codebase: gitCodebase });

    const cleaned = await service.cleanupOrphanedWorktrees('proj');

    expect(cleaned).toBe(1);
    // This is the fix: the old code deleted the row and the directory but
    // never told the clone, leaving a permanent `git worktree list` entry.
    expect(gitManager.removeWorktree).toHaveBeenCalledWith('/clones/api', stalePath);
    expect(gitManager.pruneWorktrees).toHaveBeenCalledWith('/clones/api');
    expect(repo.rows).toHaveLength(0);
  });

  it('sweeps active worktrees with no runId and leaves live ones alone', async () => {
    const dir = await tmpDir();
    const orphanPath = path.join(dir, 'orphan');
    const livePath = path.join(dir, 'live');
    await realFs.mkdir(orphanPath, { recursive: true });
    await realFs.mkdir(livePath, { recursive: true });
    const repo = new FakeWorktreeRepo();
    await repo.create(seedRow({ id: 'wt-orphan', worktreePath: orphanPath }));
    await repo.create(seedRow({ id: 'wt-live', worktreePath: livePath, runId: 'run-1' }));
    const { service } = makeService({ worktreeRepo: repo, codebase: gitCodebase });

    const cleaned = await service.cleanupOrphanedWorktrees('proj');

    expect(cleaned).toBe(1);
    expect(repo.rows.map((r) => r.id)).toEqual(['wt-live']);
  });

  it('keeps sweeping past a worktree whose directory is wedged', async () => {
    const dir = await tmpDir();
    const stuckPath = path.join(dir, 'stuck');
    const okPath = path.join(dir, 'ok');
    await realFs.mkdir(stuckPath, { recursive: true });
    await realFs.mkdir(okPath, { recursive: true });
    const repo = new FakeWorktreeRepo();
    await repo.create(seedRow({ id: 'wt-stuck', worktreePath: stuckPath, status: 'orphaned' }));
    await repo.create(seedRow({ id: 'wt-ok', worktreePath: okPath, status: 'orphaned' }));
    const { service } = makeService({
      worktreeRepo: repo,
      codebase: { ...gitCodebase, type: 'local-dir' } as ProjectCodebase,
    });
    rmControl.failFor = stuckPath;

    const cleaned = await service.cleanupOrphanedWorktrees('proj');

    expect(cleaned).toBe(1);
    expect(repo.rows.map((r) => r.id)).toEqual(['wt-stuck']);
  });
});
