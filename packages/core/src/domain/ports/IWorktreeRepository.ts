// ────────────────────────────────────────────────────────────────
// IWorktreeRepository — Port for Worktree tracking persistence
// ────────────────────────────────────────────────────────────────

import type { WorktreeInfo, WorktreeStatus } from '@generatorai/shared';

export interface IWorktreeRepository {
  create(worktree: WorktreeInfo): Promise<WorktreeInfo>;
  getById(id: string): Promise<WorktreeInfo>;
  getByProjectId(projectId: string): Promise<WorktreeInfo[]>;
  getByCodebaseId(codebaseId: string): Promise<WorktreeInfo[]>;
  getByRunId(runId: string): Promise<WorktreeInfo[]>;
  getByStatus(status: WorktreeStatus): Promise<WorktreeInfo[]>;
  updateStatus(id: string, status: WorktreeStatus): Promise<void>;
  delete(id: string): Promise<void>;
  deleteByProjectId(projectId: string): Promise<void>;
}
