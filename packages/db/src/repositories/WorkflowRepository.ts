// ────────────────────────────────────────────────────────────────
// DrizzleWorkflowRepository — IWorkflowRepository impl
// ────────────────────────────────────────────────────────────────

import { eq, and } from 'drizzle-orm';
import type { IWorkflowRepository } from '@generatorai/core';
import type { Workflow, WorkflowStatus, HookDefinition } from '@generatorai/shared';
import { NotFoundError, StorageError } from '@generatorai/shared';
import { workflows } from '../schema.js';
import type { AppDatabase } from '../index.js';
import { safeJsonColumn } from '../utils/safeJsonColumn.js';
import { jsonRecord } from '../utils/jsonColumnSchemas.js';

/**
 * @deprecated v1 workflow CRUD — use WorkflowDefinitionRepository + WorkflowRunRepository instead.
 */
export class DrizzleWorkflowRepository implements IWorkflowRepository {
  constructor(private db: AppDatabase) {}

  async create(workflow: Workflow): Promise<Workflow> {
    try {
      await this.db.insert(workflows).values({
        id: workflow.id,
        sessionId: workflow.sessionId,
        templateId: workflow.templateId,
        name: workflow.name,
        order: workflow.order,
        status: workflow.status,
        conversationId: workflow.conversationId ?? null,
        variables: workflow.variables,
        hookOverrides: workflow.hookOverrides as Record<string, unknown>,
        harnessConfigOverrides: workflow.harnessConfigOverrides ?? null,
        currentStep: workflow.currentStep,
        totalSteps: workflow.totalSteps,
        error: workflow.error ?? null,
        startedAt: workflow.startedAt ?? null,
        completedAt: workflow.completedAt ?? null,
        createdAt: workflow.createdAt,
      });
      return workflow;
    } catch (err) {
      throw new StorageError(
        `Failed to create workflow: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  async getById(id: string): Promise<Workflow> {
    const rows = await this.db
      .select()
      .from(workflows)
      .where(eq(workflows.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError('Workflow', id);
    return this.mapRow(row);
  }

  async getBySessionId(sessionId: string): Promise<Workflow[]> {
    const rows = await this.db
      .select()
      .from(workflows)
      .where(eq(workflows.sessionId, sessionId))
      .orderBy(workflows.order);
    return rows.map((r) => this.mapRow(r));
  }

  async updateStatus(id: string, status: WorkflowStatus): Promise<void> {
    await this.db
      .update(workflows)
      .set({ status })
      .where(eq(workflows.id, id));
  }

  async update(id: string, updates: Partial<Workflow>): Promise<Workflow> {
    const values: Record<string, unknown> = {};
    if (updates.status !== undefined) values['status'] = updates.status;
    if (updates.conversationId !== undefined) values['conversationId'] = updates.conversationId;
    if (updates.variables !== undefined) values['variables'] = updates.variables;
    if (updates.currentStep !== undefined) values['currentStep'] = updates.currentStep;
    if (updates.totalSteps !== undefined) values['totalSteps'] = updates.totalSteps;
    if (updates.error !== undefined) values['error'] = updates.error;
    if (updates.startedAt !== undefined) values['startedAt'] = updates.startedAt;
    if (updates.completedAt !== undefined) values['completedAt'] = updates.completedAt;

    await this.db
      .update(workflows)
      .set(values)
      .where(eq(workflows.id, id));
    return this.getById(id);
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(workflows).where(eq(workflows.id, id));
  }

  private mapRow(row: typeof workflows.$inferSelect): Workflow {
    return {
      id: row.id,
      sessionId: row.sessionId,
      templateId: row.templateId,
      name: row.name,
      order: row.order,
      status: row.status as WorkflowStatus,
      conversationId: row.conversationId ?? undefined,
      variables: safeJsonColumn(row.variables, jsonRecord, { fallback: {} }) ?? {},
      hookOverrides: (safeJsonColumn(row.hookOverrides, jsonRecord, { fallback: {} }) ?? {}) as Record<string, Partial<HookDefinition>>,
      harnessConfigOverrides: safeJsonColumn(row.harnessConfigOverrides, jsonRecord, { fallback: undefined }),
      currentStep: row.currentStep ?? 0,
      totalSteps: row.totalSteps ?? 0,
      error: row.error ?? undefined,
      startedAt: row.startedAt ?? undefined,
      completedAt: row.completedAt ?? undefined,
      createdAt: row.createdAt,
    };
  }
}
