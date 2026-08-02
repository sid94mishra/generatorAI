// ────────────────────────────────────────────────────────────────
// WorktreeCleanupService Tests — chat-aware orphan detection (DATA-1)
// and per-project scoped cleanup (DATA-2).
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorktreeCleanupService } from '../src/services/WorktreeCleanupService.js';
import type { WorktreeService } from '../src/services/WorktreeService.js';
import type { IWorktreeRepository, IProjectRepository, IChatRepository } from '../src/domain/ports/index.js';
import type { IWorkflowRunRepository } from '../src/domain/ports/IWorkflowRunRepository.js';
import type { ILogger } from '@generatorai/shared';

const noopLogger = {
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(),
} as unknown as ILogger;

function wt(over: Record<string, unknown>) {
  return {
    id: 'wt', projectId: 'p1', codebaseId: 'cb', runId: 'r', runType: 'workflow',
    worktreePath: '/tmp/x', branchName: 'b', status: 'active', createdAt: new Date(),
    ...over,
  };
}

describe('WorktreeCleanupService — orphan detection (DATA-1)', () => {
  let worktreeService: WorktreeService;
  let worktreeRepo: IWorktreeRepository;
  let projectRepo: IProjectRepository;
  let workflowRunRepo: IWorkflowRunRepository;
  let chatRepo: IChatRepository;
  let updateStatus: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    updateStatus = vi.fn(async () => {});
    worktreeService = { removeWorktree: vi.fn(async () => {}) } as unknown as WorktreeService;
    worktreeRepo = {
      getByStatus: vi.fn(async () => [
        wt({ id: 'wt-chat-active', runId: 'chat-1', runType: 'manual' }),
        wt({ id: 'wt-chat-archived', runId: 'chat-2', runType: 'manual' }),
        wt({ id: 'wt-run-terminal', runId: 'run-1', runType: 'workflow' }),
        wt({ id: 'wt-run-active', runId: 'run-2', runType: 'workflow' }),
      ]),
      updateStatus,
      delete: vi.fn(async () => {}),
      getByProjectId: vi.fn(async () => []),
    } as unknown as IWorktreeRepository;
    projectRepo = {
      getById: vi.fn(async () => ({ id: 'p1', settings: { worktreeRetention: 'hours-24' } })),
      getAll: vi.fn(async () => []),
    } as unknown as IProjectRepository;
    workflowRunRepo = {
      getById: vi.fn(async (id: string) => {
        if (id === 'run-1') return { status: 'completed' };
        if (id === 'run-2') return { status: 'running' };
        throw new Error('not found');
      }),
    } as unknown as IWorkflowRunRepository;
    chatRepo = {
      getById: vi.fn(async (id: string) => {
        if (id === 'chat-1') return { status: 'active' };
        if (id === 'chat-2') return { status: 'archived' };
        throw new Error('not found');
      }),
    } as unknown as IChatRepository;
  });

  it('does NOT orphan a chat worktree whose chat is still active', async () => {
    const svc = new WorktreeCleanupService(worktreeService, worktreeRepo, projectRepo, workflowRunRepo, noopLogger, chatRepo);
    await svc.recoverOnStartup();
    const orphanedIds = updateStatus.mock.calls.map((c) => c[0]);
    expect(orphanedIds).not.toContain('wt-chat-active');
  });

  it('orphans a chat worktree whose chat is archived', async () => {
    const svc = new WorktreeCleanupService(worktreeService, worktreeRepo, projectRepo, workflowRunRepo, noopLogger, chatRepo);
    await svc.recoverOnStartup();
    const orphanedIds = updateStatus.mock.calls.map((c) => c[0]);
    expect(orphanedIds).toContain('wt-chat-archived');
  });

  it('orphans a workflow worktree whose run is terminal but not one whose run is active', async () => {
    const svc = new WorktreeCleanupService(worktreeService, worktreeRepo, projectRepo, workflowRunRepo, noopLogger, chatRepo);
    await svc.recoverOnStartup();
    const orphanedIds = updateStatus.mock.calls.map((c) => c[0]);
    expect(orphanedIds).toContain('wt-run-terminal');
    expect(orphanedIds).not.toContain('wt-run-active');
  });

  it('conservatively does NOT orphan chat worktrees when no chat repo is wired', async () => {
    const svc = new WorktreeCleanupService(worktreeService, worktreeRepo, projectRepo, workflowRunRepo, noopLogger /* no chatRepo */);
    await svc.recoverOnStartup();
    const orphanedIds = updateStatus.mock.calls.map((c) => c[0]);
    expect(orphanedIds).not.toContain('wt-chat-active');
    expect(orphanedIds).not.toContain('wt-chat-archived');
    // workflow worktrees still evaluated normally
    expect(orphanedIds).toContain('wt-run-terminal');
  });
});

describe('WorktreeCleanupService — per-project scoping (DATA-2)', () => {
  it('runCleanupForProject only touches the requested project (no global sweep)', async () => {
    const getByProjectId = vi.fn(async () => [
      wt({ id: 'stale-1', projectId: 'p1', status: 'completed' }),
    ]);
    const del = vi.fn(async () => {});
    const getAll = vi.fn(async () => []);
    const worktreeService = { removeWorktree: vi.fn(async () => {}) } as unknown as WorktreeService;
    const worktreeRepo = {
      getByProjectId, delete: del, updateStatus: vi.fn(async () => {}),
    } as unknown as IWorktreeRepository;
    const projectRepo = {
      getById: vi.fn(async () => ({ id: 'p1', settings: { worktreeRetention: 'hours-24' } })),
      getAll,
    } as unknown as IProjectRepository;
    const workflowRunRepo = { getById: vi.fn() } as unknown as IWorkflowRunRepository;

    const svc = new WorktreeCleanupService(worktreeService, worktreeRepo, projectRepo, workflowRunRepo, noopLogger);
    const result = await svc.runCleanupForProject('p1');

    expect(getByProjectId).toHaveBeenCalledWith('p1');
    expect(getByProjectId).toHaveBeenCalledTimes(1); // only p1, no sweep over all projects
    expect(getAll).not.toHaveBeenCalled(); // global sweep would enumerate all projects
    expect(result.cleaned).toBe(1); // the stale 'completed' record was reclaimed
  });
});
