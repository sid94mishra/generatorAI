// ────────────────────────────────────────────────────────────────
// DrizzleStageEdgeRepository — IStageEdgeRepository impl (v2)
// ────────────────────────────────────────────────────────────────

import { eq, or } from 'drizzle-orm';
import type { IStageEdgeRepository } from '@generatorai/core';
import type { StageEdge, StageEdgeType } from '@generatorai/shared';
import { NotFoundError, StorageError, ConflictError } from '@generatorai/shared';
import { stageEdges } from '../schema.js';
import type { AppDatabase } from '../index.js';

export class DrizzleStageEdgeRepository implements IStageEdgeRepository {
  constructor(private db: AppDatabase) {}

  async create(edge: StageEdge): Promise<StageEdge> {
    try {
      await this.db.insert(stageEdges).values({
        id: edge.id,
        workflowDefinitionId: edge.workflowDefinitionId,
        fromStageId: edge.fromStageId,
        toStageId: edge.toStageId,
        edgeType: edge.edgeType,
      });
      return edge;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // SQLite signals duplicate-key with this exact substring; map to 409 Conflict
      // rather than the previous 500 STORAGE_ERROR so clients can distinguish a
      // duplicate-edge user error from a genuine storage failure.
      if (msg.includes('UNIQUE constraint failed')) {
        throw new ConflictError(
          `Edge from '${edge.fromStageId}' to '${edge.toStageId}' already exists for this workflow`,
          err instanceof Error ? err : undefined,
        );
      }
      throw new StorageError(
        `Failed to create stage edge: ${msg}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  async getById(id: string): Promise<StageEdge> {
    const rows = await this.db
      .select()
      .from(stageEdges)
      .where(eq(stageEdges.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError('StageEdge', id);
    return this.mapRow(row);
  }

  async getByDefinitionId(workflowDefinitionId: string): Promise<StageEdge[]> {
    const rows = await this.db
      .select()
      .from(stageEdges)
      .where(eq(stageEdges.workflowDefinitionId, workflowDefinitionId));
    return rows.map((r) => this.mapRow(r));
  }

  async getByStageId(stageId: string): Promise<StageEdge[]> {
    const rows = await this.db
      .select()
      .from(stageEdges)
      .where(
        or(eq(stageEdges.fromStageId, stageId), eq(stageEdges.toStageId, stageId)),
      );
    return rows.map((r) => this.mapRow(r));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(stageEdges).where(eq(stageEdges.id, id));
  }

  async deleteByDefinitionId(workflowDefinitionId: string): Promise<void> {
    await this.db
      .delete(stageEdges)
      .where(eq(stageEdges.workflowDefinitionId, workflowDefinitionId));
  }

  private mapRow(row: typeof stageEdges.$inferSelect): StageEdge {
    return {
      id: row.id,
      workflowDefinitionId: row.workflowDefinitionId,
      fromStageId: row.fromStageId,
      toStageId: row.toStageId,
      edgeType: row.edgeType as StageEdgeType,
    };
  }
}
