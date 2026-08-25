// ────────────────────────────────────────────────────────────────
// DrizzleWorkspaceArtifactRepository — IWorkspaceArtifactRepository impl
// ────────────────────────────────────────────────────────────────

import { eq } from 'drizzle-orm';
import type { IWorkspaceArtifactRepository } from '@generatorai/core';
import type { WorkspaceArtifactRecord } from '@generatorai/shared';
import { StorageError } from '@generatorai/shared';
import { workspaceArtifacts } from '../schema.js';
import type { AppDatabase } from '../index.js';

export class DrizzleWorkspaceArtifactRepository implements IWorkspaceArtifactRepository {
  constructor(private db: AppDatabase) {}

  async create(artifact: WorkspaceArtifactRecord): Promise<void> {
    try {
      await this.db.insert(workspaceArtifacts).values({
        id: artifact.id,
        workspaceId: artifact.workspaceId,
        stageRunId: artifact.stageRunId ?? null,
        artifactType: artifact.artifactType,
        relativePath: artifact.relativePath,
        fileSize: artifact.fileSize ?? null,
        mimeType: artifact.mimeType ?? null,
        metadata: artifact.metadata ?? null,
        createdAt: artifact.createdAt,
      });
    } catch (err) {
      throw new StorageError(
        `Failed to create workspace artifact: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  /** P1-31: Direct lookup avoids loading all workspace artifact rows. */
  async findById(id: string): Promise<WorkspaceArtifactRecord | null> {
    const rows = await this.db
      .select()
      .from(workspaceArtifacts)
      .where(eq(workspaceArtifacts.id, id))
      .limit(1);
    return rows.length > 0 ? this.mapRow(rows[0]!) : null;
  }

  async findByWorkspace(workspaceId: string): Promise<WorkspaceArtifactRecord[]> {
    const rows = await this.db
      .select()
      .from(workspaceArtifacts)
      .where(eq(workspaceArtifacts.workspaceId, workspaceId));
    return rows.map((r) => this.mapRow(r));
  }

  async findByStageRun(stageRunId: string): Promise<WorkspaceArtifactRecord[]> {
    const rows = await this.db
      .select()
      .from(workspaceArtifacts)
      .where(eq(workspaceArtifacts.stageRunId, stageRunId));
    return rows.map((r) => this.mapRow(r));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(workspaceArtifacts).where(eq(workspaceArtifacts.id, id));
  }

  async deleteByWorkspace(workspaceId: string): Promise<void> {
    await this.db.delete(workspaceArtifacts).where(eq(workspaceArtifacts.workspaceId, workspaceId));
  }

  private mapRow(row: typeof workspaceArtifacts.$inferSelect): WorkspaceArtifactRecord {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      stageRunId: row.stageRunId ?? undefined,
      artifactType: row.artifactType as WorkspaceArtifactRecord['artifactType'],
      relativePath: row.relativePath,
      fileSize: row.fileSize ?? undefined,
      mimeType: row.mimeType ?? undefined,
      metadata: (row.metadata as Record<string, unknown>) ?? undefined,
      createdAt: row.createdAt,
    };
  }
}
