// ────────────────────────────────────────────────────────────────
// DrizzleStageRunRepository — IStageRunRepository impl (v2)
// ────────────────────────────────────────────────────────────────

import { eq, and, inArray, lte, isNotNull, sql } from 'drizzle-orm';
import type { IStageRunRepository } from '@generatorai/core';
import type { StageRun, StageRunStatus } from '@generatorai/shared';
import { NotFoundError, StorageError } from '@generatorai/shared';
import { stageRuns } from '../schema.js';
import type { AppDatabase } from '../index.js';

export class DrizzleStageRunRepository implements IStageRunRepository {
  constructor(private db: AppDatabase) {}

  async create(stageRun: StageRun): Promise<StageRun> {
    try {
      await this.db.insert(stageRuns).values({
        id: stageRun.id,
        workflowRunId: stageRun.workflowRunId,
        stageDefinitionId: stageRun.stageDefinitionId,
        sessionId: stageRun.sessionId ?? null,
        name: stageRun.name,
        status: stageRun.status,
        currentStep: stageRun.currentStep,
        totalSteps: stageRun.totalSteps,
        retryCount: stageRun.retryCount,
        error: stageRun.error ?? null,
        createdAt: stageRun.createdAt,
        startedAt: stageRun.startedAt ?? null,
        completedAt: stageRun.completedAt ?? null,
      });
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
          inArray(stageRuns.status, statuses),
        ),
      );
    return rows.map((r) => this.mapRow(r));
  }

  async update(id: string, updates: Partial<StageRun>): Promise<StageRun> {
    const values: Record<string, unknown> = {};
    if (updates.sessionId !== undefined) values['sessionId'] = updates.sessionId;
    if (updates.status !== undefined) values['status'] = updates.status;
    if (updates.currentStep !== undefined) values['currentStep'] = updates.currentStep;
    if (updates.totalSteps !== undefined) values['totalSteps'] = updates.totalSteps;
    if (updates.retryCount !== undefined) values['retryCount'] = updates.retryCount;
    if (updates.error !== undefined) values['error'] = updates.error;
    if (updates.summary !== undefined) values['summary'] = updates.summary;
    if (updates.outputText !== undefined) values['outputText'] = updates.outputText;
    if (updates.outputData !== undefined) values['outputData'] = updates.outputData ? JSON.stringify(updates.outputData) : null;
    if (updates.artifactManifest !== undefined) values['artifactManifest'] = updates.artifactManifest ? JSON.stringify(updates.artifactManifest) : null;
    if (updates.iterationIndex !== undefined) values['iterationIndex'] = updates.iterationIndex;
    if (updates.parentStageRunId !== undefined) values['parentStageRunId'] = updates.parentStageRunId;
    if (updates.startedAt !== undefined) values['startedAt'] = updates.startedAt;
    if (updates.completedAt !== undefined) values['completedAt'] = updates.completedAt;
    // DUR-05 — allow setting sleep fields to `null` to explicitly clear
    // them on wake; undefined leaves them unchanged.
    if (updates.wakeAt !== undefined) values['wakeAt'] = updates.wakeAt;
    if (updates.sleptSince !== undefined) values['sleptSince'] = updates.sleptSince;
    // HITL-02 — persist or clear interrupt_data alongside the status change.
    if (updates.interruptData !== undefined) values['interruptData'] = updates.interruptData;
    // WS-D1 — heartbeat/lease are normally written by `heartbeat()`; allow
    // explicit clears/sets here for tests and recovery paths.
    if (updates.heartbeatAt !== undefined) values['heartbeatAt'] = updates.heartbeatAt;
    if (updates.leaseOwner !== undefined) values['leaseOwner'] = updates.leaseOwner;

    // WS-D1 — `version` is documented as "bumped on every mutation" and the
    // optimistic-lock readers (`incrementRetryCount`, `updateStatus`,
    // `resetForRetry` with `expectedVersion`) rely on that. Callers never pass
    // `version` in `updates`; a stale-version write is rejected by those
    // conditional methods, not by this one.
    values['version'] = sql`${stageRuns.version} + 1`;

    await this.db
      .update(stageRuns)
      .set(values)
      .where(eq(stageRuns.id, id));
    return this.getById(id);
  }

  /**
   * DUR-05 — atomic "put this stage to sleep" operation. Used by a caller
   * that wants to transition running → sleeping with `wake_at` set in one
   * SQL write so a crash between `updateStatus` and `update` can't leave
   * the row in a half-sleeping state.
   */
  async sleep(id: string, wakeAt: Date): Promise<void> {
    const now = new Date();
    await this.db
      .update(stageRuns)
      .set({
        status: 'sleeping',
        wakeAt,
        sleptSince: now,
        // WS-D1 — a sleeping stage is not live; clear the beat so the
        // reconciler's stale check has nothing to misread if the row is
        // later resurrected, and bump version like every other mutation.
        heartbeatAt: null,
        version: sql`${stageRuns.version} + 1`,
      })
      .where(eq(stageRuns.id, id));
  }

  /**
   * DUR-05 — atomic wake: transition sleeping → queued AND clear the
   * sleep bookkeeping in a single write. Returns true iff this call
   * actually woke the row (status was `sleeping` + wakeAt NOT NULL).
   * The conditional WHERE guarantees two sweepers can't both wake the
   * same row.
   */
  async wake(id: string): Promise<boolean> {
    const result = await this.db
      .update(stageRuns)
      .set({
        status: 'queued',
        wakeAt: null,
        sleptSince: null,
        version: sql`${stageRuns.version} + 1`,
      })
      .where(and(eq(stageRuns.id, id), eq(stageRuns.status, 'sleeping')))
      .returning({ id: stageRuns.id });
    return result.length > 0;
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
        status: 'queued',
        version: sql`${stageRuns.version} + 1`,
      })
      .where(and(eq(stageRuns.id, id), eq(stageRuns.status, 'pending')))
      .returning({ id: stageRuns.id });
    return result.length > 0;
  }

  /**
   * DUR-05 — list stages ready to wake (`status = 'sleeping'` and
   * `wake_at <= now`). Callers cap via `limit` to keep a single sweep
   * bounded. Results are ordered by the oldest deadline first so
   * long-overdue stages resume before newly-expired ones.
   */
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
   * `running` is a permanent zombie: `DAGScheduler.getReadyStages` only
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

  async findSleepersReadyToWake(now: Date, limit: number): Promise<StageRun[]> {
    const rows = await this.db
      .select()
      .from(stageRuns)
      .where(
        and(
          eq(stageRuns.status, 'sleeping'),
          isNotNull(stageRuns.wakeAt),
          lte(stageRuns.wakeAt, now),
        ),
      )
      .orderBy(stageRuns.wakeAt)
      .limit(limit);
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
      .set({ status, version: sql`${stageRuns.version} + 1` })
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
  async heartbeat(id: string, leaseOwner?: string): Promise<boolean> {
    const result = await this.db
      .update(stageRuns)
      .set({
        heartbeatAt: new Date(),
        ...(leaseOwner !== undefined ? { leaseOwner } : {}),
      })
      .where(and(eq(stageRuns.id, id), inArray(stageRuns.status, ['queued', 'running'])))
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
          retryCount: sql`${stageRuns.retryCount} + 1`,
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
        retryCount: sql`${stageRuns.retryCount} + 1`,
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
        error: null,
        startedAt: null,
        completedAt: null,
        // WS-D1 — a reset row has no live executor; a stale beat left over
        // from the interrupted attempt must not be mistaken for one.
        heartbeatAt: null,
        leaseOwner: null,
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
      .set({ status, version: sql`${stageRuns.version} + 1` })
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
    return {
      id: row.id,
      workflowRunId: row.workflowRunId,
      stageDefinitionId: row.stageDefinitionId,
      sessionId: row.sessionId ?? undefined,
      name: row.name,
      status: row.status as StageRunStatus,
      currentStep: row.currentStep,
      totalSteps: row.totalSteps,
      retryCount: row.retryCount,
      version: row.version,
      error: row.error ?? undefined,
      summary: row.summary ?? undefined,
      outputText: (row as Record<string, unknown>).outputText as string | undefined ?? undefined,
      outputData: (() => { const v = (row as Record<string, unknown>).outputData; return typeof v === 'string' ? JSON.parse(v) as Record<string, unknown> : undefined; })(),
      artifactManifest: (() => { const v = (row as Record<string, unknown>).artifactManifest; return typeof v === 'string' ? JSON.parse(v) as Array<{ path: string; language: string; action: string; sizeBytes: number }> : undefined; })(),
      iterationIndex: (row as Record<string, unknown>).iterationIndex as number | undefined,
      parentStageRunId: (row as Record<string, unknown>).parentStageRunId as string | undefined,
      wakeAt: row.wakeAt ?? undefined,
      sleptSince: row.sleptSince ?? undefined,
      interruptData: row.interruptData ?? undefined,
      heartbeatAt: row.heartbeatAt ?? undefined,
      leaseOwner: row.leaseOwner ?? undefined,
      createdAt: row.createdAt,
      startedAt: row.startedAt ?? undefined,
      completedAt: row.completedAt ?? undefined,
    };
  }
}
