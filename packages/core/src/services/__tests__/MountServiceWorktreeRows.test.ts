// ────────────────────────────────────────────────────────────────
// Worktree mounts are recorded in the project `worktrees` table (#21b).
//
// Chats and runs work in mounts; the `worktrees` table is what a codebase's
// worktree list (G-17), the project counts and the retention sweep read. A
// codebase worktree mount gets a row there under the mount's id, and every
// way the directory goes away (mount removal, release, Remove in the
// worktree list) keeps the two in step. REAL git against a throwaway repo
// (scripts/redesign/make-dummy-repo.mjs — never this checkout); the
// repositories are in-memory fakes.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ExecutionWorkspace,
  ILogger,
  ProjectCodebase,
  WorkspaceMount,
  WorktreeInfo,
  WorktreeStatus,
} from '@generatorai/shared';
import { ConflictError, NotFoundError } from '@generatorai/shared';
import type { IWorktreeRepository } from '../../domain/ports/IWorktreeRepository.js';
import type { IWorkspaceMountRepository } from '../../domain/ports/IWorkspaceMountRepository.js';
import type { IExecutionWorkspaceRepository } from '../../domain/ports/IExecutionWorkspaceRepository.js';
import type { IProjectCodebaseRepository } from '../../domain/ports/IProjectCodebaseRepository.js';
import { GitManager } from '../../infrastructure/GitManager.js';
import { SandboxedScriptRunner } from '../../infrastructure/SandboxedScriptRunner.js';
import { MountService, worktreeOwnerOf } from '../MountService.js';
import { WorktreeService } from '../WorktreeService.js';
import type { ProjectService } from '../ProjectService.js';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: () => logger } as unknown as ILogger;

let dummyRoot: string;
let work: string;
let workspacesDir: string;

beforeAll(async () => {
  const out = execFileSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'redesign', 'make-dummy-repo.mjs')], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
    .toString()
    .trim()
    .split(/\r?\n/);
  work = out[out.length - 1]!;
  dummyRoot = path.dirname(work);
  expect(work).toContain('generatorai-dummy-repo-');
  workspacesDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'generatorai-mount-rows-')));
}, 60_000);

afterAll(() => {
  rmSync(dummyRoot, { recursive: true, force: true });
  rmSync(workspacesDir, { recursive: true, force: true });
});

class MemoryWorktreeRepo implements IWorktreeRepository {
  rows = new Map<string, WorktreeInfo>();
  async create(w: WorktreeInfo) {
    this.rows.set(w.id, { ...w });
    return w;
  }
  async getById(id: string) {
    const row = this.rows.get(id);
    if (!row) throw new NotFoundError('Worktree', id);
    return { ...row };
  }
  async getByProjectId(projectId: string) {
    return [...this.rows.values()].filter((r) => r.projectId === projectId);
  }
  async getByCodebaseId(codebaseId: string) {
    return [...this.rows.values()].filter((r) => r.codebaseId === codebaseId);
  }
  async getByRunId(runId: string) {
    return [...this.rows.values()].filter((r) => r.runId === runId);
  }
  async getByStatus(status: WorktreeStatus) {
    return [...this.rows.values()].filter((r) => r.status === status);
  }
  async updateStatus(id: string, status: WorktreeStatus) {
    const row = this.rows.get(id);
    if (row) row.status = status;
  }
  async delete(id: string) {
    this.rows.delete(id);
  }
  async deleteByProjectId(projectId: string) {
    for (const [id, r] of this.rows) if (r.projectId === projectId) this.rows.delete(id);
  }
}

function memoryMounts() {
  const rows = new Map<string, WorkspaceMount>();
  const repo = {
    create: async (m: WorkspaceMount) => void rows.set(m.id, { ...m }),
    findById: async (id: string) => rows.get(id) ?? null,
    findByWorkspace: async (wsId: string) => [...rows.values()].filter((m) => m.workspaceId === wsId),
    update: async (id: string, patch: Partial<WorkspaceMount>) => {
      const m = rows.get(id);
      if (m) rows.set(id, { ...m, ...patch } as WorkspaceMount);
    },
    delete: async (id: string) => void rows.delete(id),
    deleteByWorkspace: async (wsId: string) => {
      for (const [id, m] of rows) if (m.workspaceId === wsId) rows.delete(id);
    },
  };
  return { rows, repo: repo as unknown as IWorkspaceMountRepository };
}

const codebase = (over: Partial<ProjectCodebase> = {}): ProjectCodebase =>
  ({
    id: 'cb-1',
    projectId: 'p-1',
    alias: 'shop',
    type: 'git-local',
    localPath: work,
    status: 'ready',
    defaultBranch: 'main',
    settings: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  }) as ProjectCodebase;

async function setup(owner: { ownerType: ExecutionWorkspace['ownerType']; ownerId: string }) {
  const git = new GitManager(new SandboxedScriptRunner(logger), logger, { workspacesDir });
  const worktreeRepo = new MemoryWorktreeRepo();
  const mounts = memoryMounts();
  const ws: ExecutionWorkspace = {
    id: `ws-${owner.ownerId}`,
    ...owner,
    projectId: 'p-1',
    rootPath: path.join(workspacesDir, 'executions', owner.ownerId),
    status: 'active',
    prepStatus: 'pending',
    gitEnabled: false,
    useWorktree: true,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  } as ExecutionWorkspace;
  await fs.mkdir(ws.rootPath, { recursive: true });
  const workspaceRepo = {
    findById: async (id: string) => (id === ws.id ? ws : null),
    updatePrep: async () => {},
  } as unknown as IExecutionWorkspaceRepository;
  const cb = codebase();
  const codebaseRepo = {
    getById: async (id: string) => {
      if (id !== cb.id) throw new Error(`codebase not found: ${id}`);
      return cb;
    },
    getByAlias: async (_p: string, alias: string) => (alias === cb.alias ? cb : undefined),
  } as unknown as IProjectCodebaseRepository;
  const mountService = new MountService({
    mountRepo: mounts.repo,
    workspaceRepo,
    git,
    logger,
    workspacesDir,
    codebaseRepo,
    worktreeRepo,
  });
  const worktreeService = new WorktreeService(worktreeRepo, codebaseRepo, {} as ProjectService, git, logger);
  worktreeService.setMountReleaser((id) => mountService.releaseWorktree(id));
  return { git, ws, mounts, worktreeRepo, mountService, worktreeService };
}

async function mountShop(ctx: Awaited<ReturnType<typeof setup>>, mode: 'worktree' | 'in-place', slug: string) {
  const planned = await ctx.mountService.plan(ctx.ws.rootPath, 'p-1', [{ kind: 'codebase', codebaseId: 'cb-1', mode }], { branchSlug: slug });
  const [staged] = await ctx.mountService.stage(ctx.ws.id, planned);
  await ctx.mountService.prepare(ctx.ws.id);
  return ctx.mounts.rows.get(staged!.id)!;
}

const exists = (p: string) => fs.stat(p).then(() => true, () => false);

describe('worktree mounts write worktrees rows', () => {
  it("records a chat's codebase worktree under the mount id, linked to the chat", async () => {
    const ctx = await setup({ ownerType: 'chat', ownerId: 'chat-rows-1' });
    const mount = await mountShop(ctx, 'worktree', 'rows-one');
    expect(mount.status).toBe('ready');

    const row = await ctx.worktreeRepo.getById(mount.id);
    expect(row).toMatchObject({
      projectId: 'p-1',
      codebaseId: 'cb-1',
      runId: 'chat-rows-1',
      runType: 'manual',
      worktreePath: path.resolve(mount.path),
      branchName: 'generatorai/rows-one',
      status: 'active',
    });
    // Preparing again (Retry, a resumed process) does not duplicate it.
    await ctx.mountService.prepare(ctx.ws.id);
    expect(await ctx.worktreeRepo.getByCodebaseId('cb-1')).toHaveLength(1);
  });

  it('does not record an in-place mount — that is the user\'s own folder, not a worktree', async () => {
    const ctx = await setup({ ownerType: 'chat', ownerId: 'chat-rows-2' });
    const mount = await mountShop(ctx, 'in-place', 'unused');
    expect(mount.status).toBe('ready');
    expect(ctx.worktreeRepo.rows.size).toBe(0);
  });

  it('removing the mount drops its row', async () => {
    const ctx = await setup({ ownerType: 'chat', ownerId: 'chat-rows-3' });
    const mount = await mountShop(ctx, 'worktree', 'rows-three');
    await ctx.mountService.remove(mount.id, { deleteBranch: true });
    expect(ctx.worktreeRepo.rows.size).toBe(0);
    expect(await exists(mount.path)).toBe(false);
  });

  it('Remove in the worktree list releases the mount: directory gone, branch kept, mount removed', async () => {
    const ctx = await setup({ ownerType: 'chat', ownerId: 'chat-rows-4' });
    const mount = await mountShop(ctx, 'worktree', 'rows-four');

    // Never while the chat is live.
    await expect(ctx.worktreeService.removeWorktree(mount.id, { refuseActive: true })).rejects.toBeInstanceOf(ConflictError);
    expect(await exists(mount.path)).toBe(true);

    await ctx.worktreeRepo.updateStatus(mount.id, 'orphaned');
    await ctx.worktreeService.removeWorktree(mount.id, { refuseActive: true });

    expect(await exists(mount.path)).toBe(false);
    expect(ctx.worktreeRepo.rows.has(mount.id)).toBe(false);
    expect(ctx.mounts.rows.get(mount.id)?.status).toBe('removed');
    expect(await ctx.git.branchExists(work, 'generatorai/rows-four')).toBe(true);
    // Unregistered from the origin, not just deleted.
    const list = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: work }).toString();
    expect(list).not.toContain(mount.path);
  });

  it('releasing an archived chat\'s worktrees drops their rows', async () => {
    const ctx = await setup({ ownerType: 'chat', ownerId: 'chat-rows-5' });
    const mount = await mountShop(ctx, 'worktree', 'rows-five');
    expect(await ctx.mountService.releaseWorktrees(ctx.ws.id)).toBe(1);
    expect(ctx.worktreeRepo.rows.size).toBe(0);
    expect(ctx.mounts.rows.get(mount.id)?.status).toBe('removed');
  });

  it('a run worktree is recorded for the run, a map item worktree for its parent run', async () => {
    const ctx = await setup({ ownerType: 'workflow_run', ownerId: 'run-rows-6' });
    const mount = await mountShop(ctx, 'worktree', 'rows-six');
    expect(await ctx.worktreeRepo.getById(mount.id)).toMatchObject({ runId: 'run-rows-6', runType: 'workflow' });

    expect(worktreeOwnerOf({ ownerType: 'workflow_run', ownerId: 'run-9~ab12cd34-3' })).toEqual({ runId: 'run-9', runType: 'workflow' });
    expect(worktreeOwnerOf({ ownerType: 'chat', ownerId: 'chat-9' })).toEqual({ runId: 'chat-9', runType: 'manual' });
  });
});
