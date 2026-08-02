// ────────────────────────────────────────────────────────────────
// DrizzleSessionAllocationRepository — persisted SessionAllocator state
// ────────────────────────────────────────────────────────────────

import { eq } from 'drizzle-orm';
import type {
  ISessionAllocationRepository,
  SessionAllocationRow,
  StageSessionMapRow,
} from '@generatorai/core';
import type { WorkflowSessionMode } from '@generatorai/shared';
import { sessionAllocations, stageSessionMaps } from '../schema.js';
import type { AppDatabase } from '../index.js';

export class DrizzleSessionAllocationRepository implements ISessionAllocationRepository {
  constructor(private db: AppDatabase) {}

  async createAllocation(row: SessionAllocationRow): Promise<SessionAllocationRow> {
    await this.db.insert(sessionAllocations).values({
      id: row.id,
      workflowRunId: row.workflowRunId,
      mode: row.mode,
      sharedSessionId: row.sharedSessionId ?? null,
      sharedRefCount: row.sharedRefCount,
      createdAt: row.createdAt,
    });
    return row;
  }

  async getByRunId(workflowRunId: string): Promise<SessionAllocationRow | null> {
    const rows = await this.db
      .select()
      .from(sessionAllocations)
      .where(eq(sessionAllocations.workflowRunId, workflowRunId))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return this.mapAllocation(r);
  }

  async listAllocations(): Promise<SessionAllocationRow[]> {
    const rows = await this.db.select().from(sessionAllocations);
    return rows.map((r) => this.mapAllocation(r));
  }

  async updateAllocation(
    id: string,
    updates: Partial<Pick<SessionAllocationRow, 'sharedSessionId' | 'sharedRefCount'>>,
  ): Promise<void> {
    const patch: Record<string, unknown> = {};
    if ('sharedSessionId' in updates) patch['sharedSessionId'] = updates.sharedSessionId ?? null;
    if ('sharedRefCount' in updates) patch['sharedRefCount'] = updates.sharedRefCount ?? 0;
    if (Object.keys(patch).length === 0) return;
    await this.db.update(sessionAllocations).set(patch).where(eq(sessionAllocations.id, id));
  }

  async deleteAllocation(id: string): Promise<void> {
    // FK ON DELETE CASCADE removes child rows in stage_session_maps.
    await this.db.delete(sessionAllocations).where(eq(sessionAllocations.id, id));
  }

  async putStageSession(row: StageSessionMapRow): Promise<void> {
    // Upsert: the unique index on stage_run_id guarantees at most one row
    // per stage; conflict replaces the session binding (allocator mode
    // change, or reassignment on resume).
    await this.db
      .insert(stageSessionMaps)
      .values({
        id: row.id,
        allocationId: row.allocationId,
        stageRunId: row.stageRunId,
        sessionId: row.sessionId,
      })
      .onConflictDoUpdate({
        target: stageSessionMaps.stageRunId,
        set: { allocationId: row.allocationId, sessionId: row.sessionId },
      });
  }

  async listStageSessions(allocationId: string): Promise<StageSessionMapRow[]> {
    const rows = await this.db
      .select()
      .from(stageSessionMaps)
      .where(eq(stageSessionMaps.allocationId, allocationId));
    return rows.map((r) => ({
      id: r.id,
      allocationId: r.allocationId,
      stageRunId: r.stageRunId,
      sessionId: r.sessionId,
    }));
  }

  async deleteStageSession(stageRunId: string): Promise<void> {
    await this.db.delete(stageSessionMaps).where(eq(stageSessionMaps.stageRunId, stageRunId));
  }

  private mapAllocation(r: typeof sessionAllocations.$inferSelect): SessionAllocationRow {
    return {
      id: r.id,
      workflowRunId: r.workflowRunId,
      mode: r.mode as WorkflowSessionMode,
      sharedSessionId: r.sharedSessionId ?? null,
      sharedRefCount: r.sharedRefCount,
      createdAt: r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt as unknown as number),
    };
  }
}
