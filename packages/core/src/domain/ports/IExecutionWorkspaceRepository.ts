// ────────────────────────────────────────────────────────────────
// IExecutionWorkspaceRepository — Port for Execution Workspace persistence
// ────────────────────────────────────────────────────────────────

import type {
  ExecutionWorkspace,
  WorkspaceFilters,
  WorkspaceOwnerType,
  WorkspaceStatus,
} from '@generatorai/shared';

export interface IExecutionWorkspaceRepository {
  create(workspace: ExecutionWorkspace): Promise<void>;
  findById(id: string): Promise<ExecutionWorkspace | null>;
  findByOwner(ownerType: WorkspaceOwnerType, ownerId: string): Promise<ExecutionWorkspace | null>;
  findByProject(projectId: string): Promise<ExecutionWorkspace[]>;
  list(filters: WorkspaceFilters): Promise<ExecutionWorkspace[]>;
  updateStatus(id: string, status: WorkspaceStatus, updates?: Partial<ExecutionWorkspace>): Promise<void>;
  delete(id: string): Promise<void>;
}
