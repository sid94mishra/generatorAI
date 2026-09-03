// ────────────────────────────────────────────────────────────────
// DrizzleWorkflowDefinitionRepository — IWorkflowDefinitionRepository impl (v2)
// ────────────────────────────────────────────────────────────────

import { eq } from 'drizzle-orm';
import type { IWorkflowDefinitionRepository } from '@generatorai/core';
import type {
  WorkflowDefinition,
  WorkflowSessionMode,
  VariableDefinition,
  OrchestratorConfig,
  WorkflowHookDefinition,
  HooksFileConfig,
  SkillReference,
  AgentReference,
} from '@generatorai/shared';
import { StorageError, NotFoundError, ValidationError } from '@generatorai/shared';
import { workflowDefinitions } from '../schema.js';
import type { AppDatabase } from '../index.js';
import { safeJsonColumn } from '../utils/safeJsonColumn.js';
import { validateJsonColumn } from '../utils/validateJsonColumn.js';
import { jsonArray, jsonRecord, stringArray } from '../utils/jsonColumnSchemas.js';

export class DrizzleWorkflowDefinitionRepository implements IWorkflowDefinitionRepository {
  constructor(private db: AppDatabase) {}

  async create(definition: WorkflowDefinition): Promise<WorkflowDefinition> {
    try {
      // DB-03 — validate JSON columns before insert.
      validateJsonColumn(definition.harnessConfig, jsonRecord, { column: 'harnessConfig', table: 'workflow_definitions' });
      validateJsonColumn(definition.variables, jsonArray, { column: 'variables', table: 'workflow_definitions' });
      validateJsonColumn(definition.tags, stringArray, { column: 'tags', table: 'workflow_definitions' });
      validateJsonColumn(definition.orchestratorConfig, jsonRecord, { column: 'orchestratorConfig', table: 'workflow_definitions' });
      validateJsonColumn(definition.selectedArtifacts, jsonRecord, { column: 'selectedArtifacts', table: 'workflow_definitions' });
      validateJsonColumn(definition.hooks, jsonArray, { column: 'hooks', table: 'workflow_definitions' });
      validateJsonColumn(definition.hooksFile, jsonRecord, { column: 'hooksFile', table: 'workflow_definitions' });
      // G8 fix — these had no column at all before; validated the same way
      // as every other JSON column now that one exists.
      validateJsonColumn(definition.skills, jsonArray, { column: 'skills', table: 'workflow_definitions' });
      validateJsonColumn(definition.agents, jsonArray, { column: 'agents', table: 'workflow_definitions' });

      await this.db.insert(workflowDefinitions).values({
        id: definition.id,
        name: definition.name,
        description: definition.description ?? null,
        version: definition.version,
        sessionMode: definition.sessionMode,
        harnessConfig: definition.harnessConfig ?? null,
        variables: definition.variables,
        tags: definition.tags,
        orchestratorConfig: definition.orchestratorConfig ?? null,
        projectId: definition.projectId ?? null,
        selectedArtifacts: definition.selectedArtifacts ?? {},
        hooks: definition.hooks ?? [],
        hooksFile: definition.hooksFile ?? null,
        defaultAgentRef: definition.defaultAgentRef ?? null,
        skills: definition.skills ?? null,
        agents: definition.agents ?? null,
        createdAt: definition.createdAt,
        updatedAt: definition.updatedAt,
      });
      return definition;
    } catch (err) {
      throw new StorageError(
        `Failed to create workflow definition: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  async getById(id: string): Promise<WorkflowDefinition> {
    const rows = await this.db
      .select()
      .from(workflowDefinitions)
      .where(eq(workflowDefinitions.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError('Workflow definition', id);
    return this.mapRow(row);
  }

  async getAll(): Promise<WorkflowDefinition[]> {
    const rows = await this.db
      .select()
      .from(workflowDefinitions)
      .orderBy(workflowDefinitions.createdAt);
    return rows.map((r) => this.mapRow(r));
  }

  async getByProjectId(projectId: string): Promise<WorkflowDefinition[]> {
    const rows = await this.db
      .select()
      .from(workflowDefinitions)
      .where(eq(workflowDefinitions.projectId, projectId))
      .orderBy(workflowDefinitions.createdAt);
    return rows.map((r) => this.mapRow(r));
  }

  async update(id: string, updates: Partial<WorkflowDefinition>): Promise<WorkflowDefinition> {
    // DB-03 — validate JSON columns present in the update diff.
    if (updates.harnessConfig !== undefined) {
      validateJsonColumn(updates.harnessConfig, jsonRecord, { column: 'harnessConfig', table: 'workflow_definitions' });
    }
    if (updates.variables !== undefined) {
      validateJsonColumn(updates.variables, jsonArray, { column: 'variables', table: 'workflow_definitions' });
    }
    if (updates.tags !== undefined) {
      validateJsonColumn(updates.tags, stringArray, { column: 'tags', table: 'workflow_definitions' });
    }
    if (updates.orchestratorConfig !== undefined) {
      validateJsonColumn(updates.orchestratorConfig, jsonRecord, { column: 'orchestratorConfig', table: 'workflow_definitions' });
    }
    if (updates.selectedArtifacts !== undefined) {
      validateJsonColumn(updates.selectedArtifacts, jsonRecord, { column: 'selectedArtifacts', table: 'workflow_definitions' });
    }
    if (updates.hooks !== undefined) {
      validateJsonColumn(updates.hooks, jsonArray, { column: 'hooks', table: 'workflow_definitions' });
    }
    if (updates.hooksFile !== undefined) {
      validateJsonColumn(updates.hooksFile, jsonRecord, { column: 'hooksFile', table: 'workflow_definitions' });
    }
    if (updates.skills !== undefined) {
      validateJsonColumn(updates.skills, jsonArray, { column: 'skills', table: 'workflow_definitions' });
    }
    if (updates.agents !== undefined) {
      validateJsonColumn(updates.agents, jsonArray, { column: 'agents', table: 'workflow_definitions' });
    }

    const values: Record<string, unknown> = {};
    if (updates.name !== undefined) values['name'] = updates.name;
    if (updates.description !== undefined) values['description'] = updates.description;
    if (updates.version !== undefined) values['version'] = updates.version;
    if (updates.sessionMode !== undefined) values['sessionMode'] = updates.sessionMode;
    if (updates.harnessConfig !== undefined) values['harnessConfig'] = updates.harnessConfig;
    if (updates.variables !== undefined) values['variables'] = updates.variables;
    if (updates.tags !== undefined) values['tags'] = updates.tags;
    if (updates.orchestratorConfig !== undefined) values['orchestratorConfig'] = updates.orchestratorConfig;
    if (updates.projectId !== undefined) values['projectId'] = updates.projectId;
    if (updates.selectedArtifacts !== undefined) values['selectedArtifacts'] = updates.selectedArtifacts;
    if (updates.hooks !== undefined) values['hooks'] = updates.hooks;
    if (updates.hooksFile !== undefined) values['hooksFile'] = updates.hooksFile;
    if (updates.defaultAgentRef !== undefined) values['defaultAgentRef'] = updates.defaultAgentRef ?? null;
    if (updates.skills !== undefined) values['skills'] = updates.skills;
    if (updates.agents !== undefined) values['agents'] = updates.agents;
    values['updatedAt'] = new Date();

    await this.db
      .update(workflowDefinitions)
      .set(values)
      .where(eq(workflowDefinitions.id, id));
    return this.getById(id);
  }

  async delete(id: string): Promise<void> {
    try {
      await this.db
        .delete(workflowDefinitions)
        .where(eq(workflowDefinitions.id, id));
    } catch (err) {
      // Prefer the driver's stable FK error code over a fragile message match.
      const code = (err as { code?: string }).code;
      const msg = err instanceof Error ? err.message : String(err);
      if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || msg.includes('FOREIGN KEY')) {
        throw new ValidationError(
          `Cannot delete workflow definition: existing workflow runs reference it. Delete the runs first.`,
        );
      }
      throw err;
    }
  }

  private mapRow(row: typeof workflowDefinitions.$inferSelect): WorkflowDefinition {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      version: row.version,
      sessionMode: row.sessionMode as WorkflowSessionMode,
      harnessConfig: safeJsonColumn(row.harnessConfig, jsonRecord, { fallback: undefined }),
      variables: (safeJsonColumn(row.variables, jsonArray, { fallback: [] }) ?? []) as VariableDefinition[],
      tags: safeJsonColumn(row.tags, stringArray, { fallback: [] }) ?? [],
      orchestratorConfig: safeJsonColumn(row.orchestratorConfig, jsonRecord, { fallback: undefined }) as OrchestratorConfig | undefined,
      projectId: row.projectId ?? undefined,
      selectedArtifacts: safeJsonColumn(row.selectedArtifacts, jsonRecord, { fallback: undefined }) as Record<string, string[]> | undefined,
      useWorktree: row.useWorktree ?? true,
      hooks: (safeJsonColumn(row.hooks, jsonArray, { fallback: [] }) ?? []) as WorkflowHookDefinition[],
      hooksFile: safeJsonColumn(row.hooksFile, jsonRecord, { fallback: undefined }) as HooksFileConfig | undefined,
      defaultAgentRef: row.defaultAgentRef ?? undefined,
      skills: safeJsonColumn(row.skills, jsonArray, { fallback: undefined }) as SkillReference[] | undefined,
      agents: safeJsonColumn(row.agents, jsonArray, { fallback: undefined }) as AgentReference[] | undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
