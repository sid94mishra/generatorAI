// ────────────────────────────────────────────────────────────────
// DrizzleStageDefinitionRepository — IStageDefinitionRepository impl (v2)
// ────────────────────────────────────────────────────────────────

import { eq } from 'drizzle-orm';
import type { IStageDefinitionRepository } from '@generatorai/core';
import type {
  StageDefinition,
  PromptDefinition,
  RetryPolicy,
  StageCondition,
  HookDefinition,
  ContextFilter,
  ResultValidationRule,
} from '@generatorai/shared';
import { NotFoundError, StorageError, ValidationError } from '@generatorai/shared';
import { stageDefinitions } from '../schema.js';
import type { AppDatabase } from '../index.js';
import { safeJsonColumn } from '../utils/safeJsonColumn.js';
import { validateJsonColumn } from '../utils/validateJsonColumn.js';
import { jsonArray, jsonRecord } from '../utils/jsonColumnSchemas.js';

// DB-03 — shared Zod guards for JSON columns on stage_definitions. Used on
// both the write (validateJsonColumn) and read (safeJsonColumn) paths so
// malformed payloads fail at the repository boundary in both directions.
const stageJsonGuards = {
  prompts: jsonArray,
  harnessConfigOverrides: jsonRecord,
  variables: jsonRecord,
  hooks: jsonArray,
  retryPolicy: jsonRecord,
  condition: jsonRecord,
};

export class DrizzleStageDefinitionRepository implements IStageDefinitionRepository {
  constructor(private db: AppDatabase) {}

  async create(stage: StageDefinition): Promise<StageDefinition> {
    try {
      // DB-03 — validate every JSON column on the insert path.
      validateJsonColumn(stage.prompts, stageJsonGuards.prompts, { column: 'prompts', table: 'stage_definitions' });
      validateJsonColumn(stage.harnessConfigOverrides, stageJsonGuards.harnessConfigOverrides, { column: 'harnessConfigOverrides', table: 'stage_definitions' });
      validateJsonColumn(stage.variables, stageJsonGuards.variables, { column: 'variables', table: 'stage_definitions' });
      validateJsonColumn(stage.hooks, stageJsonGuards.hooks, { column: 'hooks', table: 'stage_definitions' });
      validateJsonColumn(stage.retryPolicy, stageJsonGuards.retryPolicy, { column: 'retryPolicy', table: 'stage_definitions' });
      validateJsonColumn(stage.condition, stageJsonGuards.condition, { column: 'condition', table: 'stage_definitions' });

      await this.db.insert(stageDefinitions).values({
        id: stage.id,
        workflowDefinitionId: stage.workflowDefinitionId,
        name: stage.name,
        description: stage.description ?? null,
        templateId: stage.templateId ?? null,
        order: stage.order,
        prompts: stage.prompts,
        harnessConfigOverrides: stage.harnessConfigOverrides ?? null,
        variables: stage.variables,
        hooks: stage.hooks,
        retryPolicy: stage.retryPolicy ?? null,
        timeoutMs: stage.timeoutMs ?? null,
        condition: stage.condition ?? null,
        contextFilter: stage.contextFilter ?? 'summary-only',
        contextSources: stage.contextSources ?? null,
        outputFormat: stage.outputFormat ?? 'text',
        agentName: stage.agentName ?? null,
        agentRef: stage.agentRef ?? null,
        resultValidation: stage.resultValidation ?? null,
        expectedOutput: stage.expectedOutput ?? null,
        outputSchema: stage.outputSchema ?? null,
        iterationConfig: (stage.iterationConfig as Record<string, unknown> | undefined) ?? null,
        approvalRequired: stage.approvalRequired ?? false,
        agentMode: stage.agentMode ?? null,
        createdAt: stage.createdAt,
      });
      return stage;
    } catch (err) {
      throw new StorageError(
        `Failed to create stage definition: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  async getById(id: string): Promise<StageDefinition> {
    const rows = await this.db
      .select()
      .from(stageDefinitions)
      .where(eq(stageDefinitions.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError('StageDefinition', id);
    return this.mapRow(row);
  }

  async getByDefinitionId(workflowDefinitionId: string): Promise<StageDefinition[]> {
    const rows = await this.db
      .select()
      .from(stageDefinitions)
      .where(eq(stageDefinitions.workflowDefinitionId, workflowDefinitionId))
      .orderBy(stageDefinitions.order);
    return rows.map((r) => this.mapRow(r));
  }

  async update(id: string, updates: Partial<StageDefinition>): Promise<StageDefinition> {
    // DB-03 — validate only the JSON columns that are in the diff.
    if (updates.prompts !== undefined) validateJsonColumn(updates.prompts, stageJsonGuards.prompts, { column: 'prompts', table: 'stage_definitions' });
    if (updates.harnessConfigOverrides !== undefined) validateJsonColumn(updates.harnessConfigOverrides, stageJsonGuards.harnessConfigOverrides, { column: 'harnessConfigOverrides', table: 'stage_definitions' });
    if (updates.variables !== undefined) validateJsonColumn(updates.variables, stageJsonGuards.variables, { column: 'variables', table: 'stage_definitions' });
    if (updates.hooks !== undefined) validateJsonColumn(updates.hooks, stageJsonGuards.hooks, { column: 'hooks', table: 'stage_definitions' });
    if (updates.retryPolicy !== undefined) validateJsonColumn(updates.retryPolicy, stageJsonGuards.retryPolicy, { column: 'retryPolicy', table: 'stage_definitions' });
    if (updates.condition !== undefined) validateJsonColumn(updates.condition, stageJsonGuards.condition, { column: 'condition', table: 'stage_definitions' });
    if (updates.resultValidation !== undefined) validateJsonColumn(updates.resultValidation, stageJsonGuards.hooks, { column: 'resultValidation', table: 'stage_definitions' });
    if (updates.outputSchema !== undefined) validateJsonColumn(updates.outputSchema, stageJsonGuards.variables, { column: 'outputSchema', table: 'stage_definitions' });
    if (updates.contextSources !== undefined) validateJsonColumn(updates.contextSources, stageJsonGuards.prompts, { column: 'contextSources', table: 'stage_definitions' });
    if (updates.iterationConfig !== undefined) validateJsonColumn(updates.iterationConfig, stageJsonGuards.variables, { column: 'iterationConfig', table: 'stage_definitions' });

    const values: Record<string, unknown> = {};
    if (updates.name !== undefined) values['name'] = updates.name;
    if (updates.description !== undefined) values['description'] = updates.description;
    if (updates.templateId !== undefined) values['templateId'] = updates.templateId;
    if (updates.order !== undefined) values['order'] = updates.order;
    if (updates.prompts !== undefined) values['prompts'] = updates.prompts;
    if (updates.harnessConfigOverrides !== undefined)
      values['harnessConfigOverrides'] = updates.harnessConfigOverrides;
    if (updates.variables !== undefined) values['variables'] = updates.variables;
    if (updates.hooks !== undefined) values['hooks'] = updates.hooks;
    if (updates.retryPolicy !== undefined) values['retryPolicy'] = updates.retryPolicy;
    if (updates.timeoutMs !== undefined) values['timeoutMs'] = updates.timeoutMs;
    if (updates.condition !== undefined) values['condition'] = updates.condition;
    if (updates.contextFilter !== undefined) values['contextFilter'] = updates.contextFilter;
    if (updates.contextSources !== undefined) values['contextSources'] = updates.contextSources;
    if (updates.outputFormat !== undefined) values['outputFormat'] = updates.outputFormat;
    if (updates.agentName !== undefined) values['agentName'] = updates.agentName;
    if (updates.agentRef !== undefined) values['agentRef'] = updates.agentRef ?? null;
    if (updates.resultValidation !== undefined) values['resultValidation'] = updates.resultValidation;
    if (updates.expectedOutput !== undefined) values['expectedOutput'] = updates.expectedOutput;
    if (updates.outputSchema !== undefined) values['outputSchema'] = updates.outputSchema;
    if (updates.iterationConfig !== undefined) values['iterationConfig'] = updates.iterationConfig;
    if (updates.approvalRequired !== undefined) values['approvalRequired'] = updates.approvalRequired;
    if (updates.agentMode !== undefined) values['agentMode'] = updates.agentMode;

    await this.db
      .update(stageDefinitions)
      .set(values)
      .where(eq(stageDefinitions.id, id));
    return this.getById(id);
  }

  async reorder(workflowDefinitionId: string, orderedIds: string[]): Promise<void> {
    for (let i = 0; i < orderedIds.length; i++) {
      const stageId = orderedIds[i];
      if (stageId) {
        await this.db
          .update(stageDefinitions)
          .set({ order: i })
          .where(eq(stageDefinitions.id, stageId));
      }
    }
  }

  async delete(id: string): Promise<void> {
    await this.db
      .delete(stageDefinitions)
      .where(eq(stageDefinitions.id, id));
  }

  async deleteByDefinitionId(workflowDefinitionId: string): Promise<void> {
    try {
      await this.db
        .delete(stageDefinitions)
        .where(eq(stageDefinitions.workflowDefinitionId, workflowDefinitionId));
    } catch (err) {
      // Detect FK violations by the driver's stable error code first
      // (better-sqlite3 sets SQLITE_CONSTRAINT_FOREIGNKEY); fall back to the
      // message substring only as a secondary signal. Matching on the message
      // alone is locale/driver-version fragile and can misclassify unrelated
      // errors that merely contain the words "FOREIGN KEY".
      const code = (err as { code?: string }).code;
      const msg = err instanceof Error ? err.message : String(err);
      if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || msg.includes('FOREIGN KEY')) {
        throw new ValidationError(
          `Cannot delete workflow definition: existing workflow runs reference its stages. Delete the runs first.`,
        );
      }
      throw err;
    }
  }

  private mapRow(row: typeof stageDefinitions.$inferSelect): StageDefinition {
    return {
      id: row.id,
      workflowDefinitionId: row.workflowDefinitionId,
      name: row.name,
      description: row.description ?? undefined,
      templateId: row.templateId ?? undefined,
      order: row.order,
      prompts: (safeJsonColumn(row.prompts, jsonArray, { fallback: [] }) ?? []) as PromptDefinition[],
      harnessConfigOverrides: safeJsonColumn(row.harnessConfigOverrides, jsonRecord, { fallback: undefined }),
      variables: safeJsonColumn(row.variables, jsonRecord, { fallback: {} }) ?? {},
      hooks: (safeJsonColumn(row.hooks, jsonArray, { fallback: [] }) ?? []) as HookDefinition[],
      retryPolicy: safeJsonColumn(row.retryPolicy, jsonRecord, { fallback: undefined }) as RetryPolicy | undefined,
      timeoutMs: row.timeoutMs ?? undefined,
      condition: safeJsonColumn(row.condition, jsonRecord, { fallback: undefined }) as StageCondition | undefined,
      contextFilter: (row.contextFilter as ContextFilter) ?? 'summary-only',
      contextSources: (safeJsonColumn(row.contextSources, jsonArray, { fallback: undefined }) ?? undefined) as string[] | undefined,
      outputFormat: (row.outputFormat ?? 'text') as 'text' | 'json',
      agentName: row.agentName ?? undefined,
      agentRef: row.agentRef ?? undefined,
      resultValidation: (safeJsonColumn(row.resultValidation, jsonArray, { fallback: undefined }) ?? undefined) as ResultValidationRule[] | undefined,
      expectedOutput: row.expectedOutput ?? undefined,
      outputSchema: safeJsonColumn(row.outputSchema, jsonRecord, { fallback: undefined }) as Record<string, unknown> | undefined,
      iterationConfig: safeJsonColumn(row.iterationConfig, jsonRecord, { fallback: undefined }) as StageDefinition['iterationConfig'],
      approvalRequired: row.approvalRequired ?? false,
      ...(row.agentMode ? { agentMode: row.agentMode } : {}),
      createdAt: row.createdAt,
    };
  }
}
