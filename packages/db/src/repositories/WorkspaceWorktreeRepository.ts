// ────────────────────────────────────────────────────────────────
// DrizzleWorkspaceWorktreeRepository — IWorkspaceWorktreeRepository impl
// ────────────────────────────────────────────────────────────────

import { eq } from 'drizzle-orm';
import type { IWorkspaceWorktreeRepository } from '@generatorai/core';
import type { WorkspaceWorktreeRecord, WorkspaceWorktreeStatus } from '@generatorai/shared';
import { StorageError } from '@generatorai/shared';
import { workspaceWorktrees } from '../schema.js';
import type { AppDatabase } from '../index.js';

export class DrizzleWorkspaceWorktreeRepository implements IWorkspaceWorktreeRepository {
  constructor(private db: AppDatabase) {}

  async create(worktree: WorkspaceWorktreeRecord): Promise<void> {
    try {
      await this.db.insert(workspaceWorktrees).values({
        id: worktree.id,
        workspaceId: worktree.workspaceId,
        codebaseId: worktree.codebaseId,
        alias: worktree.alias,
        branchName: worktree.branchName,
        baseBranch: worktree.baseBranch,
        relativePath: worktree.relativePath,
        status: worktree.status,
        commitHash: worktree.commitHash ?? null,
        hasUncommittedChanges: worktree.hasUncommittedChanges,
        createdAt: worktree.createdAt,
        updatedAt: worktree.updatedAt,
      });
    } catch (err) {
      throw new StorageError(
        `Failed to create workspace worktree: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  async findByWorkspace(workspaceId: string): Promise<WorkspaceWorktreeRecord[]> {
    const rows = await this.db
      .select()
      .from(workspaceWorktrees)
      .where(eq(workspaceWorktrees.workspaceId, workspaceId));
    return rows.map((r) => this.mapRow(r));
  }

  async findByCodebase(codebaseId: string): Promise<WorkspaceWorktreeRecord[]> {
    const rows = await this.db
      .select()
      .from(workspaceWorktrees)
      .where(eq(workspaceWorktrees.codebaseId, codebaseId));
    return rows.map((r) => this.mapRow(r));
  }

  async updateStatus(id: string, status: WorkspaceWorktreeStatus, commitHash?: string): Promise<void> {
    const values: Record<string, unknown> = {
      status,
      updatedAt: new Date(),
    };
    if (commitHash !== undefined) values['commitHash'] = commitHash;

    await this.db.update(workspaceWorktrees).set(values).where(eq(workspaceWorktrees.id, id));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(workspaceWorktrees).where(eq(workspaceWorktrees.id, id));
  }

  async deleteByWorkspace(workspaceId: string): Promise<void> {
    await this.db.delete(workspaceWorktrees).where(eq(workspaceWorktrees.workspaceId, workspaceId));
  }

  private mapRow(row: typeof workspaceWorktrees.$inferSelect): WorkspaceWorktreeRecord {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      codebaseId: row.codebaseId,
      alias: row.alias,
      branchName: row.branchName,
      baseBranch: row.baseBranch,
      relativePath: row.relativePath,
      status: row.status as WorkspaceWorktreeStatus,
      commitHash: row.commitHash ?? undefined,
      hasUncommittedChanges: row.hasUncommittedChanges ?? false,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
