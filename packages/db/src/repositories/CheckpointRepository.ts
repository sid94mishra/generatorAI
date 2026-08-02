// ────────────────────────────────────────────────────────────────
// DrizzleCheckpointRepository — ICheckpointRepository impl
// ────────────────────────────────────────────────────────────────

import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { ICheckpointRepository } from '@generatorai/checkpoints';
import type {
  CheckpointFilters,
  CheckpointKind,
  CheckpointRecord,
} from '@generatorai/shared';
import { StorageError } from '@generatorai/shared';
import { checkpoints } from '../schema.js';
import type { AppDatabase } from '../index.js';

export class DrizzleCheckpointRepository implements ICheckpointRepository {
  constructor(private db: AppDatabase) {}

  async create(record: CheckpointRecord): Promise<void> {
    try {
      await this.db.insert(checkpoints).values({
        id: record.id,
        workspaceId: record.workspaceId,
        repoAlias: record.repoAlias,
        seq: record.seq,
        kind: record.kind,
        label: record.label ?? null,
        refKind: record.refKind,
        refValue: record.refValue,
        treeSha: record.treeSha,
        parentId: record.parentId ?? null,
        sessionId: record.sessionId ?? null,
        chatId: record.chatId ?? null,
        turnId: record.turnId ?? null,
        workflowRunId: record.workflowRunId ?? null,
        stageRunId: record.stageRunId ?? null,
        automationExecutionRunId: record.automationExecutionRunId ?? null,
        phase: record.phase ?? null,
        promptExcerpt: record.promptExcerpt ?? null,
        fileCount: record.fileCount,
        additions: record.additions,
        deletions: record.deletions,
        createdAt: record.createdAt,
      });
    } catch (err) {
      throw new StorageError(
        `Failed to create checkpoint: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  async findById(id: string): Promise<CheckpointRecord | null> {
    const rows = await this.db.select().from(checkpoints).where(eq(checkpoints.id, id)).limit(1);
    return rows[0] ? this.mapRow(rows[0]) : null;
  }

  async list(filters: CheckpointFilters): Promise<CheckpointRecord[]> {
    const conditions = [eq(checkpoints.workspaceId, filters.workspaceId)];
    if (filters.repoAlias) conditions.push(eq(checkpoints.repoAlias, filters.repoAlias));
    if (filters.kinds?.length) {
      conditions.push(inArray(checkpoints.kind, filters.kinds as CheckpointKind[]));
    } else if (filters.excludeLive !== false) {
      // Rolling `live` snapshots are implementation detail — hide them from
      // the rewind picker unless explicitly requested.
      conditions.push(ne(checkpoints.kind, 'live'));
    }

    const rows = await this.db
      .select()
      .from(checkpoints)
      .where(and(...conditions))
      .orderBy(desc(checkpoints.seq))
      .limit(filters.limit ?? 200);

    return rows.map((r) => this.mapRow(r));
  }

  async findLatest(workspaceId: string, repoAlias: string): Promise<CheckpointRecord | null> {
    const rows = await this.db
      .select()
      .from(checkpoints)
      .where(
        and(eq(checkpoints.workspaceId, workspaceId), eq(checkpoints.repoAlias, repoAlias)),
      )
      .orderBy(desc(checkpoints.seq))
      .limit(1);
    return rows[0] ? this.mapRow(rows[0]) : null;
  }

  async maxSeq(workspaceId: string, repoAlias: string): Promise<number> {
    const rows = await this.db
      .select({ maxSeq: sql<number>`COALESCE(MAX(${checkpoints.seq}), 0)` })
      .from(checkpoints)
      .where(
        and(eq(checkpoints.workspaceId, workspaceId), eq(checkpoints.repoAlias, repoAlias)),
      );
    return rows[0]?.maxSeq ?? 0;
  }

  async findByTurn(workspaceId: string, turnId: string): Promise<CheckpointRecord[]> {
    const rows = await this.db
      .select()
      .from(checkpoints)
      .where(and(eq(checkpoints.workspaceId, workspaceId), eq(checkpoints.turnId, turnId)))
      .orderBy(desc(checkpoints.seq));
    return rows.map((r) => this.mapRow(r));
  }

  async findByStageRun(workspaceId: string, stageRunId: string): Promise<CheckpointRecord[]> {
    const rows = await this.db
      .select()
      .from(checkpoints)
      .where(
        and(eq(checkpoints.workspaceId, workspaceId), eq(checkpoints.stageRunId, stageRunId)),
      )
      .orderBy(desc(checkpoints.seq));
    return rows.map((r) => this.mapRow(r));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(checkpoints).where(eq(checkpoints.id, id));
  }

  async deleteByWorkspace(workspaceId: string): Promise<void> {
    await this.db.delete(checkpoints).where(eq(checkpoints.workspaceId, workspaceId));
  }

  private mapRow(row: typeof checkpoints.$inferSelect): CheckpointRecord {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      repoAlias: row.repoAlias,
      seq: row.seq,
      kind: row.kind,
      ...(row.label ? { label: row.label } : {}),
      refKind: row.refKind,
      refValue: row.refValue,
      treeSha: row.treeSha,
      ...(row.parentId ? { parentId: row.parentId } : {}),
      ...(row.sessionId ? { sessionId: row.sessionId } : {}),
      ...(row.chatId ? { chatId: row.chatId } : {}),
      ...(row.turnId ? { turnId: row.turnId } : {}),
      ...(row.workflowRunId ? { workflowRunId: row.workflowRunId } : {}),
      ...(row.stageRunId ? { stageRunId: row.stageRunId } : {}),
      ...(row.automationExecutionRunId
        ? { automationExecutionRunId: row.automationExecutionRunId }
        : {}),
      ...(row.phase ? { phase: row.phase } : {}),
      ...(row.promptExcerpt ? { promptExcerpt: row.promptExcerpt } : {}),
      fileCount: row.fileCount,
      additions: row.additions,
      deletions: row.deletions,
      createdAt: row.createdAt,
    };
  }
}
