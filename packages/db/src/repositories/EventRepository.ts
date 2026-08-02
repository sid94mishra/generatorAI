// ────────────────────────────────────────────────────────────────
// DrizzleEventRepository — IEventRepository impl
// ────────────────────────────────────────────────────────────────

import { eq, gt, sql, and, desc, max } from 'drizzle-orm';
import type { IEventRepository } from '@generatorai/core';
import type { PersistedEvent, AgentEventKind } from '@generatorai/shared';
import { events } from '../schema.js';
import type { AppDatabase } from '../index.js';
import { safeJsonColumn } from '../utils/safeJsonColumn.js';
import { jsonUnknown } from '../utils/jsonColumnSchemas.js';

export class DrizzleEventRepository implements IEventRepository {
  private globalSequence = 0;
  private initialized = false;

  constructor(private db: AppDatabase) {}

  /**
   * Restore globalSequence from DB so post-restart events don't collide
   * with pre-restart sequence IDs. Must be called before `persistGlobal()`.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    const rows = await this.db
      .select({ maxSeq: max(events.sequenceId) })
      .from(events)
      .where(eq(events.sessionId, '__global__'));
    this.globalSequence = rows[0]?.maxSeq ?? 0;
    this.initialized = true;
  }

  async insert(event: Omit<PersistedEvent, 'id'>): Promise<number> {
    const result = await this.db.insert(events).values({
      sessionId: event.sessionId,
      sequenceId: event.sequenceId,
      kind: event.kind,
      data: event.data,
      timestamp: event.timestamp,
      workflowRunId: event.workflowRunId ?? null,
      stageRunId: event.stageRunId ?? null,
    }).returning({ id: events.id });
    // Keep globalSequence in sync when __global__ events are inserted
    // via non-persistGlobal paths (e.g. EventBus._doEmit fallback)
    if (event.sessionId === '__global__' && event.sequenceId > this.globalSequence) {
      this.globalSequence = event.sequenceId;
    }
    return result[0]?.id ?? 0;
  }

  async getBySessionId(sessionId: string): Promise<PersistedEvent[]> {
    const rows = await this.db
      .select()
      .from(events)
      .where(eq(events.sessionId, sessionId))
      .orderBy(events.sequenceId);
    return rows.map((r) => this.mapRow(r));
  }

  async getAfterSequence(sessionId: string, afterSeqId: number): Promise<PersistedEvent[]> {
    const rows = await this.db
      .select()
      .from(events)
      .where(and(eq(events.sessionId, sessionId), gt(events.sequenceId, afterSeqId)))
      .orderBy(events.sequenceId);
    return rows.map((r) => this.mapRow(r));
  }

  async getMaxSequencePerSession(): Promise<Array<{ sessionId: string; maxSeq: number }>> {
    const rows = await this.db
      .select({
        sessionId: events.sessionId,
        maxSeq: max(events.sequenceId),
      })
      .from(events)
      .groupBy(events.sessionId);
    return rows.map((r) => ({
      sessionId: r.sessionId,
      maxSeq: r.maxSeq ?? 0,
    }));
  }

  async deleteBySession(sessionId: string): Promise<void> {
    await this.db.delete(events).where(eq(events.sessionId, sessionId));
  }

  async getByWorkflowRunId(workflowRunId: string): Promise<PersistedEvent[]> {
    const rows = await this.db
      .select()
      .from(events)
      .where(eq(events.workflowRunId, workflowRunId))
      .orderBy(events.sequenceId);
    return rows.map((r) => this.mapRow(r));
  }

  async getByStageRunId(stageRunId: string): Promise<PersistedEvent[]> {
    const rows = await this.db
      .select()
      .from(events)
      .where(eq(events.stageRunId, stageRunId))
      .orderBy(events.sequenceId);
    return rows.map((r) => this.mapRow(r));
  }

  async persistGlobal(
    event: Omit<PersistedEvent, 'id' | 'sessionId' | 'sequenceId'>,
  ): Promise<PersistedEvent> {
    // Safety: ensure initialize() was called so globalSequence doesn't start at 0
    if (!this.initialized) {
      await this.initialize();
    }
    this.globalSequence += 1;
    const seq = this.globalSequence;

    const result = await this.db
      .insert(events)
      .values({
        sessionId: '__global__',
        sequenceId: seq,
        kind: event.kind,
        data: event.data,
        timestamp: event.timestamp,
      })
      .returning({ id: events.id });

    return {
      id: result[0]?.id ?? 0,
      sessionId: '__global__',
      sequenceId: seq,
      kind: event.kind as AgentEventKind,
      data: event.data,
      timestamp: event.timestamp,
    };
  }

  private mapRow(row: typeof events.$inferSelect): PersistedEvent {
    return {
      id: row.id,
      sessionId: row.sessionId,
      sequenceId: row.sequenceId,
      kind: row.kind as AgentEventKind,
      data: safeJsonColumn(row.data, jsonUnknown, { fallback: undefined }),
      timestamp: row.timestamp,
      workflowRunId: row.workflowRunId ?? undefined,
      stageRunId: row.stageRunId ?? undefined,
    };
  }
}
