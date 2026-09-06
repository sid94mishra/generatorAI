// ────────────────────────────────────────────────────────────────
// DrizzleWorkspaceMountRepository — IWorkspaceMountRepository impl
// ────────────────────────────────────────────────────────────────

import { eq, and, ne, asc } from 'drizzle-orm';
import type { IWorkspaceMountRepository, WorkspaceMountUpdate } from '@generatorai/core';
import type { WorkspaceMount, MountGitState, MountMode, MountOriginKind, MountStatus } from '@generatorai/shared';
import { StorageError } from '@generatorai/shared';
import { workspaceMounts } from '../schema.js';
import type { AppDatabase } from '../index.js';

export class DrizzleWorkspaceMountRepository implements IWorkspaceMountRepository {
  constructor(private db: AppDatabase) {}

  async create(mount: WorkspaceMount): Promise<void> {
    try {
      await this.db.insert(workspaceMounts).values({
        id: mount.id,
        workspaceId: mount.workspaceId,
        position: mount.position,
        alias: mount.alias,
        originKind: mount.originKind,
        codebaseId: mount.codebaseId ?? null,
        projectId: mount.projectId ?? null,
        originPath: mount.originPath ?? null,
        mode: mount.mode,
        path: mount.path,
        git: (mount.git as Record<string, unknown> | undefined) ?? null,
        status: mount.status,
        error: mount.error ?? null,
        hasUncommittedChanges: mount.hasUncommittedChanges,
        createdAt: mount.createdAt,
        updatedAt: mount.updatedAt,
      });
    } catch (err) {
      throw new StorageError(
        `Failed to create workspace mount: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  async findById(id: string): Promise<WorkspaceMount | null> {
    const rows = await this.db.select().from(workspaceMounts).where(eq(workspaceMounts.id, id)).limit(1);
    const row = rows[0];
    return row ? this.mapRow(row) : null;
  }

  async findByWorkspace(workspaceId: string, opts?: { includeRemoved?: boolean }): Promise<WorkspaceMount[]> {
    const where = opts?.includeRemoved
      ? eq(workspaceMounts.workspaceId, workspaceId)
      : and(eq(workspaceMounts.workspaceId, workspaceId), ne(workspaceMounts.status, 'removed'));
    const rows = await this.db
      .select()
      .from(workspaceMounts)
      .where(where)
      .orderBy(asc(workspaceMounts.position), asc(workspaceMounts.createdAt));
    return rows.map((r) => this.mapRow(r));
  }

  async findByCodebase(codebaseId: string): Promise<WorkspaceMount[]> {
    const rows = await this.db
      .select()
      .from(workspaceMounts)
      .where(and(eq(workspaceMounts.codebaseId, codebaseId), ne(workspaceMounts.status, 'removed')));
    return rows.map((r) => this.mapRow(r));
  }

  async update(id: string, updates: WorkspaceMountUpdate): Promise<void> {
    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.status !== undefined) values['status'] = updates.status;
    if (updates.error !== undefined) values['error'] = updates.error;
    if (updates.git !== undefined) values['git'] = updates.git;
    if (updates.path !== undefined) values['path'] = updates.path;
    if (updates.position !== undefined) values['position'] = updates.position;
    if (updates.hasUncommittedChanges !== undefined) values['hasUncommittedChanges'] = updates.hasUncommittedChanges;
    await this.db.update(workspaceMounts).set(values).where(eq(workspaceMounts.id, id));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(workspaceMounts).where(eq(workspaceMounts.id, id));
  }

  async deleteByWorkspace(workspaceId: string): Promise<void> {
    await this.db.delete(workspaceMounts).where(eq(workspaceMounts.workspaceId, workspaceId));
  }

  private mapRow(row: typeof workspaceMounts.$inferSelect): WorkspaceMount {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      position: row.position,
      alias: row.alias,
      originKind: row.originKind as MountOriginKind,
      codebaseId: row.codebaseId ?? undefined,
      projectId: row.projectId ?? undefined,
      originPath: row.originPath ?? undefined,
      mode: row.mode as MountMode,
      path: row.path,
      git: (row.git as MountGitState | null) ?? undefined,
      status: row.status as MountStatus,
      error: row.error ?? undefined,
      hasUncommittedChanges: row.hasUncommittedChanges ?? false,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
