// ────────────────────────────────────────────────────────────────
// DrizzleStageRunRepository — IStageRunRepository impl (v1 engine)
//
// Since v57 the `stage_runs` table is the v2 engine's instance table. Until
// the P03 cutover deletes the v1 engine, its rows are mapped here (P03
// WP-3.2 deviation, DEVIATIONS.md):
//   - v1 `queued` is stored as v2 `ready` (the table's CHECK has no queued);
//   - `retryCount` is `current_attempt`;
//   - `currentStep`/`totalSteps` live in `usage.v1Steps`;
//   - `kind` is `agent` and `instance_path` is the stage key.
// ────────────────────────────────────────────────────────────────

import { eq, and, inArray, sql, type SQL } from 'drizzle-orm';
import type { IStageRunRepository } from '@generatorai/core';
import type { StageRun, StageRunStatus } from '@generatorai/shared';
import { NotFoundError, StorageError } from '@generatorai/shared';
import { stageRuns } from '../schema.js';
import type { AppDatabase } from '../index.js';

type DbStageStatus = (typeof stageRuns.$inferSelect)['status'];

/** v1 status → stored v2 status. */
function toDbStatus(status: StageRunStatus): DbStageStatus {
  return status === 'queued' ? 'ready' : status;
}

/** Stored v2 status → v1 status (v2-only states never occur on v1 rows). */
function fromDbStatus(status: string): StageRunStatus {
  return (status === 'ready' ? 'queued' : status) as StageRunStatus;
}

function stepsUsage(currentStep: number, totalSteps: number): Record<string, unknown> {
  return { v1Steps: { current: currentStep, total: totalSteps } };
}

/** `usage = json_set(usage, '$.v1Steps.<field>', value)`. */
function setStep(field: 'current' | 'total', value: number): SQL {
  return sql`json_set(${stageRuns.usage}, ${`$.v1Steps.${field}`}, ${value})`;
}

/** Column values of a new stage run (shared with the run repository's atomic insert). */
export function stageRunInsertValues(stageRun: StageRun): typeof stageRuns.$inferInsert {
  return {
    id: stageRun.id,
    workflowRunId: stageRun.workflowRunId,
    stageKey: stageRun.stageKey,
    kind: 'agent',
    instancePath: stageRun.stageKey,
    sessionId: stageRun.sessionId ?? null,
    name: stageRun.name,
    status: toDbStatus(stageRun.status),
    currentAttempt: stageRun.retryCount,
    usage: stepsUsage(stageRun.currentStep, stageRun.totalSteps),
    error: stageRun.error ?? null,
    createdAt: stageRun.createdAt,
    updatedAt: stageRun.createdAt,
    startedAt: stageRun.startedAt ?? null,
    completedAt: stageRun.completedAt ?? null,
  };
}

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

export class DrizzleStageRunRepository implements IStageRunRepository {
  constructor(private db: AppDatabase) {}

  async create(stageRun: StageRun): Promise<StageRun> {
    try {
      await this.db.insert(stageRuns).values(stageRunInsertValues(stageRun));
      return stageRun;
    } catch (err) {
      throw new StorageError(
        `Failed to create stage run: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  async getById(id: string): Promise<StageRun> {
    const rows = await this.db
      .select()
      .from(stageRuns)
      .where(eq(stageRuns.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError('StageRun', id);
    return this.mapRow(row);
  }

  async getByRunId(workflowRunId: string): Promise<StageRun[]> {
    const rows = await this.db
      .select()
      .from(stageRuns)
      .where(eq(stageRuns.workflowRunId, workflowRunId));
    return rows.map((r) => this.mapRow(r));
  }

  async getByStatus(workflowRunId: string, statuses: StageRunStatus[]): Promise<StageRun[]> {
    const rows = await this.db
      .select()
      .from(stageRuns)
      .where(
        and(
          eq(stageRuns.workflowRunId, workflowRunId),
          inArray(stageRuns.status, statuses.map(toDbStatus)),
        ),
      );
    return rows.map((r) => this.mapRow(r));
  }

  async update(id: string, updates: Partial<StageRun>): Promise<StageRun> {
    const values: Record<string, unknown> = {};
    if (updates.sessionId !== undefined) values['sessionId'] = updates.sessionId;
    if (updates.status !== undefined) values['status'] = toDbStatus(updates.status);
    if (updates.currentStep !== undefined && updates.totalSteps !== undefined) {
      values['usage'] = stepsUsage(updates.currentStep, updates.totalSteps);
    } else if (updates.currentStep !== undefined) {
      values['usage'] = setStep('current', updates.currentStep);
    } else if (updates.totalSteps !== undefined) {
      values['usage'] = setStep('total', updates.totalSteps);
    }
    if (updates.retryCount !== undefined) values['currentAttempt'] = updates.retryCount;
    if (updates.error !== undefined) values['error'] = updates.error;
    if (updates.summary !== undefined) values['summary'] = updates.summary;
    if (updates.outputText !== undefined) values['outputText'] = updates.outputText;
    if (updates.outputData !== undefined) values['outputData'] = updates.outputData ? JSON.stringify(updates.outputData) : null;
    if (updates.artifactManifest !== undefined) values['artifactManifest'] = updates.artifactManifest ? JSON.stringify(updates.artifactManifest) : null;
    if (updates.startedAt !== undefined) values['startedAt'] = updates.startedAt;
    if (updates.completedAt !== undefined) values['completedAt'] = updates.completedAt;
    // HITL-02 — persist or clear interrupt_data alongside the status change.
    if (updates.interruptData !== undefined) values['interruptData'] = updates.interruptData;
    // WS-D1 — heartbeat/lease are normally written by `heartbeat()`; allow
    // explicit clears/sets here for tests and recovery paths.
    if (updates.heartbeatAt !== undefined) values['heartbeatAt'] = updates.heartbeatAt;

    // WS-D1 — `version` is documented as "bumped on every mutation" and the
    // optimistic-lock readers (`incrementRetryCount`, `updateStatus`,
    // `resetForRetry` with `expectedVersion`) rely on that. Callers never pass
    // `version` in `updates`; a stale-version write is rejected by those
    // conditional methods, not by this one.
    values['version'] = sql`${stageRuns.version} + 1`;
    values['updatedAt'] = new Date();

    await this.db
      .update(stageRuns)
      .set(values)
      .where(eq(stageRuns.id, id));
    return this.getById(id);
  }

  /**
   * DUR-06 — atomic launch claim: transition `pending → queued` in a single
   * conditional write, returning true iff this caller won the claim. The
   * `WHERE status = 'pending'` guarantees that of N concurrent launch
   * attempts (parallel fan-in, event path racing the poll backstop, a
   * crash-recovery re-drive) exactly one proceeds; the rest see 0 changed
   * rows and bail. Bumps `version` so any optimistic-lock reader observes
   * the change.
   */
  async claimForExecution(id: string): Promise<boolean> {
    const result = await this.db
      .update(stageRuns)
      .set({
        status: toDbStatus('queued'),
        version: sql`${stageRuns.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(stageRuns.id, id), eq(stageRuns.status, 'pending')))
      .returning({ id: stageRuns.id });
    return result.length > 0;
  }

  /**
   * HITL-01 — atomically park a stage for human input. Sets
   * `status='awaiting_input'` AND writes `interrupt_data` in one UPDATE
   * so a crash between the two can't leave an orphaned row.
   */
  async interrupt(id: string, interruptData: unknown): Promise<void> {
    await this.db
      .update(stageRuns)
      .set({
        status: 'awaiting_input',
        updatedAt: new Date(),
        interruptData,
        version: sql`${stageRuns.version} + 1`,
      })
      .where(eq(stageRuns.id, id));
  }

  /**
   * HITL-01 — atomic resume: `awaiting_input → nextStatus`, clears
   * `interrupt_data`, bumps `version`. Returns true iff the row was
   * actually `awaiting_input` when this call ran — protects against two
   * approvers racing on the same stage.
   *
   * P0-a — `nextStatus` exists because the correct destination depends on
   * whether the stage's execution frame is still alive. `running` is right
   * only when an in-process `interrupt()` awaiter is about to be resolved and
   * will carry on executing. After a restart that frame is gone, and
   * `running` is a permanent zombie: `DAGScheduler.reconcileRun` only
   * considers `pending` stages, so nothing ever relaunches it and the run
   * never finishes. `HitlService.resume` picks `pending` in that case so the
   * scheduler re-drives the stage. Both transitions stay one conditional
   * write, so two approvers still cannot both win.
   */
  async resumeFromInterrupt(
    id: string,
    nextStatus: 'running' | 'pending' = 'running',
  ): Promise<boolean> {
    const result = await this.db
      .update(stageRuns)
      .set({
        status: nextStatus,
        updatedAt: new Date(),
        interruptData: null,
        version: sql`${stageRuns.version} + 1`,
      })
      .where(and(eq(stageRuns.id, id), eq(stageRuns.status, 'awaiting_input')))
      .returning({ id: stageRuns.id });
    return result.length > 0;
  }

  /** HITL-05 — list every stage in the given run still awaiting input. */
  async findAwaitingInputByRun(workflowRunId: string): Promise<StageRun[]> {
    const rows = await this.db
      .select()
      .from(stageRuns)
      .where(
        and(
          eq(stageRuns.workflowRunId, workflowRunId),
          eq(stageRuns.status, 'awaiting_input'),
        ),
      );
    return rows.map((r) => this.mapRow(r));
  }


  /**
   * WS-D1 — mirrors `claimForExecution`/`resumeFromInterrupt`: one
   * conditional write that bumps `version`. With `expectedVersion` the WHERE
   * also pins the version so two writers racing from the same read cannot
   * both succeed; the loser sees 0 changed rows and gets `false`.
   */
  async updateStatus(id: string, status: StageRunStatus, expectedVersion?: number): Promise<boolean> {
    const where =
      expectedVersion === undefined
        ? eq(stageRuns.id, id)
        : and(eq(stageRuns.id, id), eq(stageRuns.version, expectedVersion));
    const result = await this.db
      .update(stageRuns)
      .set({ status: toDbStatus(status), version: sql`${stageRuns.version} + 1`, updatedAt: new Date() })
      .where(where)
      .returning({ id: stageRuns.id });
    return result.length > 0;
  }

  /**
   * WS-D1 — liveness beat. Guarded to `queued`/`running` so a beat that
   * lands after the terminal write is a no-op rather than a resurrection.
   * Deliberately does NOT bump `version`: a beat changes no state a
   * conditional writer cares about, and bumping every 10 s would make every
   * optimistic lock held across a prompt spuriously fail.
   */
  async heartbeat(id: string): Promise<boolean> {
    const result = await this.db
      .update(stageRuns)
      .set({
        heartbeatAt: new Date(),
      })
      .where(and(eq(stageRuns.id, id), inArray(stageRuns.status, [toDbStatus('queued'), 'running'])))
      .returning({ id: stageRuns.id });
    return result.length > 0;
  }

  async incrementRetryCount(id: string, expectedVersion?: number): Promise<boolean> {
    if (expectedVersion === undefined) {
      // Legacy behaviour — unconditional increment. Still bumps version
      // so any concurrent optimistic-lock caller sees the change.
      const result = await this.db
        .update(stageRuns)
        .set({
          currentAttempt: sql`${stageRuns.currentAttempt} + 1`,
          version: sql`${stageRuns.version} + 1`,
        })
        .where(eq(stageRuns.id, id))
        .returning({ id: stageRuns.id });
      return result.length > 0;
    }

    // Optimistic-lock path: two processes both reading `version = N` will
    // both attempt the UPDATE; SQLite runs writes serially, so the first
    // bumps version to N+1 and commits; the second's WHERE no longer
    // matches and .changes === 0. We surface that as `false` so the caller
    // can bail (another process is already retrying this stage).
    const result = await this.db
      .update(stageRuns)
      .set({
        currentAttempt: sql`${stageRuns.currentAttempt} + 1`,
        version: sql`${stageRuns.version} + 1`,
      })
      .where(and(eq(stageRuns.id, id), eq(stageRuns.version, expectedVersion)))
      .returning({ id: stageRuns.id });
    return result.length > 0;
  }

  async resetForRetry(id: string, expectedVersion?: number): Promise<boolean> {
    const where =
      expectedVersion === undefined
        ? eq(stageRuns.id, id)
        : and(eq(stageRuns.id, id), eq(stageRuns.version, expectedVersion));
    const result = await this.db
      .update(stageRuns)
      .set({
        status: 'pending',
        updatedAt: new Date(),
        error: null,
        startedAt: null,
        completedAt: null,
        // WS-D1 — a reset row has no live executor; a stale beat left over
        // from the interrupted attempt must not be mistaken for one.
        heartbeatAt: null,
        version: sql`${stageRuns.version} + 1`,
      })
      .where(where)
      .returning({ id: stageRuns.id });
    return result.length > 0;
  }

  async batchUpdateStatus(ids: string[], status: StageRunStatus): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .update(stageRuns)
      .set({ status: toDbStatus(status), version: sql`${stageRuns.version} + 1`, updatedAt: new Date() })
      .where(inArray(stageRuns.id, ids));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(stageRuns).where(eq(stageRuns.id, id));
  }

  async deleteByRunId(workflowRunId: string): Promise<void> {
    await this.db
      .delete(stageRuns)
      .where(eq(stageRuns.workflowRunId, workflowRunId));
  }

  private mapRow(row: typeof stageRuns.$inferSelect): StageRun {
    const steps = (jsonValue<{ v1Steps?: { current?: number; total?: number } }>(row.usage) ?? {}).v1Steps ?? {};
    return {
      id: row.id,
      workflowRunId: row.workflowRunId,
      stageKey: row.stageKey,
      sessionId: row.sessionId ?? undefined,
      name: row.name,
      status: fromDbStatus(row.status),
      currentStep: steps.current ?? 0,
      totalSteps: steps.total ?? 0,
      retryCount: row.currentAttempt,
      version: row.version,
      error: row.error ?? undefined,
      summary: row.summary ?? undefined,
      outputText: row.outputText ?? undefined,
      outputData: jsonValue<Record<string, unknown>>(row.outputData),
      artifactManifest: jsonValue<Array<{ path: string; language: string; action: string; sizeBytes: number }>>(row.artifactManifest),
      interruptData: row.interruptData ?? undefined,
      heartbeatAt: row.heartbeatAt ?? undefined,
      createdAt: row.createdAt,
      startedAt: row.startedAt ?? undefined,
      completedAt: row.completedAt ?? undefined,
    };
  }
}
