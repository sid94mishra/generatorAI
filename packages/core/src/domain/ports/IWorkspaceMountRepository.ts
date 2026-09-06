// ────────────────────────────────────────────────────────────────
// IWorkspaceMountRepository — Port for workspace mount persistence
// ────────────────────────────────────────────────────────────────

import type { WorkspaceMount, MountStatus, MountGitState } from '@generatorai/shared';

export interface WorkspaceMountUpdate {
  status?: MountStatus;
  error?: string | null;
  git?: MountGitState;
  path?: string;
  position?: number;
  hasUncommittedChanges?: boolean;
}

export interface IWorkspaceMountRepository {
  create(mount: WorkspaceMount): Promise<void>;
  findById(id: string): Promise<WorkspaceMount | null>;
  /** Ordered by position. Excludes `removed` mounts unless asked. */
  findByWorkspace(workspaceId: string, opts?: { includeRemoved?: boolean }): Promise<WorkspaceMount[]>;
  findByCodebase(codebaseId: string): Promise<WorkspaceMount[]>;
  update(id: string, updates: WorkspaceMountUpdate): Promise<void>;
  delete(id: string): Promise<void>;
  deleteByWorkspace(workspaceId: string): Promise<void>;
}
