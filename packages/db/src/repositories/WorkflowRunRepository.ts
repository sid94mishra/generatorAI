// ────────────────────────────────────────────────────────────────
// DrizzleWorkflowRunRepository — IWorkflowRunRepository impl (v2)
// ────────────────────────────────────────────────────────────────

import { eq, inArray } from 'drizzle-orm';
import type { IWorkflowRunRepository } from '@generatorai/core';
import type {
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowSessionMode,
  WorkflowRunPermissionMode,
} from '@generatorai/shared';
import { StorageError, NotFoundError } from '@generatorai/shared';
import { workflowRuns } from '../schema.js';
import type { AppDatabase } from '../index.js';
import { safeJsonColumn } from '../utils/safeJsonColumn.js';
import { validateJsonColumn } from '../utils/validateJsonColumn.js';
import { jsonRecord } from '../utils/jsonColumnSchemas.js';

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
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      startedAt: row.startedAt ?? undefined,
      completedAt: row.completedAt ?? undefined,
    };
  }
}
