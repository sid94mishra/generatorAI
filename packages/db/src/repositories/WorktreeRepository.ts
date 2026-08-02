// ────────────────────────────────────────────────────────────────
// DrizzleWorktreeRepository — IWorktreeRepository impl
// ────────────────────────────────────────────────────────────────

import { eq } from 'drizzle-orm';
import type { IWorktreeRepository } from '@generatorai/core';
import type { WorktreeInfo, WorktreeStatus } from '@generatorai/shared';
import { NotFoundError, StorageError } from '@generatorai/shared';
import { worktrees } from '../schema.js';
import type { AppDatabase } from '../index.js';

export class DrizzleWorktreeRepository implements IWorktreeRepository {
  constructor(private db: AppDatabase) {}

  async create(worktree: WorktreeInfo): Promise<WorktreeInfo> {
    try {
      await this.db.insert(worktrees).values({
        id: worktree.id,
        projectId: worktree.projectId,
        codebaseId: worktree.codebaseId,
        runId: worktree.runId ?? null,
        runType: worktree.runType ?? null,
        worktreePath: worktree.worktreePath,
        branchName: worktree.branchName,
        status: worktree.status,
        createdAt: worktree.createdAt,
        cleanedUpAt: worktree.cleanedUpAt ?? null,
      });
      return worktree;
    } catch (err) {
      throw new StorageError(
        `Failed to create worktree: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  async getById(id: string): Promise<WorktreeInfo> {
    const rows = await this.db
      .select()
      .from(worktrees)
      .where(eq(worktrees.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError('Worktree', id);
    return this.mapRow(row);
  }

  async getByProjectId(projectId: string): Promise<WorktreeInfo[]> {
    const rows = await this.db
      .select()
      .from(worktrees)
      .where(eq(worktrees.projectId, projectId))
      .orderBy(worktrees.createdAt);
    return rows.map((r) => this.mapRow(r));
  }

  async getByCodebaseId(codebaseId: string): Promise<WorktreeInfo[]> {
    const rows = await this.db
      .select()
      .from(worktrees)
      .where(eq(worktrees.codebaseId, codebaseId))
      .orderBy(worktrees.createdAt);
    return rows.map((r) => this.mapRow(r));
  }

  async getByRunId(runId: string): Promise<WorktreeInfo[]> {
    const rows = await this.db
      .select()
      .from(worktrees)
      .where(eq(worktrees.runId, runId))
      .orderBy(worktrees.createdAt);
    return rows.map((r) => this.mapRow(r));
  }

  async getByStatus(status: WorktreeStatus): Promise<WorktreeInfo[]> {
    const rows = await this.db
      .select()
      .from(worktrees)
      .where(eq(worktrees.status, status))
      .orderBy(worktrees.createdAt);
    return rows.map((r) => this.mapRow(r));
  }

  async updateStatus(id: string, status: WorktreeStatus): Promise<void> {
    const values: Record<string, unknown> = { status };
    if (status === 'completed' || status === 'cleanup-pending') {
      values['cleanedUpAt'] = new Date();
    }
    await this.db.update(worktrees).set(values).where(eq(worktrees.id, id));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(worktrees).where(eq(worktrees.id, id));
  }

  async deleteByProjectId(projectId: string): Promise<void> {
    await this.db.delete(worktrees).where(eq(worktrees.projectId, projectId));
  }

  private mapRow(row: typeof worktrees.$inferSelect): WorktreeInfo {
    return {
      id: row.id,
      projectId: row.projectId,
      codebaseId: row.codebaseId,
      runId: row.runId ?? undefined,
      runType: row.runType ? (row.runType as WorktreeInfo['runType']) : undefined,
      worktreePath: row.worktreePath,
      branchName: row.branchName,
      status: row.status as WorktreeStatus,
      createdAt: row.createdAt,
      cleanedUpAt: row.cleanedUpAt ?? undefined,
    };
  }
}
