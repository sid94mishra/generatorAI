// ────────────────────────────────────────────────────────────────
// DrizzleWorkflowRunRepository — IWorkflowRunRepository impl (v2)
// ────────────────────────────────────────────────────────────────

import { count, eq, inArray } from 'drizzle-orm';
import type { IWorkflowRunRepository } from '@generatorai/core';
import type {
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowSessionMode,
  WorkflowRunPermissionMode,
  WorkflowDefinitionSnapshot,
} from '@generatorai/shared';
import { StorageError, NotFoundError } from '@generatorai/shared';
import { workflowRuns } from '../schema.js';
import type { AppDatabase } from '../index.js';
import { safeJsonColumn } from '../utils/safeJsonColumn.js';
import { validateJsonColumn } from '../utils/validateJsonColumn.js';
import { jsonRecord } from '../utils/jsonColumnSchemas.js';

/**
 * WS-D1 — drizzle's `mode: 'json'` already parses the column; this only
 * guards the shape so a hand-edited or truncated row degrades to "no
 * snapshot" instead of throwing inside `mapRow`.
 */
function parseSnapshot(value: unknown): WorkflowDefinitionSnapshot | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Partial<WorkflowDefinitionSnapshot>;
  if (!Array.isArray(v.stages) || !Array.isArray(v.edges)) return undefined;
  return {
    stages: v.stages,
    edges: v.edges,
    capturedAt: typeof v.capturedAt === 'string' ? v.capturedAt : new Date(0).toISOString(),
  };
}

export class DrizzleWorkflowRunRepository implements IWorkflowRunRepository {
  constructor(private db: AppDatabase) {}

  async create(run: WorkflowRun): Promise<WorkflowRun> {
    try {
      // DB-03 — validate variables (only JSON column on workflow_runs).
      validateJsonColumn(run.variables, jsonRecord, { column: 'variables', table: 'workflow_runs' });

      await this.db.insert(workflowRuns).values({
        id: run.id,
        workflowDefinitionId: run.workflowDefinitionId,
        name: run.name,
        status: run.status,
        sessionMode: run.sessionMode,
        masterSessionId: run.masterSessionId ?? null,
        variables: run.variables,
        error: run.error ?? null,
        // HITL — persist chosen mode; NULL reads as 'bypassPermissions'.
        permissionMode: run.permissionMode ?? null,
        workspaceId: run.workspaceId ?? null,
        // W23: persist the ancestor reference for the retry identity chain.
        ...(run.ancestorRunId ? { ancestorRunId: run.ancestorRunId } : {}),
        // WS-D1 — frozen topology, when the run was created from one.
        definitionSnapshot: run.definitionSnapshot ?? null,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        startedAt: run.startedAt ?? null,
        completedAt: run.completedAt ?? null,
      });
      return run;
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
    if (updates.sessionMode !== undefined) values['sessionMode'] = updates.sessionMode;
    if (updates.masterSessionId !== undefined) values['masterSessionId'] = updates.masterSessionId;
    if (updates.variables !== undefined) values['variables'] = updates.variables;
    if (updates.error !== undefined) values['error'] = updates.error;
    if (updates.permissionMode !== undefined) values['permissionMode'] = updates.permissionMode;
    if (updates.workspaceId !== undefined) values['workspaceId'] = updates.workspaceId;
    // F8 fix (PLAUSIBLE): ancestorRunId was omitted from the values map, so
    // any update call attempting to set or correct the ancestor chain was a
    // silent no-op. ancestorRunId is normally immutable after create(), but
    // including it here prevents silent data loss in future callers.
    if (updates.ancestorRunId !== undefined) values['ancestorRunId'] = updates.ancestorRunId;
    // WS-D1 — written once by startRun; nullable so pre-column runs read as undefined.
    if (updates.definitionSnapshot !== undefined) values['definitionSnapshot'] = updates.definitionSnapshot;
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
      name: row.name,
      status: row.status as WorkflowRunStatus,
      sessionMode: row.sessionMode as WorkflowSessionMode,
      masterSessionId: row.masterSessionId ?? undefined,
      variables: safeJsonColumn(row.variables, jsonRecord, { fallback: {} }) ?? {},
      error: row.error ?? undefined,
      permissionMode: (row.permissionMode as WorkflowRunPermissionMode | null) ?? undefined,
      workspaceId: row.workspaceId ?? undefined,
      // W23: ancestor run for the retry identity chain.
      ancestorRunId: (row as typeof workflowRuns.$inferSelect & { ancestorRunId?: string | null }).ancestorRunId ?? undefined,
      // WS-D1 — a malformed snapshot must not take the run down with it; the
      // scheduler falls back to the live definition when this is undefined.
      definitionSnapshot: parseSnapshot(row.definitionSnapshot),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      startedAt: row.startedAt ?? undefined,
      completedAt: row.completedAt ?? undefined,
    };
  }
}
