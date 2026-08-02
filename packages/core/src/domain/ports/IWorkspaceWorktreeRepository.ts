// ────────────────────────────────────────────────────────────────
// IWorkspaceWorktreeRepository — Port for Workspace Worktree persistence
// ────────────────────────────────────────────────────────────────

import type {
  WorkspaceWorktreeRecord,
  WorkspaceWorktreeStatus,
} from '@generatorai/shared';

export interface IWorkspaceWorktreeRepository {
  create(worktree: WorkspaceWorktreeRecord): Promise<void>;
  findByWorkspace(workspaceId: string): Promise<WorkspaceWorktreeRecord[]>;
  findByCodebase(codebaseId: string): Promise<WorkspaceWorktreeRecord[]>;
  updateStatus(id: string, status: WorkspaceWorktreeStatus, commitHash?: string): Promise<void>;
  delete(id: string): Promise<void>;
  deleteByWorkspace(workspaceId: string): Promise<void>;
}
