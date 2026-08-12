// ────────────────────────────────────────────────────────────────
// DrizzleExecutionWorkspaceRepository — IExecutionWorkspaceRepository impl
// ────────────────────────────────────────────────────────────────

import { eq, and } from 'drizzle-orm';
import type { IExecutionWorkspaceRepository } from '@generatorai/core';
import type {
  BrowserSessionStatus,
  ExecutionWorkspace,
  WorkspaceFilters,
  WorkspaceOwnerType,
  WorkspaceStatus,
} from '@generatorai/shared';
import { StorageError } from '@generatorai/shared';
import { executionWorkspaces } from '../schema.js';
import type { AppDatabase } from '../index.js';

export class DrizzleExecutionWorkspaceRepository implements IExecutionWorkspaceRepository {
  constructor(private db: AppDatabase) {}

  async create(workspace: ExecutionWorkspace): Promise<void> {
    try {
      await this.db.insert(executionWorkspaces).values({
        id: workspace.id,
        ownerType: workspace.ownerType,
        ownerId: workspace.ownerId,
        projectId: workspace.projectId ?? null,
        rootPath: workspace.rootPath,
        codeRoot: workspace.codeRoot ?? null,
        status: workspace.status,
        gitEnabled: workspace.gitEnabled,
        useWorktree: workspace.useWorktree,
        snapshotPath: workspace.snapshotPath ?? null,
        metadata: workspace.metadata ?? null,
        browserConfig: workspace.browserConfig ?? null,
        browserStatus: workspace.browserStatus ?? null,
        browserCurrentUrl: workspace.browserCurrentUrl ?? null,
        browserCdpEndpoint: workspace.browserCdpEndpoint ?? null,
        browserTargetId: workspace.browserTargetId ?? null,
        browserStartedAt: workspace.browserStartedAt ?? null,
        browserLastActivityAt: workspace.browserLastActivityAt ?? null,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
        completedAt: workspace.completedAt ?? null,
        archivedAt: workspace.archivedAt ?? null,
      });
    } catch (err) {
      throw new StorageError(
        `Failed to create execution workspace: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  async findById(id: string): Promise<ExecutionWorkspace | null> {
    const rows = await this.db
      .select()
      .from(executionWorkspaces)
      .where(eq(executionWorkspaces.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapRow(row);
  }

  async findByOwner(ownerType: WorkspaceOwnerType, ownerId: string): Promise<ExecutionWorkspace | null> {
    const rows = await this.db
      .select()
      .from(executionWorkspaces)
      .where(
        and(
          eq(executionWorkspaces.ownerType, ownerType),
          eq(executionWorkspaces.ownerId, ownerId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapRow(row);
  }

  async findByProject(projectId: string): Promise<ExecutionWorkspace[]> {
    const rows = await this.db
      .select()
      .from(executionWorkspaces)
      .where(eq(executionWorkspaces.projectId, projectId));
    return rows.map((r) => this.mapRow(r));
  }

  async list(filters: WorkspaceFilters): Promise<ExecutionWorkspace[]> {
    let query = this.db.select().from(executionWorkspaces);

    const conditions = [];
    if (filters.ownerType) {
      conditions.push(eq(executionWorkspaces.ownerType, filters.ownerType));
    }
    if (filters.projectId) {
      conditions.push(eq(executionWorkspaces.projectId, filters.projectId));
    }
    if (filters.status) {
      conditions.push(eq(executionWorkspaces.status, filters.status));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    if (filters.limit) {
      query = query.limit(filters.limit) as typeof query;
    }
    if (filters.offset) {
      query = query.offset(filters.offset) as typeof query;
    }

    const rows = await query;
    return rows.map((r) => this.mapRow(r));
  }

  async updateStatus(id: string, status: WorkspaceStatus, updates?: Partial<ExecutionWorkspace>): Promise<void> {
    const values: Record<string, unknown> = {
      status,
      updatedAt: new Date(),
    };
    if (updates?.completedAt) values['completedAt'] = updates.completedAt;
    if (updates?.archivedAt) values['archivedAt'] = updates.archivedAt;
    if (updates?.snapshotPath) values['snapshotPath'] = updates.snapshotPath;
    if (updates?.metadata) values['metadata'] = updates.metadata;
    // Integrated Browser fields — allow callers (BrowserService) to flow
    // browser lifecycle updates through the same repo.
    if (updates?.browserConfig !== undefined) values['browserConfig'] = updates.browserConfig;
    if (updates?.browserStatus !== undefined) values['browserStatus'] = updates.browserStatus;
    if (updates?.browserCurrentUrl !== undefined) values['browserCurrentUrl'] = updates.browserCurrentUrl;
    if (updates?.browserCdpEndpoint !== undefined) values['browserCdpEndpoint'] = updates.browserCdpEndpoint;
    if (updates?.browserTargetId !== undefined) values['browserTargetId'] = updates.browserTargetId;
    if (updates?.browserStartedAt !== undefined) values['browserStartedAt'] = updates.browserStartedAt;
    if (updates?.browserLastActivityAt !== undefined) values['browserLastActivityAt'] = updates.browserLastActivityAt;

    await this.db.update(executionWorkspaces).set(values).where(eq(executionWorkspaces.id, id));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(executionWorkspaces).where(eq(executionWorkspaces.id, id));
  }

  private mapRow(row: typeof executionWorkspaces.$inferSelect): ExecutionWorkspace {
    return {
      id: row.id,
      ownerType: row.ownerType as WorkspaceOwnerType,
      ownerId: row.ownerId,
      projectId: row.projectId ?? undefined,
      rootPath: row.rootPath,
      codeRoot: row.codeRoot ?? undefined,
      status: row.status as WorkspaceStatus,
      gitEnabled: row.gitEnabled,
      useWorktree: row.useWorktree,
      snapshotPath: row.snapshotPath ?? undefined,
      metadata: (row.metadata as Record<string, unknown>) ?? undefined,
      browserConfig: (row.browserConfig as Record<string, unknown>) ?? undefined,
      browserStatus: (row.browserStatus as BrowserSessionStatus | null) ?? undefined,
      browserCurrentUrl: row.browserCurrentUrl ?? undefined,
      browserCdpEndpoint: row.browserCdpEndpoint ?? undefined,
      browserTargetId: row.browserTargetId ?? undefined,
      browserStartedAt: row.browserStartedAt ?? undefined,
      browserLastActivityAt: row.browserLastActivityAt ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      completedAt: row.completedAt ?? undefined,
      archivedAt: row.archivedAt ?? undefined,
    };
  }
}
