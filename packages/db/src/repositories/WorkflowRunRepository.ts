// ────────────────────────────────────────────────────────────────
// DrizzleWorkflowRunRepository — IWorkflowRunRepository impl (v1 engine)
//
// Since v57 `workflow_runs` is the v2 engine's run table. Until the P03
// cutover deletes the v1 engine, its rows are mapped here (P03 WP-3.2
// deviation, DEVIATIONS.md):
//   - the v1 run-level permission mode is optional (the layers resolve an
//     unset one every turn), so it is kept in `run_overrides.permissionMode`;
//     the NOT NULL `permission_mode` column holds it or `default`, and v1
//     never reads the column;
//   - `session_mode` is gone: every v1 run is `per-stage` (P01 R4);
//   - `root_run_id` is the run itself.
// ────────────────────────────────────────────────────────────────

import { count, eq, inArray } from 'drizzle-orm';
import type {
  IWorkflowRunCas,
  IWorkflowRunRepository,
  RunTransitionOptions,
  TransitionResult,
  WorkflowRunRow,
} from '@generatorai/core';
import type { WorkflowRunState } from '@generatorai/workflow-spec';
import type {
  StageRun,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowRunPermissionMode,
} from '@generatorai/shared';
import { StorageError, NotFoundError } from '@generatorai/shared';
import { stageRuns, workflowRuns } from '../schema.js';
import type { AppDatabase } from '../index.js';
import { sqliteHandle } from './AuthRepositories.js';
import { claimRunOwnership, getRunRow, runTransition } from './engineCas.js';
import { safeJsonColumn } from '../utils/safeJsonColumn.js';
import { validateJsonColumn } from '../utils/validateJsonColumn.js';
import { jsonRecord } from '../utils/jsonColumnSchemas.js';
import { stageRunInsertValues } from './StageRunRepository.js';

/** The v1 run-level permission mode lives in `run_overrides` (see the header). */
function v1Overrides(mode: WorkflowRunPermissionMode | null | undefined): Record<string, unknown> {
  return mode ? { permissionMode: mode } : {};
}

function runInsertValues(run: WorkflowRun): typeof workflowRuns.$inferInsert {
  return {
    id: run.id,
    workflowDefinitionId: run.workflowDefinitionId,
    definitionVersionId: run.definitionVersionId,
    name: run.name,
    status: run.status,
    variables: run.variables,
    error: run.error ?? null,
    permissionMode: run.permissionMode ?? 'default',
    runOverrides: v1Overrides(run.permissionMode),
    rootRunId: run.id,
    workspaceId: run.workspaceId ?? null,
    // W23: persist the ancestor reference for the retry identity chain.
    ...(run.ancestorRunId ? { ancestorRunId: run.ancestorRunId } : {}),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    startedAt: run.startedAt ?? null,
    completedAt: run.completedAt ?? null,
  };
}

export class DrizzleWorkflowRunRepository implements IWorkflowRunRepository, IWorkflowRunCas {
  constructor(private db: AppDatabase) {}

  // ── v2 engine: compare-and-set and ownership (P03 WP-3.1) ──────

  /** The run's CAS, checked against WORKFLOW_RUN_TRANSITIONS; `ownerEpoch` fences it (RV-27). */
  transition(id: string, from: readonly WorkflowRunState[], to: WorkflowRunState, opts?: RunTransitionOptions): TransitionResult<WorkflowRunRow> {
    return runTransition(sqliteHandle(this.db), id, from, to, opts);
  }

  claimOwnership(id: string, ownerId: string, ttlMs: number, now?: number): number | null {
    return claimRunOwnership(sqliteHandle(this.db), id, ownerId, ttlMs, now);
  }

  getRunRow(id: string): WorkflowRunRow | null {
    return getRunRow(sqliteHandle(this.db), id);
  }

  // ── v1 engine (deleted at the P03 cutover) ─────────────────────

  async create(run: WorkflowRun): Promise<WorkflowRun> {
    try {
      // DB-03 — validate variables (only JSON column on workflow_runs).
      validateJsonColumn(run.variables, jsonRecord, { column: 'variables', table: 'workflow_runs' });
      await this.db.insert(workflowRuns).values(runInsertValues(run));
      return run;
    } catch (err) {
      throw new StorageError(
        `Failed to create workflow run: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  /**
   * The run and its stage runs in ONE synchronous transaction, so a failed
   * stage insert never leaves a half-materialized run (A-34: no async
   * transaction wrapper).
   */
  async createWithStages(run: WorkflowRun, stages: StageRun[]): Promise<void> {
    validateJsonColumn(run.variables, jsonRecord, { column: 'variables', table: 'workflow_runs' });
    try {
      this.db.transaction((tx) => {
        tx.insert(workflowRuns).values(runInsertValues(run)).run();
        for (const sr of stages) tx.insert(stageRuns).values(stageRunInsertValues(sr)).run();
      });
    } catch (err) {
      throw new StorageError(
        `Failed to create workflow run: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  async getById(id: string): Promise<WorkflowRun> {
    const rows = await this.db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError('WorkflowRun', id);
    return this.mapRow(row);
  }

  async getAll(): Promise<WorkflowRun[]> {
    const rows = await this.db
      .select()
      .from(workflowRuns)
      .orderBy(workflowRuns.createdAt);
    return rows.map((r) => this.mapRow(r));
  }

  async getByDefinitionId(definitionId: string): Promise<WorkflowRun[]> {
    const rows = await this.db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.workflowDefinitionId, definitionId))
      .orderBy(workflowRuns.createdAt);
    return rows.map((r) => this.mapRow(r));
  }

  async getByStatus(statuses: WorkflowRunStatus[]): Promise<WorkflowRun[]> {
    const rows = await this.db
      .select()
      .from(workflowRuns)
      .where(inArray(workflowRuns.status, statuses));
    return rows.map((r) => this.mapRow(r));
  }

  async countByStatus(statuses: WorkflowRunStatus[]): Promise<number> {
    if (statuses.length === 0) return 0;
    const [row] = await this.db
      .select({ value: count() })
      .from(workflowRuns)
      .where(inArray(workflowRuns.status, statuses));
    return row?.value ?? 0;
  }

  async update(id: string, updates: Partial<WorkflowRun>): Promise<WorkflowRun> {
    // DB-03 — validate variables when present in the diff.
    if (updates.variables !== undefined) {
      validateJsonColumn(updates.variables, jsonRecord, { column: 'variables', table: 'workflow_runs' });
    }

    const values: Record<string, unknown> = {};
    if (updates.name !== undefined) values['name'] = updates.name;
    if (updates.status !== undefined) values['status'] = updates.status;
    if (updates.variables !== undefined) values['variables'] = updates.variables;
    if (updates.error !== undefined) values['error'] = updates.error;
    if (updates.permissionMode !== undefined) {
      values['permissionMode'] = updates.permissionMode ?? 'default';
      values['runOverrides'] = v1Overrides(updates.permissionMode);
    }
    if (updates.workspaceId !== undefined) values['workspaceId'] = updates.workspaceId;
    // F8 fix (PLAUSIBLE): ancestorRunId was omitted from the values map, so
    // any update call attempting to set or correct the ancestor chain was a
    // silent no-op. ancestorRunId is normally immutable after create(), but
    // including it here prevents silent data loss in future callers.
    if (updates.ancestorRunId !== undefined) values['ancestorRunId'] = updates.ancestorRunId;
    if (updates.startedAt !== undefined) values['startedAt'] = updates.startedAt;
    if (updates.completedAt !== undefined) values['completedAt'] = updates.completedAt;
    values['updatedAt'] = new Date();

    await this.db
      .update(workflowRuns)
      .set(values)
      .where(eq(workflowRuns.id, id));
    return this.getById(id);
  }

  async updateStatus(id: string, status: WorkflowRunStatus): Promise<void> {
    await this.db
      .update(workflowRuns)
      .set({ status, updatedAt: new Date() })
      .where(eq(workflowRuns.id, id));
  }

  async delete(id: string): Promise<void> {
    await this.db
      .delete(workflowRuns)
      .where(eq(workflowRuns.id, id));
  }

  private mapRow(row: typeof workflowRuns.$inferSelect): WorkflowRun {
    return {
      id: row.id,
      workflowDefinitionId: row.workflowDefinitionId,
      definitionVersionId: row.definitionVersionId,
      name: row.name,
      status: row.status as WorkflowRunStatus,
      sessionMode: 'per-stage',
      variables: safeJsonColumn(row.variables, jsonRecord, { fallback: {} }) ?? {},
      error: row.error ?? undefined,
      permissionMode: ((row.runOverrides as { permissionMode?: WorkflowRunPermissionMode } | null)?.permissionMode) ?? undefined,
      workspaceId: row.workspaceId ?? undefined,
      // W23: ancestor run for the retry identity chain.
      ancestorRunId: row.ancestorRunId ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      startedAt: row.startedAt ?? undefined,
      completedAt: row.completedAt ?? undefined,
    };
  }
}
