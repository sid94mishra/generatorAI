// ────────────────────────────────────────────────────────────────
// WorkspaceManager — lifecycle, teardown ordering and worktree cleanup
//
// Regression coverage for the P0/P1 defects in the V2 re-audit §2/§3:
//  - P0-e   deleteWorkspace read a table with no writers, so the whole
//           worktree-removal path was unreachable and `pruneWorktrees` had
//           zero callers.
//  - W25    teardown ran in listener registration order, so an `fs.rm`
//           listener registered early ran before native handle release.
//  - INV-7  archive tore nothing down.
//  - EBUSY  a failed `fs.rm` was warned away and the row — the only record of
//           the directory — deleted anyway.
//  - F3     concurrent creates with different code roots collapsed silently.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
// Imported for its TYPE only, to give `importOriginal` a named annotation —
// `consistent-type-imports` forbids the inline `typeof import(...)` form the
// Vitest docs use.
import type * as FsPromises from 'node:fs/promises';
import type {
  ExecutionWorkspace,
  WorkspaceFilters,
  WorkspaceMount,
  WorkspaceOwnerType,
  WorkspacePrepStatus,
  WorkspaceStatus,
  WorktreeInfo,
  WorktreeStatus,
  ILogger,
} from '@generatorai/shared';
import type { IExecutionWorkspaceRepository } from '../../domain/ports/IExecutionWorkspaceRepository.js';
import type {
  IWorkspaceMountRepository,
  WorkspaceMountUpdate,
} from '../../domain/ports/IWorkspaceMountRepository.js';
import type { IWorkspaceArtifactRepository } from '../../domain/ports/IWorkspaceArtifactRepository.js';
import type { IWorktreeRepository } from '../../domain/ports/IWorktreeRepository.js';

// `rm` is the one call we need to be able to fail on demand: the EBUSY case is
// the whole point of several tests and cannot be provoked portably for real.
// Everything else passes through to the real filesystem.
const rmControl = vi.hoisted(() => ({ failWith: null as string | null }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  const rm: typeof actual.rm = async (...args) => {
    if (rmControl.failWith) {
      const err = new Error(`${rmControl.failWith}: resource busy or locked`) as NodeJS.ErrnoException;
      err.code = rmControl.failWith;
      throw err;
    }
    return actual.rm(...args);
  };
  return { ...actual, default: { ...actual, rm }, rm };
});

const { WorkspaceManager, WorkspaceTreeBusyError } = await import('../WorkspaceManager.js');
const fs = await import('node:fs/promises');

// ── Test doubles ─────────────────────────────────────────────────

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

class FakeWorkspaceRepo implements IExecutionWorkspaceRepository {
  readonly rows = new Map<string, ExecutionWorkspace>();

  async create(workspace: ExecutionWorkspace): Promise<void> {
    this.rows.set(workspace.id, { ...workspace });
  }
  async findById(id: string): Promise<ExecutionWorkspace | null> {
    return this.rows.get(id) ?? null;
  }
  async findByOwner(ownerType: WorkspaceOwnerType, ownerId: string): Promise<ExecutionWorkspace | null> {
    for (const ws of this.rows.values()) {
      if (ws.ownerType === ownerType && ws.ownerId === ownerId) return ws;
    }
    return null;
  }
  async findByProject(projectId: string): Promise<ExecutionWorkspace[]> {
    return [...this.rows.values()].filter((w) => w.projectId === projectId);
  }
  async list(filters: WorkspaceFilters): Promise<ExecutionWorkspace[]> {
    return [...this.rows.values()].filter((w) => !filters.status || w.status === filters.status);
  }
  async updateStatus(id: string, status: WorkspaceStatus, updates?: Partial<ExecutionWorkspace>): Promise<void> {
    const row = this.rows.get(id);
    if (row) this.rows.set(id, { ...row, ...updates, status });
  }
  async updatePrep(id: string, prepStatus: WorkspacePrepStatus, prepError?: string | null): Promise<void> {
    const row = this.rows.get(id);
    if (row) this.rows.set(id, { ...row, prepStatus, ...(prepError ? { prepError } : {}) });
  }
  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
}

/**
 * The `workspace_mounts` table. Mounts replaced the `workspace_worktrees`
 * tracking table: a mount is one directory the agent may edit, and its `mode`
 * is what decides whether teardown may delete the directory behind it.
 */
class FakeMountRepo implements IWorkspaceMountRepository {
  readonly rows: WorkspaceMount[] = [];
  async create(mount: WorkspaceMount): Promise<void> {
    this.rows.push({ ...mount });
  }
  async findById(id: string): Promise<WorkspaceMount | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async findByWorkspace(
    workspaceId: string,
    opts?: { includeRemoved?: boolean },
  ): Promise<WorkspaceMount[]> {
    return this.rows
      .filter((r) => r.workspaceId === workspaceId)
      .filter((r) => opts?.includeRemoved || r.status !== 'removed')
      .sort((a, b) => a.position - b.position);
  }
  async findByCodebase(codebaseId: string): Promise<WorkspaceMount[]> {
    return this.rows.filter((r) => r.codebaseId === codebaseId);
  }
  async update(id: string, updates: WorkspaceMountUpdate): Promise<void> {
    const idx = this.rows.findIndex((r) => r.id === id);
    if (idx >= 0) {
      const { error, ...rest } = updates;
      this.rows[idx] = {
        ...this.rows[idx]!,
        ...rest,
        ...(error === null ? {} : error === undefined ? {} : { error }),
      };
    }
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

class FakeRunWorktreeRepo implements IWorktreeRepository {
  readonly rows: WorktreeInfo[] = [];
  async create(worktree: WorktreeInfo): Promise<WorktreeInfo> {
    this.rows.push(worktree);
    return worktree;
  }
  async getById(id: string): Promise<WorktreeInfo> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) throw new Error(`worktree not found: ${id}`);
    return row;
  }
  async getByProjectId(projectId: string): Promise<WorktreeInfo[]> {
    return this.rows.filter((r) => r.projectId === projectId);
  }
  async getByCodebaseId(codebaseId: string): Promise<WorktreeInfo[]> {
    return this.rows.filter((r) => r.codebaseId === codebaseId);
  }
  async getByRunId(runId: string): Promise<WorktreeInfo[]> {
    return this.rows.filter((r) => r.runId === runId);
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

const artifactRepo = (): IWorkspaceArtifactRepository =>
  ({
    create: vi.fn(async () => {}),
    findByWorkspace: vi.fn(async () => []),
    findByStageRun: vi.fn(async () => []),
    delete: vi.fn(async () => {}),
    deleteByWorkspace: vi.fn(async () => {}),
  }) as unknown as IWorkspaceArtifactRepository;

/** Minimal IGitClient stub — only the worktree methods are exercised. */
function makeGitClient() {
  return {
    removeWorktree: vi.fn(async (_repo: string, worktreePath: string) => {
      await fs.rm(worktreePath, { recursive: true, force: true });
    }),
    pruneWorktrees: vi.fn(async () => {}),
    commit: vi.fn(async () => true),
  };
}

interface Harness {
  manager: InstanceType<typeof WorkspaceManager>;
  workspaceRepo: FakeWorkspaceRepo;
  mountRepo: FakeMountRepo;
  runRepo: FakeRunWorktreeRepo;
  git: ReturnType<typeof makeGitClient>;
  logger: ILogger;
  workspacesDir: string;
}

let tmpRoots: string[] = [];

async function makeHarness(): Promise<Harness> {
  const workspacesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wsm-test-'));
  tmpRoots.push(workspacesDir);
  const workspaceRepo = new FakeWorkspaceRepo();
  const mountRepo = new FakeMountRepo();
  const runRepo = new FakeRunWorktreeRepo();
  const git = makeGitClient();
  const logger = makeLogger();
  const manager = new WorkspaceManager(
    workspaceRepo,
    mountRepo,
    artifactRepo(),
    { workspacesDir, defaultGitEnabled: false },
    logger,
    git as never,
    runRepo,
  );
  return { manager, workspaceRepo, mountRepo, runRepo, git, logger, workspacesDir };
}

/**
 * Insert a `workspace_mounts` row. Worktree and generated mounts live under
 * `<root>/source/<alias>`; an in-place mount points at the user's own folder
 * and `path` must be given explicitly.
 */
async function addMount(
  h: Harness,
  ws: ExecutionWorkspace,
  overrides: Partial<WorkspaceMount> & { alias: string },
): Promise<WorkspaceMount> {
  const mode = overrides.mode ?? 'worktree';
  const mount: WorkspaceMount = {
    id: overrides.id ?? randomUUID(),
    workspaceId: ws.id,
    position: overrides.position ?? h.mountRepo.rows.filter((r) => r.workspaceId === ws.id).length,
    originKind: mode === 'in-place' ? 'folder' : mode === 'generated' ? 'generated' : 'codebase',
    mode,
    path: overrides.path ?? path.join(ws.rootPath, 'source', overrides.alias),
    status: 'ready',
    hasUncommittedChanges: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  await h.mountRepo.create(mount);
  return mount;
}

/** A linked worktree carries a `.git` FILE pointing back at its parent clone. */
async function makeLinkedWorktree(worktreePath: string, clonePath: string): Promise<void> {
  await fs.mkdir(worktreePath, { recursive: true });
  await fs.mkdir(clonePath, { recursive: true });
  await fs.writeFile(
    path.join(worktreePath, '.git'),
    `gitdir: ${path.join(clonePath, '.git', 'worktrees', path.basename(worktreePath))}\n`,
    'utf-8',
  );
}

/** Seed an `active` workspace row plus its on-disk tree, bypassing git init. */
async function seedWorkspace(
  h: Harness,
  overrides: Partial<ExecutionWorkspace> = {},
): Promise<ExecutionWorkspace> {
  const ownerId = overrides.ownerId ?? randomUUID();
  const rootPath = overrides.rootPath ?? path.join(h.workspacesDir, 'executions', ownerId);
  const ws: ExecutionWorkspace = {
    id: overrides.id ?? randomUUID(),
    ownerType: 'chat',
    ownerId,
    rootPath,
    status: 'active',
    gitEnabled: false,
    useWorktree: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  await fs.mkdir(path.join(rootPath, 'source'), { recursive: true });
  await h.workspaceRepo.create(ws);
  return ws;
}

beforeEach(() => {
  rmControl.failWith = null;
});

afterEach(async () => {
  rmControl.failWith = null;
  for (const dir of tmpRoots) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  tmpRoots = [];
});

// ── Teardown phase ordering (W25) ────────────────────────────────

describe('WorkspaceManager teardown ordering', () => {
  it('runs native listeners before storage listeners regardless of registration order', async () => {
    const h = await makeHarness();
    const ws = await seedWorkspace(h);
    const order: string[] = [];

    // Registered FIRST but declared `storage` — this is the composition-root
    // shape that made `agentStaging.cleanup` (an fs.rm) run before the
    // browser/CUA/terminal teardown.
    h.manager.registerBeforeDelete(() => {
      order.push('storage:staging');
    }, 'storage');
    h.manager.registerBeforeDelete(() => {
      order.push('native:browser');
    }, 'native');
    h.manager.registerBeforeDelete(() => {
      order.push('native:terminal');
    }, 'native');

    await h.manager.deleteWorkspace(ws.id);

    expect(order).toEqual(['native:browser', 'native:terminal', 'storage:staging']);
  });

  it('defaults an unlabelled listener to the native phase', async () => {
    const h = await makeHarness();
    const ws = await seedWorkspace(h);
    const order: string[] = [];

    h.manager.registerBeforeDelete(() => void order.push('storage'), 'storage');
    h.manager.registerBeforeDelete(() => void order.push('unlabelled'));

    await h.manager.deleteWorkspace(ws.id);
    expect(order).toEqual(['unlabelled', 'storage']);
  });

  it('does not let one throwing listener stop the rest of teardown', async () => {
    const h = await makeHarness();
    const ws = await seedWorkspace(h);
    const seen: string[] = [];

    h.manager.registerBeforeDelete(() => {
      throw new Error('hostile listener');
    }, 'native');
    h.manager.registerBeforeDelete(() => void seen.push('second'), 'native');
    h.manager.registerBeforeDelete(() => void seen.push('storage'), 'storage');

    await h.manager.deleteWorkspace(ws.id);
    expect(seen).toEqual(['second', 'storage']);
    expect(h.workspaceRepo.rows.has(ws.id)).toBe(false);
  });

  it('unregisters exactly the listener that was registered', async () => {
    const h = await makeHarness();
    const ws = await seedWorkspace(h);
    const seen: string[] = [];
    const off = h.manager.registerBeforeDelete(() => void seen.push('a'), 'native');
    h.manager.registerBeforeDelete(() => void seen.push('b'), 'native');
    off();

    await h.manager.deleteWorkspace(ws.id);
    expect(seen).toEqual(['b']);
  });
});

// ── INV-7: archive must release native resources ─────────────────

describe('WorkspaceManager.archiveWorkspace (INV-7)', () => {
  it('runs native teardown so no Chromium/PTY/CUA session outlives the archive', async () => {
    const h = await makeHarness();
    const ws = await seedWorkspace(h);
    const native = vi.fn();
    h.manager.registerBeforeDelete(native, 'native');

    await h.manager.archiveWorkspace(ws.id);

    expect(native).toHaveBeenCalledWith(ws.id);
    expect(h.workspaceRepo.rows.get(ws.id)?.status).toBe('archived');
  });

  it('leaves storage listeners alone — archive keeps files, threads and checkpoints', async () => {
    const h = await makeHarness();
    const ws = await seedWorkspace(h);
    const storage = vi.fn();
    h.manager.registerBeforeDelete(storage, 'storage');

    await h.manager.archiveWorkspace(ws.id);

    expect(storage).not.toHaveBeenCalled();
    // The tree survives — that is the difference between archive and delete.
    await expect(fs.stat(ws.rootPath)).resolves.toBeDefined();
  });
});

// ── P0-e: worktree cleanup must be reachable ─────────────────────

describe('WorkspaceManager worktree cleanup (P0-e)', () => {
  it('removes worktrees recorded in the authoritative table, keyed by ownerId', async () => {
    const h = await makeHarness();
    const ws = await seedWorkspace(h);
    const worktreePath = path.join(ws.rootPath, 'source', 'api');
    const clonePath = path.join(h.workspacesDir, 'clones', 'api');
    await fs.mkdir(worktreePath, { recursive: true });
    await fs.mkdir(clonePath, { recursive: true });
    // Linked worktrees carry a `.git` FILE pointing back at the parent clone.
    await fs.writeFile(
      path.join(worktreePath, '.git'),
      `gitdir: ${path.join(clonePath, '.git', 'worktrees', 'api')}\n`,
      'utf-8',
    );
    await h.runRepo.create({
      id: 'wt-1',
      projectId: 'proj',
      codebaseId: 'cb',
      runId: ws.ownerId,
      worktreePath,
      branchName: 'generatorai/run-x-api',
      status: 'active',
      createdAt: new Date(),
    });

    await h.manager.deleteWorkspace(ws.id);

    expect(h.git.removeWorktree).toHaveBeenCalledWith(clonePath, worktreePath);
    // `pruneWorktrees` had zero callers before this fix.
    expect(h.git.pruneWorktrees).toHaveBeenCalledWith(clonePath);
    // The row goes only because the directory actually went.
    expect(h.runRepo.rows).toHaveLength(0);
  });

  it('keeps the authoritative row when a worktree outside the workspace survives', async () => {
    const h = await makeHarness();
    const ws = await seedWorkspace(h);
    // The legacy layout puts worktrees in the project worktrees dir, OUTSIDE
    // the workspace root — so removing the workspace tree does not remove it.
    const worktreePath = path.join(h.workspacesDir, 'project-worktrees', 'api');
    await fs.mkdir(worktreePath, { recursive: true });
    await h.runRepo.create({
      id: 'wt-1',
      projectId: 'proj',
      codebaseId: 'cb',
      runId: ws.ownerId,
      worktreePath,
      branchName: 'b',
      status: 'active',
      createdAt: new Date(),
    });
    // No `.git` file → no parent clone → neither the git-client path nor the
    // execFile fallback can unregister it. Directory stays, so the row must
    // stay too: it is the only thing that leads anyone back to that directory.
    await h.manager.deleteWorkspace(ws.id);

    expect(h.runRepo.rows).toHaveLength(1);
    await expect(fs.stat(worktreePath)).resolves.toBeDefined();
    expect(h.logger.warn).toHaveBeenCalledWith(expect.stringContaining('Keeping worktree row'));
  });

  it('drops the authoritative row for a worktree inside the workspace tree', async () => {
    const h = await makeHarness();
    const ws = await seedWorkspace(h);
    const worktreePath = path.join(ws.rootPath, 'source', 'copied');
    await fs.mkdir(worktreePath, { recursive: true });
    // A `local-dir` codebase is a plain copy, not a linked worktree — git can
    // never unregister it, but the workspace `fs.rm` does remove it.
    await h.runRepo.create({
      id: 'wt-1',
      projectId: 'proj',
      codebaseId: 'cb',
      runId: ws.ownerId,
      worktreePath,
      branchName: 'b',
      status: 'active',
      createdAt: new Date(),
    });

    await h.manager.deleteWorkspace(ws.id);

    expect(h.runRepo.rows).toHaveLength(0);
  });

  it('unregisters worktree mounts recorded in workspace_mounts', async () => {
    const h = await makeHarness();
    const ws = await seedWorkspace(h);
    const worktreePath = path.join(ws.rootPath, 'source', 'legacy');
    const clonePath = path.join(h.workspacesDir, 'clones', 'legacy');
    await makeLinkedWorktree(worktreePath, clonePath);
    await addMount(h, ws, { alias: 'legacy', mode: 'worktree', codebaseId: 'cb' });

    await h.manager.deleteWorkspace(ws.id);

    expect(h.git.removeWorktree).toHaveBeenCalledWith(clonePath, worktreePath);
    // The mount rows go with the workspace.
    expect(h.mountRepo.rows).toHaveLength(0);
  });

  it('refuses a worktree mount whose path lies outside the workspace', async () => {
    const h = await makeHarness();
    const ws = await seedWorkspace(h);
    const outsider = path.join(h.workspacesDir, 'not-mine');
    await fs.mkdir(outsider, { recursive: true });

    await addMount(h, ws, { alias: 'evil', mode: 'worktree', path: outsider });

    await h.manager.deleteWorkspace(ws.id);

    // `git worktree remove --force` must never have been aimed outside the
    // workspace boundary.
    expect(h.git.removeWorktree).not.toHaveBeenCalled();
    await expect(fs.stat(outsider)).resolves.toBeDefined();
    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('is outside workspace'),
    );
  });

  it('never deletes the directory behind an in-place mount', async () => {
    const h = await makeHarness();
    const ws = await seedWorkspace(h);
    // A worktree mount: managed, under the root, safe to unregister + delete.
    const worktreePath = path.join(ws.rootPath, 'source', 'api');
    const clonePath = path.join(h.workspacesDir, 'clones', 'api');
    await makeLinkedWorktree(worktreePath, clonePath);
    await addMount(h, ws, { alias: 'api', mode: 'worktree', codebaseId: 'cb' });
    // An in-place mount: the user's OWN folder, edited where it lives.
    const mine = path.join(h.workspacesDir, 'my-repo');
    await fs.mkdir(mine, { recursive: true });
    await fs.writeFile(path.join(mine, 'README.md'), 'mine\n', 'utf-8');
    await addMount(h, ws, { alias: 'my-repo', mode: 'in-place', path: mine });

    await h.manager.deleteWorkspace(ws.id);

    // Exactly one worktree was unregistered — the in-place mount is not a
    // worktree and must never be handed to `git worktree remove`.
    expect(h.git.removeWorktree).toHaveBeenCalledTimes(1);
    expect(h.git.removeWorktree).toHaveBeenCalledWith(clonePath, worktreePath);
    // The managed tree is gone…
    await expect(fs.stat(ws.rootPath)).rejects.toThrow();
    // …and the user's folder is untouched.
    await expect(fs.readFile(path.join(mine, 'README.md'), 'utf-8')).resolves.toBe('mine\n');
  });

  it('de-duplicates a worktree recorded as both a mount and a legacy row', async () => {
    const h = await makeHarness();
    const ws = await seedWorkspace(h);
    const worktreePath = path.join(ws.rootPath, 'source', 'api');
    const clonePath = path.join(h.workspacesDir, 'clones', 'api');
    await makeLinkedWorktree(worktreePath, clonePath);
    await h.runRepo.create({
      id: 'wt-1',
      projectId: 'proj',
      codebaseId: 'cb',
      runId: ws.ownerId,
      worktreePath,
      branchName: 'b',
      status: 'active',
      createdAt: new Date(),
    });
    await addMount(h, ws, { alias: 'api', mode: 'worktree', codebaseId: 'cb' });

    await h.manager.deleteWorkspace(ws.id);

    expect(h.git.removeWorktree).toHaveBeenCalledTimes(1);
  });
});

// ── EBUSY: never delete the row while the directory survives ─────

describe('WorkspaceManager filesystem failure handling', () => {
  it('keeps every DB row and throws when the workspace tree cannot be removed', async () => {
    const h = await makeHarness();
    const ws = await seedWorkspace(h);
    rmControl.failWith = 'EBUSY';

    await expect(h.manager.deleteWorkspace(ws.id)).rejects.toBeInstanceOf(WorkspaceTreeBusyError);

    // The row is the only record of rootPath — dropping it orphans the tree.
    expect(h.workspaceRepo.rows.has(ws.id)).toBe(true);
    await expect(fs.stat(ws.rootPath)).resolves.toBeDefined();
  });

  it('retries a transient EBUSY rather than giving up on the first attempt', async () => {
    const h = await makeHarness();
    const ws = await seedWorkspace(h);
    rmControl.failWith = 'EBUSY';
    // Release the "handle" once the first attempt has failed.
    setTimeout(() => {
      rmControl.failWith = null;
    }, 50);

    await expect(h.manager.deleteWorkspace(ws.id)).resolves.toBeUndefined();
    expect(h.workspaceRepo.rows.has(ws.id)).toBe(false);
  });

  it('keeps sweeping when one expired workspace is wedged', async () => {
    const h = await makeHarness();
    const stuck = await seedWorkspace(h, {
      status: 'completed',
      completedAt: new Date(Date.now() - 72 * 3600_000),
    });
    const fine = await seedWorkspace(h, {
      status: 'completed',
      completedAt: new Date(Date.now() - 72 * 3600_000),
    });

    // Fail only for the wedged workspace's tree.
    const realRm = fs.rm;
    const spy = vi
      .spyOn(fs, 'rm')
      .mockImplementation(async (target, opts) => {
        if (String(target) === stuck.rootPath) {
          const err = new Error('EBUSY') as NodeJS.ErrnoException;
          err.code = 'EBUSY';
          throw err;
        }
        return realRm(target, opts);
      });

    const removed = await h.manager.cleanupExpiredWorkspaces({
      completedRetentionHours: 1,
      archiveIfDirty: false,
      protectUnpushed: false,
      maxTotalDiskMB: 1024,
      respectAutomationRetention: false,
    });
    spy.mockRestore();

    expect(removed).toBe(1);
    expect(h.workspaceRepo.rows.has(fine.id)).toBe(false);
    // Still `completed` and still past the cutoff → the next sweep retries it.
    expect(h.workspaceRepo.rows.get(stuck.id)?.status).toBe('completed');
  });

  // ── includeStaleActive ─────────────────────────────────────────
  //
  // Retention originally considered only `completed` workspaces, and
  // `completeWorkspace()` is called from exactly one place —
  // `WorkflowRunService`. Chat-owned workspaces therefore stay `active` for
  // ever and were permanently exempt, which is the bulk of what accumulates
  // on a real machine. The nightly sweep opts in to this; the historical
  // contract (below) is unchanged without it.

  it('leaves stale ACTIVE workspaces alone by default', async () => {
    const h = await makeHarness();
    const stale = await seedWorkspace(h, {
      status: 'active',
      updatedAt: new Date(Date.now() - 90 * 24 * 3600_000),
    });

    const removed = await h.manager.cleanupExpiredWorkspaces({
      completedRetentionHours: 24,
      archiveIfDirty: false,
      protectUnpushed: false,
      maxTotalDiskMB: 1024,
      respectAutomationRetention: false,
    });

    expect(removed).toBe(0);
    expect(h.workspaceRepo.rows.has(stale.id)).toBe(true);
  });

  it('sweeps stale ACTIVE workspaces when asked, judging them on updatedAt', async () => {
    const h = await makeHarness();
    const stale = await seedWorkspace(h, {
      status: 'active',
      updatedAt: new Date(Date.now() - 90 * 24 * 3600_000),
    });
    const recent = await seedWorkspace(h, { status: 'active', updatedAt: new Date() });

    const removed = await h.manager.cleanupExpiredWorkspaces({
      completedRetentionHours: 24,
      archiveIfDirty: false,
      protectUnpushed: false,
      maxTotalDiskMB: 1024,
      respectAutomationRetention: false,
      includeStaleActive: true,
    });

    expect(removed).toBe(1);
    expect(h.workspaceRepo.rows.has(stale.id)).toBe(false);
    // A workspace touched today is not stale, whatever its status.
    expect(h.workspaceRepo.rows.has(recent.id)).toBe(true);
  });
});

// ── F3: concurrent create with a conflicting code root ───────────

describe('WorkspaceManager.createWorkspace concurrency', () => {
  it('collapses concurrent creates for the same owner onto one workspace', async () => {
    const h = await makeHarness();
    const [a, b] = await Promise.all([
      h.manager.createWorkspace({ ownerType: 'chat', ownerId: 'chat-1' }),
      h.manager.createWorkspace({ ownerType: 'chat', ownerId: 'chat-1' }),
    ]);
    expect(a.id).toBe(b.id);
    expect(h.workspaceRepo.rows.size).toBe(1);
  });

  it('refuses to hand a concurrent caller a workspace rooted at a different tree', async () => {
    const h = await makeHarness();
    const codeRootA = path.join(h.workspacesDir, 'repo-a');
    const codeRootB = path.join(h.workspacesDir, 'repo-b');
    await fs.mkdir(codeRootA, { recursive: true });
    await fs.mkdir(codeRootB, { recursive: true });

    const first = h.manager.createWorkspace({
      ownerType: 'chat',
      ownerId: 'chat-2',
      codeRootOverride: codeRootA,
    });
    const second = h.manager.createWorkspace({
      ownerType: 'chat',
      ownerId: 'chat-2',
      codeRootOverride: codeRootB,
    });

    await expect(first).resolves.toMatchObject({ codeRoot: codeRootA });
    // Silently returning the first caller's workspace would point the second
    // caller's agent at someone else's code root.
    await expect(second).rejects.toThrow(/requested codeRoot/);
  });
});

// ── Worktree read path (Changes tab was empty) ───────────────────
//
// P0-e had a read-side twin: `getWorkspaceInfo` / `listWorkspaces` consulted
// only the `workspace_worktrees` tracking table, which no production code
// writes. `info.worktrees` was therefore always `[]`, the workspaces route fed
// an empty worktree list to `discoverRepos`, `source/` is a RESERVED_DIR, and
// a project-bound chat's Changes tab showed nothing at all.

describe('WorkspaceManager worktree read path', () => {
  it('reports authoritative worktrees relative to the workspace root', async () => {
    const h = await makeHarness();
    const ws = await seedWorkspace(h);
    const worktreePath = path.join(ws.rootPath, 'source', 'todo-api');
    // The back-fill only adopts a legacy row whose directory still exists.
    await fs.mkdir(worktreePath, { recursive: true });
    await h.runRepo.create({
      id: 'wt-1',
      projectId: 'proj',
      codebaseId: 'cb-todo',
      runId: ws.ownerId,
      worktreePath,
      branchName: 'generatorai/run-db4b4e14-todo-api',
      status: 'active',
      createdAt: new Date(),
    });

    const info = await h.manager.getWorkspaceInfo(ws.id);

    expect(info?.worktrees).toEqual([
      {
        codebaseId: 'cb-todo',
        // Derived from the directory basename — the same rule `discoverRepos`
        // applies, so the two can never disagree about the alias.
        alias: 'todo-api',
        branchName: 'generatorai/run-db4b4e14-todo-api',
        baseBranch: '',
        worktreePath: path.join('source', 'todo-api'),
        status: 'active',
      },
    ]);
    expect(info?.sourcePaths).toEqual([worktreePath]);
  });

  it('reports a legacy out-of-workspace worktree with an absolute path', async () => {
    const h = await makeHarness();
    const ws = await seedWorkspace(h);
    const worktreePath = path.join(h.workspacesDir, 'project-worktrees', 'api');
    await fs.mkdir(worktreePath, { recursive: true });
    await h.runRepo.create({
      id: 'wt-1',
      projectId: 'proj',
      codebaseId: 'cb',
      runId: ws.ownerId,
      worktreePath,
      branchName: 'b',
      status: 'active',
      createdAt: new Date(),
    });

    const info = await h.manager.getWorkspaceInfo(ws.id);

    // No relative form exists, so the absolute path is reported and consumers
    // resolve it with `resolveWorktreePath` rather than a bare `path.join`.
    expect(info?.worktrees[0]?.worktreePath).toBe(worktreePath);
    expect(info?.sourcePaths).toEqual([worktreePath]);
  });

  it('reports every worktree mount, and ignores the legacy table once mounts exist', async () => {
    const h = await makeHarness();
    const ws = await seedWorkspace(h);
    // Persisted mounts are authoritative: the legacy back-fill runs only for a
    // workspace that has no mount rows at all, so this row must be ignored.
    await h.runRepo.create({
      id: 'wt-legacy',
      projectId: 'proj',
      codebaseId: 'cb-legacy',
      runId: ws.ownerId,
      worktreePath: path.join(ws.rootPath, 'source', 'legacy'),
      branchName: 'legacy-branch',
      status: 'active',
      createdAt: new Date(),
    });
    await addMount(h, ws, {
      alias: 'api',
      mode: 'worktree',
      codebaseId: 'cb-api',
      git: { isRepo: true, branch: 'run-branch', baseRef: 'main' },
    });
    await addMount(h, ws, {
      alias: 'web',
      mode: 'worktree',
      codebaseId: 'cb-web',
      git: { isRepo: true, branch: 'web-branch', baseRef: 'main' },
    });

    const info = await h.manager.getWorkspaceInfo(ws.id);

    expect(info?.worktrees).toHaveLength(2);
    expect(info?.worktrees.map((w) => w.alias)).toEqual(['api', 'web']);
    expect(info?.worktrees.find((w) => w.alias === 'api')?.baseBranch).toBe('main');
    expect(info?.worktrees.find((w) => w.alias === 'web')?.branchName).toBe('web-branch');
    expect(info?.sourcePaths).toEqual([
      path.join(ws.rootPath, 'source', 'api'),
      path.join(ws.rootPath, 'source', 'web'),
    ]);
  });

  it('skips worktrees that have already been cleaned up', async () => {
    const h = await makeHarness();
    const ws = await seedWorkspace(h);
    await h.runRepo.create({
      id: 'wt-1',
      projectId: 'proj',
      codebaseId: 'cb',
      runId: ws.ownerId,
      worktreePath: path.join(ws.rootPath, 'source', 'gone'),
      branchName: 'b',
      status: 'orphaned',
      createdAt: new Date(),
    });

    const info = await h.manager.getWorkspaceInfo(ws.id);
    expect(info?.worktrees).toEqual([]);
  });

  it('listWorkspaces reports the same mounts as getWorkspaceInfo', async () => {
    const h = await makeHarness();
    const ws = await seedWorkspace(h);
    const worktreePath = path.join(ws.rootPath, 'source', 'api');
    await fs.mkdir(worktreePath, { recursive: true });
    await h.runRepo.create({
      id: 'wt-1',
      projectId: 'proj',
      codebaseId: 'cb',
      runId: ws.ownerId,
      worktreePath,
      branchName: 'b',
      status: 'active',
      createdAt: new Date(),
    });

    const [listed] = await h.manager.listWorkspaces({ status: 'active' });
    const info = await h.manager.getWorkspaceInfo(ws.id);

    expect(listed?.worktrees).toEqual(info?.worktrees);
    expect(listed?.sourcePaths).toEqual(info?.sourcePaths);
    expect(listed?.worktrees).toHaveLength(1);
  });

  it('survives an authoritative repo that throws', async () => {
    const h = await makeHarness();
    const ws = await seedWorkspace(h);
    h.runRepo.getByRunId = async () => {
      throw new Error('db down');
    };

    const info = await h.manager.getWorkspaceInfo(ws.id);
    expect(info?.worktrees).toEqual([]);
    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not list legacy worktrees'),
    );
  });
});

// ── Mounts: back-fill, exposure ──────────────────────────────────
//
// `workspace_worktrees` is gone; a workspace's editable directories are its
// `workspace_mounts` rows. Workspaces created before mounts existed have no
// rows at all, so `listMounts` synthesises them from what the workspace does
// have — and those synthesised mounts keep using their OWN `.git`
// (`git.shadow === false`) so the checkpoints they already have stay readable.

describe('WorkspaceManager.listMounts back-fill', () => {
  it('turns a bound codeRoot into a single in-place mount aliased "."', async () => {
    const h = await makeHarness();
    const codeRoot = path.join(h.workspacesDir, 'user-repo');
    await fs.mkdir(path.join(codeRoot, '.git'), { recursive: true });
    const ws = await seedWorkspace(h, { codeRoot });

    const mounts = await h.manager.listMounts(ws);

    expect(mounts).toHaveLength(1);
    expect(mounts[0]).toMatchObject({
      alias: '.',
      mode: 'in-place',
      originKind: 'folder',
      originPath: codeRoot,
      path: codeRoot,
      status: 'ready',
    });
    // Not a shadow store: this workspace's checkpoints live in the mount's
    // own `.git` and must stay findable there.
    expect(mounts[0]?.git).toEqual({ isRepo: true, shadow: false });
    // Back-filled rows are persisted, so the synthesis happens exactly once.
    expect(h.mountRepo.rows).toHaveLength(1);
    const again = await h.manager.listMounts(ws);
    expect(again.map((m) => m.id)).toEqual(mounts.map((m) => m.id));
  });

  it('turns a legacy worktrees row into a worktree mount', async () => {
    const h = await makeHarness();
    const ws = await seedWorkspace(h);
    const worktreePath = path.join(ws.rootPath, 'source', 'todo-api');
    await fs.mkdir(worktreePath, { recursive: true });
    await h.runRepo.create({
      id: 'wt-1',
      projectId: 'proj',
      codebaseId: 'cb-todo',
      runId: ws.ownerId,
      worktreePath,
      branchName: 'generatorai/run-x-todo-api',
      status: 'active',
      createdAt: new Date(),
    });

    const mounts = await h.manager.listMounts(ws);

    expect(mounts).toHaveLength(1);
    expect(mounts[0]).toMatchObject({
      // Alias is the directory basename — the same rule `discoverRepos`
      // applies, so the two can never disagree.
      alias: 'todo-api',
      mode: 'worktree',
      originKind: 'codebase',
      codebaseId: 'cb-todo',
      path: worktreePath,
    });
    expect(mounts[0]?.git).toEqual({
      isRepo: true,
      branch: 'generatorai/run-x-todo-api',
      shadow: false,
    });
  });

  it('gives a workspace with neither one generated mount at its root', async () => {
    const h = await makeHarness();
    const ws = await seedWorkspace(h);

    const mounts = await h.manager.listMounts(ws);

    expect(mounts).toHaveLength(1);
    expect(mounts[0]).toMatchObject({
      alias: '.',
      mode: 'generated',
      originKind: 'generated',
      path: ws.rootPath,
    });
  });

  it('does not back-fill a workspace whose mounts are still being prepared', async () => {
    const h = await makeHarness();
    const ws = await seedWorkspace(h, { prepStatus: 'pending' });

    // An empty mount list here means "not ready yet", NOT "legacy workspace" —
    // synthesising a mount would hand the agent the wrong directory.
    expect(await h.manager.listMounts(ws)).toEqual([]);
    expect(h.mountRepo.rows).toHaveLength(0);
  });
});

describe('WorkspaceManager.getExposure', () => {
  it('makes the primary mount the cwd and every other mount an extra directory', async () => {
    const h = await makeHarness();
    const repoA = path.join(h.workspacesDir, 'repo-a');
    const repoB = path.join(h.workspacesDir, 'repo-b');
    await fs.mkdir(repoA, { recursive: true });
    await fs.mkdir(repoB, { recursive: true });
    const ws = await seedWorkspace(h);
    // Deliberately inserted out of order: `position` decides the primary.
    await addMount(h, ws, { alias: 'b', mode: 'in-place', path: repoB, position: 1 });
    await addMount(h, ws, { alias: 'a', mode: 'in-place', path: repoA, position: 0 });

    const exposure = await h.manager.getExposure(ws);

    expect(exposure.workingDirectory).toBe(repoA);
    // The other mount, plus the managed root — which carries scratch, plans
    // and screenshots the agent must be able to read and write, and is not
    // reachable from a cwd that lives outside it.
    expect(exposure.additionalDirectories).toEqual([repoB, ws.rootPath]);
    expect(exposure.scratchDir).toBe(path.join(ws.rootPath, 'scratch'));
    expect(exposure.mounts.map((m) => m.alias)).toEqual(['a', 'b']);
    // The hint names the working directory and both mounts.
    expect(exposure.hint).toContain(`Working directory: ${repoA}`);
    expect(exposure.hint).toContain(`Also mounted: ${repoB}`);
    expect(exposure.hint).toContain(`Scratch directory: ${exposure.scratchDir}`);
  });

  it('still exposes the managed root when the cwd is a mount under source/', async () => {
    const h = await makeHarness();
    const ws = await seedWorkspace(h);
    await addMount(h, ws, { alias: 'api', mode: 'worktree', position: 0 });

    const exposure = await h.manager.getExposure(ws);

    // `source/api` is a SIBLING of `scratch/`, so being inside the workspace
    // tree grants the agent nothing: the root still has to be listed.
    expect(exposure.workingDirectory).toBe(path.join(ws.rootPath, 'source', 'api'));
    expect(exposure.additionalDirectories).toEqual([ws.rootPath]);
  });

  it('drops the managed root from the extras only when it IS the cwd', async () => {
    const h = await makeHarness();
    const ws = await seedWorkspace(h);
    // The back-filled `generated` mount for a workspace with no sources sits
    // at the root itself.
    const exposure = await h.manager.getExposure(ws);

    expect(exposure.workingDirectory).toBe(ws.rootPath);
    expect(exposure.additionalDirectories).toEqual([]);
  });
});
