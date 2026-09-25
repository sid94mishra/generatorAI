// ────────────────────────────────────────────────────────────────
// DrizzleSessionAllocationRepository — persisted SessionAllocator state
// (v1 engine).
//
// v57 replaced `session_allocations` and `stage_session_maps` with the v2
// engine's `run_sessions`. Until the P03 cutover deletes the v1 allocator,
// its state is kept there (P03 WP-3.2 deviation, DEVIATIONS.md):
//   - an allocation is the run's `@v1-allocation` row: `session_id` holds
//     the shared session ('' when none) and `config_hash` holds
//     `{mode, sharedRefCount}` as JSON;
//   - a stage mapping is a `@v1-stage:<stageRunId>` row whose
//     `owner_scope_id` is the stage run and whose `config_hash` is the
//     allocation id.
// ────────────────────────────────────────────────────────────────

import { and, eq, like } from 'drizzle-orm';
import type {
  ISessionAllocationRepository,
  SessionAllocationRow,
  StageSessionMapRow,
} from '@generatorai/core';
import type { WorkflowSessionMode } from '@generatorai/shared';
import { runSessions } from '../schema.js';
import type { AppDatabase } from '../index.js';

const ALLOCATION_KEY = '@v1-allocation';
const STAGE_KEY_PREFIX = '@v1-stage:';

interface AllocationState {
  mode: WorkflowSessionMode;
  sharedRefCount: number;
}

function allocationState(configHash: string): AllocationState {
  try {
    const parsed = JSON.parse(configHash) as Partial<AllocationState>;
    return { mode: parsed.mode ?? 'per-stage', sharedRefCount: parsed.sharedRefCount ?? 0 };
  } catch {
    return { mode: 'per-stage', sharedRefCount: 0 };
  }
}

export class DrizzleSessionAllocationRepository implements ISessionAllocationRepository {
  constructor(private db: AppDatabase) {}

  async createAllocation(row: SessionAllocationRow): Promise<SessionAllocationRow> {
    await this.db.insert(runSessions).values({
      id: row.id,
      workflowRunId: row.workflowRunId,
      sessionKey: ALLOCATION_KEY,
      sessionId: row.sharedSessionId ?? '',
      configHash: JSON.stringify({ mode: row.mode, sharedRefCount: row.sharedRefCount }),
      status: 'active',
      createdAt: row.createdAt,
    });
    return row;
  }

  async getByRunId(workflowRunId: string): Promise<SessionAllocationRow | null> {
    const rows = await this.db
      .select()
      .from(runSessions)
      .where(and(eq(runSessions.workflowRunId, workflowRunId), eq(runSessions.sessionKey, ALLOCATION_KEY)))
      .limit(1);
    const r = rows[0];
    return r ? this.mapAllocation(r) : null;
  }

  async listAllocations(): Promise<SessionAllocationRow[]> {
    const rows = await this.db.select().from(runSessions).where(eq(runSessions.sessionKey, ALLOCATION_KEY));
    return rows.map((r) => this.mapAllocation(r));
  }

  async updateAllocation(
    id: string,
    updates: Partial<Pick<SessionAllocationRow, 'sharedSessionId' | 'sharedRefCount'>>,
  ): Promise<void> {
    if (!('sharedSessionId' in updates) && !('sharedRefCount' in updates)) return;
    const rows = await this.db.select().from(runSessions).where(eq(runSessions.id, id)).limit(1);
    const current = rows[0];
    if (!current) return;
    const state = allocationState(current.configHash);
    const patch: Partial<typeof runSessions.$inferInsert> = {};
    if ('sharedSessionId' in updates) patch.sessionId = updates.sharedSessionId ?? '';
    if ('sharedRefCount' in updates) {
      patch.configHash = JSON.stringify({ ...state, sharedRefCount: updates.sharedRefCount ?? 0 });
    }
    await this.db.update(runSessions).set(patch).where(eq(runSessions.id, id));
  }

  async deleteAllocation(id: string): Promise<void> {
    // The allocation and its stage mappings (the old FK cascade).
    await this.db
      .delete(runSessions)
      .where(and(eq(runSessions.configHash, id), like(runSessions.sessionKey, `${STAGE_KEY_PREFIX}%`)));
    await this.db.delete(runSessions).where(eq(runSessions.id, id));
  }

  async putStageSession(row: StageSessionMapRow): Promise<void> {
    const allocation = await this.db.select().from(runSessions).where(eq(runSessions.id, row.allocationId)).limit(1);
    const runId = allocation[0]?.workflowRunId;
    if (!runId) throw new Error(`session allocation ${row.allocationId} not found`);
    // Upsert: at most one mapping per stage; a conflict replaces the binding
    // (allocator mode change, or reassignment on resume).
    await this.db
      .insert(runSessions)
      .values({
        id: row.id,
        workflowRunId: runId,
        sessionKey: `${STAGE_KEY_PREFIX}${row.stageRunId}`,
        sessionId: row.sessionId,
        ownerScopeId: row.stageRunId,
        configHash: row.allocationId,
        status: 'active',
        createdAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [runSessions.workflowRunId, runSessions.sessionKey],
        set: { configHash: row.allocationId, sessionId: row.sessionId },
      });
  }

  async listStageSessions(allocationId: string): Promise<StageSessionMapRow[]> {
    const rows = await this.db
      .select()
      .from(runSessions)
      .where(and(eq(runSessions.configHash, allocationId), like(runSessions.sessionKey, `${STAGE_KEY_PREFIX}%`)));
    return rows.map((r) => ({
      id: r.id,
      allocationId: r.configHash,
      stageRunId: r.ownerScopeId ?? r.sessionKey.slice(STAGE_KEY_PREFIX.length),
      sessionId: r.sessionId,
    }));
  }

  async deleteStageSession(stageRunId: string): Promise<void> {
    await this.db.delete(runSessions).where(eq(runSessions.sessionKey, `${STAGE_KEY_PREFIX}${stageRunId}`));
  }

  private mapAllocation(r: typeof runSessions.$inferSelect): SessionAllocationRow {
    const state = allocationState(r.configHash);
    return {
      id: r.id,
      workflowRunId: r.workflowRunId,
      mode: state.mode,
      sharedSessionId: r.sessionId === '' ? null : r.sessionId,
      sharedRefCount: state.sharedRefCount,
      createdAt: r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt as unknown as number),
    };
  }
}
