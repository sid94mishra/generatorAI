// ────────────────────────────────────────────────────────────────
// DrizzleAutomationExecutionRepository — Execution log persistence
// ────────────────────────────────────────────────────────────────

import { eq, desc } from 'drizzle-orm';
import type {
  AutomationExecution,
  AutomationExecutionRun,
  AutomationExecutionStatus,
  AutomationRunItemStatus,
  AutomationTriggerType,
  AutomationDataset,
} from '@generatorai/shared';
import { NotFoundError, StorageError } from '@generatorai/shared';
import { automationExecutions, automationExecutionRuns } from '../schema.js';
import type { AppDatabase } from '../index.js';
import { safeJsonColumn } from '../utils/safeJsonColumn.js';
import { jsonRecord } from '../utils/jsonColumnSchemas.js';

export class DrizzleAutomationExecutionRepository {
  constructor(private db: AppDatabase) {}

  // ── Executions ──

  async createExecution(execution: AutomationExecution): Promise<AutomationExecution> {
    try {
      await this.db.insert(automationExecutions).values({
        id: execution.id,
        automationId: execution.automationId,
        status: execution.status,
        triggeredBy: execution.triggeredBy,
        webhookPayload: execution.webhookPayload ?? null,
        workspaceId: execution.workspaceId ?? null,
        totalIterations: execution.totalIterations,
        completedIterations: execution.completedIterations,
        failedIterations: execution.failedIterations,
        error: execution.error ?? null,
        datasetSnapshot: execution.datasetSnapshot ?? null,
        startedAt: execution.startedAt ?? null,
        completedAt: execution.completedAt ?? null,
        createdAt: execution.createdAt,
      });
      return execution;
    } catch (err) {
      throw new StorageError(
        `Failed to create automation execution: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  async getExecutionById(id: string): Promise<AutomationExecution> {
    const rows = await this.db
      .select()
      .from(automationExecutions)
      .where(eq(automationExecutions.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError('AutomationExecution', id);
    return this.mapExecutionRow(row);
  }

  async getExecutionsByAutomationId(automationId: string): Promise<AutomationExecution[]> {
    const rows = await this.db
      .select()
      .from(automationExecutions)
      .where(eq(automationExecutions.automationId, automationId))
      .orderBy(desc(automationExecutions.createdAt));
    return rows.map((r) => this.mapExecutionRow(r));
  }

  async updateExecution(id: string, updates: Partial<AutomationExecution>): Promise<AutomationExecution> {
    const values: Partial<typeof automationExecutions.$inferInsert> = {};
    if (updates.status !== undefined) values.status = updates.status;
    if (updates.totalIterations !== undefined) values.totalIterations = updates.totalIterations;
    if (updates.completedIterations !== undefined) values.completedIterations = updates.completedIterations;
    if (updates.failedIterations !== undefined) values.failedIterations = updates.failedIterations;
    if (updates.error !== undefined) values.error = updates.error ?? null;
    if (updates.datasetSnapshot !== undefined) values.datasetSnapshot = updates.datasetSnapshot ?? null;
    if (updates.startedAt !== undefined) values.startedAt = updates.startedAt ?? null;
    if (updates.completedAt !== undefined) values.completedAt = updates.completedAt ?? null;

    await this.db
      .update(automationExecutions)
      .set(values)
      .where(eq(automationExecutions.id, id));
    return this.getExecutionById(id);
  }

  async deleteExecution(id: string): Promise<void> {
    await this.db
      .delete(automationExecutions)
      .where(eq(automationExecutions.id, id));
  }

  // ── Execution Runs ──

  async createExecutionRun(run: AutomationExecutionRun): Promise<AutomationExecutionRun> {
    try {
      await this.db.insert(automationExecutionRuns).values({
        id: run.id,
        executionId: run.executionId,
        workflowRunId: run.workflowRunId,
        workflowDefinitionId: run.workflowDefinitionId,
        iterationIndex: run.iterationIndex,
        iterationVariables: run.iterationVariables ?? null,
        iterationLabel: run.iterationLabel ?? null,
        status: run.status,
        attemptCount: run.attemptCount ?? 1,
        createdAt: run.createdAt,
      });
      return run;
    } catch (err) {
      throw new StorageError(
        `Failed to create execution run: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  async getExecutionRunsByExecutionId(executionId: string): Promise<AutomationExecutionRun[]> {
    const rows = await this.db
      .select()
      .from(automationExecutionRuns)
      .where(eq(automationExecutionRuns.executionId, executionId))
      .orderBy(automationExecutionRuns.iterationIndex);
    return rows.map((r) => this.mapExecutionRunRow(r));
  }

  async updateExecutionRun(id: string, updates: Partial<AutomationExecutionRun>): Promise<AutomationExecutionRun> {
    const values: Partial<typeof automationExecutionRuns.$inferInsert> = {};
    if (updates.status !== undefined) values.status = updates.status;
    if (updates.attemptCount !== undefined) values.attemptCount = updates.attemptCount;
    await this.db
      .update(automationExecutionRuns)
      .set(values)
      .where(eq(automationExecutionRuns.id, id));
    const rows = await this.db
      .select()
      .from(automationExecutionRuns)
      .where(eq(automationExecutionRuns.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError('AutomationExecutionRun', id);
    return this.mapExecutionRunRow(row);
  }

  // ── Mappers ──

  private mapExecutionRow(row: typeof automationExecutions.$inferSelect): AutomationExecution {
    return {
      id: row.id,
      automationId: row.automationId,
      status: row.status as AutomationExecutionStatus,
      triggeredBy: row.triggeredBy as AutomationTriggerType,
      webhookPayload: row.webhookPayload ?? undefined,
      workspaceId: row.workspaceId ?? undefined,
      totalIterations: row.totalIterations,
      completedIterations: row.completedIterations,
      failedIterations: row.failedIterations,
      error: row.error ?? undefined,
      datasetSnapshot: safeJsonColumn(row.datasetSnapshot, jsonRecord, { fallback: undefined }) as AutomationDataset | undefined,
      startedAt: row.startedAt ?? undefined,
      completedAt: row.completedAt ?? undefined,
      createdAt: row.createdAt,
    };
  }

  private mapExecutionRunRow(row: typeof automationExecutionRuns.$inferSelect): AutomationExecutionRun {
    return {
      id: row.id,
      executionId: row.executionId,
      workflowRunId: row.workflowRunId,
      workflowDefinitionId: row.workflowDefinitionId,
      iterationIndex: row.iterationIndex,
      iterationVariables: safeJsonColumn(row.iterationVariables, jsonRecord, { fallback: undefined }),
      iterationLabel: row.iterationLabel ?? undefined,
      status: row.status as AutomationRunItemStatus,
      attemptCount: row.attemptCount ?? 1,
      createdAt: row.createdAt,
    };
  }
}
