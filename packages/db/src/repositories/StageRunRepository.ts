// ────────────────────────────────────────────────────────────────
// DrizzleStageRunRepository — stage instances (`stage_runs`, v57).
//
// The engine's compare-and-set (`transition`, checked against
// STAGE_RUN_TRANSITIONS) is the only status writer; everything else here
// reads the instances for the run page, the commands API and forks.
// ────────────────────────────────────────────────────────────────

import { eq, and, inArray } from 'drizzle-orm';
import type {
  IStageRunCas,
  IStageRunRepository,
  StageInstanceRow,
  StageTransitionOptions,
  TransitionResult,
} from '@generatorai/core';
import type { StageRunState } from '@generatorai/workflow-spec';
import type { StageRun, StageRunStatus } from '@generatorai/shared';
import { NotFoundError } from '@generatorai/shared';
import { stageRuns } from '../schema.js';
import type { AppDatabase } from '../index.js';
import { sqliteHandle } from './AuthRepositories.js';
import { getInstanceRow, markStageProgress, renewStageLease, stageTransition } from './engineCas.js';

/** A drizzle `json` column arrives parsed; a hand-written row may hold the text. */
function jsonValue<T>(v: unknown): T | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v !== 'string') return v as T;
  try {
    return JSON.parse(v) as T;
  } catch {
    return undefined;
  }
}

export class DrizzleStageRunRepository implements IStageRunRepository, IStageRunCas {
  constructor(private db: AppDatabase) {}

  // ── compare-and-set (G5 §5.4) ───────────────────────────────────

  /** The only status writer: a synchronous CAS checked against STAGE_RUN_TRANSITIONS. */
  transition(id: string, from: readonly StageRunState[], to: StageRunState, opts?: StageTransitionOptions): TransitionResult<StageInstanceRow> {
    return stageTransition(sqliteHandle(this.db), id, from, to, opts);
  }

  renewLease(id: string, owner: string, ttlMs: number, now?: number): boolean {
    return renewStageLease(sqliteHandle(this.db), id, owner, ttlMs, now);
  }

  markProgress(id: string, owner: string, at: number): boolean {
    return markStageProgress(sqliteHandle(this.db), id, owner, at);
  }

  getInstance(id: string): StageInstanceRow | null {
    return getInstanceRow(sqliteHandle(this.db), id);
  }

  // ── reads ───────────────────────────────────────────────────────

  async getById(id: string): Promise<StageRun> {
    const row = (await this.db.select().from(stageRuns).where(eq(stageRuns.id, id)).limit(1))[0];
    if (!row) throw new NotFoundError('StageRun', id);
    return mapStageRun(row);
  }

  async getByRunId(workflowRunId: string): Promise<StageRun[]> {
    const rows = await this.db.select().from(stageRuns).where(eq(stageRuns.workflowRunId, workflowRunId));
    return rows.map(mapStageRun);
  }

  async getByStatus(workflowRunId: string, statuses: StageRunStatus[]): Promise<StageRun[]> {
    const rows = await this.db
      .select()
      .from(stageRuns)
      .where(and(eq(stageRuns.workflowRunId, workflowRunId), inArray(stageRuns.status, statuses)));
    return rows.map(mapStageRun);
  }

  async deleteByRunId(workflowRunId: string): Promise<void> {
    await this.db.delete(stageRuns).where(eq(stageRuns.workflowRunId, workflowRunId));
  }
}

export function mapStageRun(row: typeof stageRuns.$inferSelect): StageRun {
  return {
    id: row.id,
    workflowRunId: row.workflowRunId,
    stageKey: row.stageKey,
    instancePath: row.instancePath,
    kind: row.kind,
    sessionId: row.sessionId ?? undefined,
    name: row.name,
    status: row.status,
    statusReason: row.statusReason ?? undefined,
    currentAttempt: row.currentAttempt,
    version: row.version,
    error: row.error ?? undefined,
    errorClass: row.errorClass ?? undefined,
    errorCode: row.errorCode ?? undefined,
    skipReason: row.skipReason ?? undefined,
    summary: row.summary ?? undefined,
    outputText: row.outputText ?? undefined,
    outputData: jsonValue<Record<string, unknown>>(row.outputData),
    artifactManifest: jsonValue<Array<{ path: string; language: string; action: string; sizeBytes: number }>>(row.artifactManifest),
    interruptData: jsonValue<unknown>(row.interruptData),
    usage: jsonValue<Record<string, unknown>>(row.usage),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt ?? undefined,
    completedAt: row.completedAt ?? undefined,
  };
}
