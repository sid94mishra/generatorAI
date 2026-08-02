// ────────────────────────────────────────────────────────────────
// WorkspaceFacade — ai.workspaces.*
//
// Execution workspace isolation — each workflow run gets its own
// workspace directory for artifacts, git worktrees, etc.
// ────────────────────────────────────────────────────────────────

import type { WorkspaceManager } from '@generatorai/core';
import type { WorkspaceOwnerType, WorkspaceStatus } from '@generatorai/shared';

export interface CreateWorkspaceInput {
  ownerId: string;
  ownerType: WorkspaceOwnerType;
  label?: string;
  gitEnabled?: boolean;
}

export interface WorkspaceFilters {
  ownerType?: WorkspaceOwnerType;
  status?: WorkspaceStatus;
}

export class WorkspaceFacade {
  constructor(private workspaceManager: WorkspaceManager) {}

  /** Create an execution workspace for a run/chat */
  async create(input: CreateWorkspaceInput) {
    return this.workspaceManager.createWorkspace(input as never);
  }

  /** Find workspace by owner (run ID, chat ID, etc.) */
  async findByOwner(ownerId: string) {
    return this.workspaceManager.findWorkspaceByOwner(ownerId);
  }

  /** Get workspace info with tracked artifacts */
  async get(workspaceId: string) {
    return this.workspaceManager.getWorkspaceInfo(workspaceId);
  }

  /** List workspaces with optional filters */
  async list(filters?: WorkspaceFilters) {
    return this.workspaceManager.listWorkspaces(filters ?? {} as never);
  }

  /** Mark workspace as completed */
  async complete(workspaceId: string) {
    return this.workspaceManager.completeWorkspace(workspaceId);
  }

  /** Archive workspace (compress + move) */
  async archive(workspaceId: string) {
    return this.workspaceManager.archiveWorkspace(workspaceId);
  }

  /** Delete workspace and all its files */
  async delete(workspaceId: string) {
    return this.workspaceManager.deleteWorkspace(workspaceId);
  }

  /** Resolve a relative path within a workspace (safe, prevents traversal) */
  async resolvePath(workspaceId: string, relativePath: string) {
    return this.workspaceManager.resolvePathInWorkspace(workspaceId, relativePath);
  }

  /** Git commit all changes in a workspace */
  async commit(workspaceId: string, message?: string) {
    return this.workspaceManager.commitWorkspace(workspaceId, message);
  }

  /** Track a generated artifact in the workspace */
  async trackArtifact(params: {
    workspaceId: string;
    filePath: string;
    artifactType: string;
    metadata?: Record<string, unknown>;
  }) {
    return this.workspaceManager.trackArtifact(params as never);
  }
}
