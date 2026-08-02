// ────────────────────────────────────────────────────────────────
// DrizzleArtifactRepository — IArtifactRepository impl
// ────────────────────────────────────────────────────────────────

import { eq, sql } from 'drizzle-orm';
import type { IArtifactRepository } from '@generatorai/core';
import type { Artifact } from '@generatorai/shared';
import { artifacts } from '../schema.js';
import type { AppDatabase } from '../index.js';

export class DrizzleArtifactRepository implements IArtifactRepository {
  constructor(private db: AppDatabase) {}

  async create(artifact: Artifact): Promise<Artifact> {
    await this.db.insert(artifacts).values({
      id: artifact.id,
      sessionId: artifact.sessionId,
      workflowId: artifact.workflowId ?? null,
      name: artifact.name,
      path: artifact.path,
      mimeType: artifact.mimeType ?? null,
      size: artifact.size,
      direction: artifact.direction,
      createdAt: artifact.createdAt,
    });
    return artifact;
  }

  async upsert(artifact: Artifact): Promise<Artifact> {
    await this.db
      .insert(artifacts)
      .values({
        id: artifact.id,
        sessionId: artifact.sessionId,
        workflowId: artifact.workflowId ?? null,
        name: artifact.name,
        path: artifact.path,
        mimeType: artifact.mimeType ?? null,
        size: artifact.size,
        direction: artifact.direction,
        createdAt: artifact.createdAt,
      })
      .onConflictDoUpdate({
        target: artifacts.id,
        set: {
          name: artifact.name,
          path: artifact.path,
          mimeType: artifact.mimeType ?? null,
          size: artifact.size,
        },
      });
    return artifact;
  }

  async getById(id: string): Promise<Artifact | null> {
    const rows = await this.db
      .select()
      .from(artifacts)
      .where(eq(artifacts.id, id))
      .limit(1);
    const row = rows[0];
    return row ? this.mapRow(row) : null;
  }

  async getBySessionId(sessionId: string): Promise<Artifact[]> {
    const rows = await this.db
      .select()
      .from(artifacts)
      .where(eq(artifacts.sessionId, sessionId));
    return rows.map((r) => this.mapRow(r));
  }

  async deleteBySession(sessionId: string): Promise<void> {
    await this.db.delete(artifacts).where(eq(artifacts.sessionId, sessionId));
  }

  private mapRow(row: typeof artifacts.$inferSelect): Artifact {
    return {
      id: row.id,
      sessionId: row.sessionId,
      workflowId: row.workflowId ?? undefined,
      name: row.name,
      path: row.path,
      mimeType: row.mimeType ?? '',
      size: row.size,
      direction: row.direction as 'inbound' | 'outbound',
      createdAt: row.createdAt,
    };
  }
}
