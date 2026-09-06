// ────────────────────────────────────────────────────────────────
// IExecutionWorkspaceRepository — Port for Execution Workspace persistence
// ────────────────────────────────────────────────────────────────

import type {
  ExecutionWorkspace,
  WorkspaceFilters,
  WorkspaceOwnerType,
  WorkspaceStatus,
  WorkspacePrepStatus,
} from '@generatorai/shared';

export interface IExecutionWorkspaceRepository {
  create(workspace: ExecutionWorkspace): Promise<void>;
  findById(id: string): Promise<ExecutionWorkspace | null>;
  findByOwner(ownerType: WorkspaceOwnerType, ownerId: string): Promise<ExecutionWorkspace | null>;
  findByProject(projectId: string): Promise<ExecutionWorkspace[]>;
  list(filters: WorkspaceFilters): Promise<ExecutionWorkspace[]>;
  updateStatus(id: string, status: WorkspaceStatus, updates?: Partial<ExecutionWorkspace>): Promise<void>;
  /** Mount preparation state — gates the first prompt of a chat. */
  updatePrep(id: string, prepStatus: WorkspacePrepStatus, prepError?: string | null): Promise<void>;
  delete(id: string): Promise<void>;
}
