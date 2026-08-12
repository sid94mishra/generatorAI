// ────────────────────────────────────────────────────────────────
// WorkflowDefinitionService — CRUD + validation for workflow definitions (v2)
// ────────────────────────────────────────────────────────────────

import type {
  WorkflowDefinition,
  WorkflowDefinitionWithStages,
  CreateWorkflowDefinitionParams,
  UpdateWorkflowDefinitionParams,
  StageDefinition,
  StageEdge,
  CreateStageParams,
  CreateEdgeParams,
  ImportWorkflowJson,
} from '@generatorai/shared';
import { generateId, ValidationError } from '@generatorai/shared';
import type { IWorkflowDefinitionRepository } from '../domain/ports/IWorkflowDefinitionRepository.js';
import type { IStageDefinitionRepository } from '../domain/ports/IStageDefinitionRepository.js';
import type { IStageEdgeRepository } from '../domain/ports/IStageEdgeRepository.js';
import { validateDAG, buildDAG } from '../domain/dag/DAGValidator.js';
import type { TemplateRegistry } from './TemplateRegistry.js';
import type { WorkflowTemplate } from '@generatorai/shared';
import type { DAGScheduler } from './DAGScheduler.js';

export class WorkflowDefinitionService {
  constructor(
    private definitionRepo: IWorkflowDefinitionRepository,
    private stageRepo: IStageDefinitionRepository,
    private edgeRepo: IStageEdgeRepository,
    private templateRegistry: TemplateRegistry,
    private dagScheduler?: DAGScheduler,
    /**
     * P0#4 — optional transactional wrapper. When supplied, a template/JSON
     * import (definition + N stages + M edges) commits atomically: a mid-import
     * failure rolls the whole set back instead of leaving an orphaned, partially
     * materialized definition. When omitted, imports fall back to best-effort
     * compensation (delete-on-failure). The body does DB writes only — no
     * network/fs — so it is safe to run inside the SQLite write transaction.
     */
    private withTransaction?: <T>(fn: () => Promise<T>) => Promise<T>,
  ) {}

  // ── Definition CRUD ──

  async createDefinition(params: CreateWorkflowDefinitionParams): Promise<WorkflowDefinition> {
    const now = new Date();
    const definition: WorkflowDefinition = {
      id: generateId(),
      name: params.name,
      description: params.description,
      version: 1,
      sessionMode: params.sessionMode ?? 'auto',
      harnessConfig: params.harnessConfig,
      variables: params.variables ?? [],
      tags: params.tags ?? [],
      orchestratorConfig: params.orchestratorConfig,
      projectId: params.projectId,
      selectedArtifacts: params.selectedArtifacts,
      hooks: params.hooks ?? [],
      hooksFile: params.hooksFile,
      createdAt: now,
      updatedAt: now,
    };
    return this.definitionRepo.create(definition);
  }

  async getDefinition(id: string): Promise<WorkflowDefinition> {
    return this.definitionRepo.getById(id);
  }

  async getDefinitionWithStages(id: string): Promise<WorkflowDefinitionWithStages> {
    const definition = await this.definitionRepo.getById(id);
    const stages = await this.stageRepo.getByDefinitionId(id);
    const edges = await this.edgeRepo.getByDefinitionId(id);
    return { ...definition, stages, edges };
  }

  async listDefinitions(projectId?: string): Promise<WorkflowDefinition[]> {
    if (projectId) {
      return this.definitionRepo.getByProjectId(projectId);
    }
    return this.definitionRepo.getAll();
  }

  async updateDefinition(
    id: string,
    params: UpdateWorkflowDefinitionParams,
  ): Promise<WorkflowDefinition> {
    const existing = await this.definitionRepo.getById(id);
    // `null` is the wire form for "clear the binding"; the entity uses undefined.
    const { defaultAgentRef, ...rest } = params;
    const updated = await this.definitionRepo.update(id, {
      ...rest,
      ...(defaultAgentRef === null
        ? { defaultAgentRef: undefined }
        : defaultAgentRef !== undefined
          ? { defaultAgentRef }
          : {}),
      version: existing.version + 1,
    });
    this.dagScheduler?.clearCache(id);
    return updated;
  }

  async deleteDefinition(id: string): Promise<void> {
    // Cascade: edges first, then stages, then definition
    await this.edgeRepo.deleteByDefinitionId(id);
    await this.stageRepo.deleteByDefinitionId(id);
    await this.definitionRepo.delete(id);
  }

  // ── Stage CRUD ──

  async addStage(params: CreateStageParams): Promise<StageDefinition> {
    // Get current stages to determine order
    const existing = await this.stageRepo.getByDefinitionId(params.workflowDefinitionId);
    const maxOrder = existing.reduce((max, s) => Math.max(max, s.order), -1);

    const stage: StageDefinition = {
      id: generateId(),
      workflowDefinitionId: params.workflowDefinitionId,
      name: params.name,
      description: params.description,
      templateId: params.templateId,
      order: params.order ?? maxOrder + 1,
      prompts: params.prompts ?? [],
      harnessConfigOverrides: params.harnessConfigOverrides,
      variables: params.variables ?? {},
      hooks: params.hooks ?? [],
      retryPolicy: params.retryPolicy,
      timeoutMs: params.timeoutMs,
      condition: params.condition,
      contextFilter: params.contextFilter,
      agentName: params.agentName,
      resultValidation: params.resultValidation,
      expectedOutput: params.expectedOutput,
      outputSchema: params.outputSchema,
      iterationConfig: params.iterationConfig,
      contextSources: params.contextSources,
      outputFormat: params.outputFormat,
      approvalRequired: params.approvalRequired ?? false,
      createdAt: new Date(),
    };
    const created = await this.stageRepo.create(stage);
    this.dagScheduler?.clearCache(params.workflowDefinitionId);
    return created;
  }

  async updateStage(id: string, updates: Partial<StageDefinition>): Promise<StageDefinition> {
    const updated = await this.stageRepo.update(id, updates);
    if (updated.workflowDefinitionId) {
      this.dagScheduler?.clearCache(updated.workflowDefinitionId);
    }
    return updated;
  }

  async deleteStage(id: string): Promise<void> {
    const stage = await this.stageRepo.getById(id);
    // Also remove edges involving this stage
    const edges = await this.edgeRepo.getByStageId(id);
    for (const edge of edges) {
      await this.edgeRepo.delete(edge.id);
    }
    await this.stageRepo.delete(id);
    this.dagScheduler?.clearCache(stage.workflowDefinitionId);
  }

  async reorderStages(workflowDefinitionId: string, orderedIds: string[]): Promise<void> {
    await this.stageRepo.reorder(workflowDefinitionId, orderedIds);
    this.dagScheduler?.clearCache(workflowDefinitionId);
  }

  // ── Edge CRUD ──

  async addEdge(params: CreateEdgeParams): Promise<StageEdge> {
    const edge: StageEdge = {
      id: generateId(),
      workflowDefinitionId: params.workflowDefinitionId,
      fromStageId: params.fromStageId,
      toStageId: params.toStageId,
      edgeType: params.edgeType ?? 'on_success',
    };
    const created = await this.edgeRepo.create(edge);
    this.dagScheduler?.clearCache(params.workflowDefinitionId);
    return created;
  }

  async deleteEdge(id: string): Promise<void> {
    const edge = await this.edgeRepo.getById(id);
    await this.edgeRepo.delete(id);
    if (edge.workflowDefinitionId) {
      this.dagScheduler?.clearCache(edge.workflowDefinitionId);
    }
  }

  // ── DAG Validation ──

  async validateDefinition(
    id: string,
  ): Promise<{ valid: boolean; errors: string[]; warnings: string[] }> {
    const stages = await this.stageRepo.getByDefinitionId(id);
    const edges = await this.edgeRepo.getByDefinitionId(id);

    const result = validateDAG(stages, edges);
    return { valid: result.valid, errors: result.errors, warnings: result.warnings };
  }

  // ── Template Import/Export ──

  async importFromTemplate(templateId: string, nameOverride?: string): Promise<WorkflowDefinition> {
    const template = this.templateRegistry.getWorkflowTemplate(templateId);
    if (!template) throw new ValidationError(`Template not found: ${templateId}`);

    // P0#4 — definition + stages + edges commit atomically (or roll back).
    const build = async (): Promise<WorkflowDefinition> => {
      const definition = await this.createDefinition({
        name: nameOverride ?? template.name,
        description: template.description,
        sessionMode: template.sessionMode ?? 'auto',
        harnessConfig: template.harnessConfig,
        tags: ['imported', `template:${templateId}`, ...(template.tags ?? [])],
      });

      try {
        // Create stages from template stages
        const createdStages: Array<{ id: string }> = [];
        for (let i = 0; i < template.stages.length; i++) {
          const tplStage = template.stages[i]!;
          const stage = await this.addStage({
            workflowDefinitionId: definition.id,
            name: tplStage.name,
            order: i,
            prompts: tplStage.prompts.map((p) => ({
              label: p.label ?? tplStage.name,
              text: p.text,
              waitForCompletion: p.waitForCompletion ?? true,
              attachments: p.attachments?.map((a) => typeof a === 'string' ? a : a),
            })),
            hooks: tplStage.hooks,
            harnessConfigOverrides: tplStage.harnessConfigOverrides,
            variables: tplStage.variables,
          });
          createdStages.push(stage);
        }

        // Create edges from template edges (index-based)
        for (const tplEdge of template.edges) {
          const fromStage = createdStages[tplEdge.fromStageIndex];
          const toStage = createdStages[tplEdge.toStageIndex];
          if (fromStage && toStage) {
            await this.addEdge({
              workflowDefinitionId: definition.id,
              fromStageId: fromStage.id,
              toStageId: toStage.id,
              edgeType: tplEdge.edgeType as 'on_success' | 'on_failure' | 'on_completion' | 'always',
            });
          }
        }

        return definition;
      } catch (error) {
        // In a transaction the rollback removes the partial definition for us;
        // otherwise compensate so we don't strand an orphaned definition.
        if (!this.withTransaction) await this.deleteDefinition(definition.id);
        throw error;
      }
    };

    return this.withTransaction ? this.withTransaction(build) : build();
  }

  async exportAsTemplate(id: string): Promise<WorkflowTemplate> {
    const def = await this.getDefinitionWithStages(id);
    const edges = await this.edgeRepo.getByDefinitionId(id);

    // Build a stageId → index map for edge conversion
    const stageIdToIndex = new Map<string, number>();
    def.stages.forEach((stage, i) => stageIdToIndex.set(stage.id, i));

    return {
      id: def.id,
      name: def.name,
      description: def.description ?? '',
      category: 'custom' as const,
      version: `${def.version}.0.0`,
      tags: def.tags ?? [],
      sessionMode: def.sessionMode ?? 'auto',
      requiresCodebase: false,
      supportsMultipleCodebases: false,
      harnessConfig: (def.harnessConfig ?? {}) as WorkflowTemplate['harnessConfig'],
      stages: def.stages.map((stage, i) => ({
        name: stage.name,
        description: stage.description ?? '',
        order: i,
        prompts: stage.prompts.map((p) => ({
          label: p.label,
          text: p.text,
          waitForCompletion: p.waitForCompletion,
          attachments: p.attachments ?? [],
        })),
        hooks: (stage.hooks ?? []) as WorkflowTemplate['hooks'],
        variables: stage.variables ?? {},
        harnessConfigOverrides: stage.harnessConfigOverrides as WorkflowTemplate['harnessConfig'],
        isLocked: false,
      })) as WorkflowTemplate['stages'],
      edges: edges.map((e) => ({
        fromStageIndex: stageIdToIndex.get(e.fromStageId) ?? 0,
        toStageIndex: stageIdToIndex.get(e.toStageId) ?? 0,
        edgeType: e.edgeType ?? 'on_success',
      })),
      variables: def.variables.map((v) => ({
        name: v.name,
        label: v.label,
        type: v.type as 'string' | 'number' | 'boolean' | 'choice' | 'text' | 'git_url' | 'git_urls',
        description: v.description,
        required: v.required,
        defaultValue: v.defaultValue,
        options: v.options,
      })),
      hooks: [],
      preprocessingSteps: [],
      resultValidations: [],
    };
  }

  // ── JSON Import ──

  async importFromJSON(data: ImportWorkflowJson): Promise<WorkflowDefinitionWithStages> {
    // Pre-validate edge indices before creating anything
    for (const edgeData of data.edges) {
      if (edgeData.fromStageIndex >= data.stages.length) {
        throw new ValidationError(
          `Edge references non-existent source stage at index ${edgeData.fromStageIndex}. ` +
          `Valid indices: 0-${data.stages.length - 1}.`,
        );
      }
      if (edgeData.toStageIndex >= data.stages.length) {
        throw new ValidationError(
          `Edge references non-existent target stage at index ${edgeData.toStageIndex}. ` +
          `Valid indices: 0-${data.stages.length - 1}.`,
        );
      }
    }

    // P0#4 — definition + stages + edges import atomically (or roll back).
    const build = async (): Promise<WorkflowDefinitionWithStages> => {
      // 1. Create the definition
      const definition = await this.createDefinition({
        name: data.name,
        description: data.description,
        sessionMode: data.sessionMode,
        harnessConfig: data.harnessConfig,
        variables: data.variables,
        tags: [...(data.tags ?? []), 'json-import'],
        hooks: data.hooks,
        hooksFile: data.hooksFile,
        projectId: data.projectId,
        skills: data.skills,
        agents: data.agents,
      });

      try {
        // 2. Create all stages and track their IDs by index
        const stageIdsByIndex: string[] = [];
        for (const stageData of data.stages) {
          const stage = await this.addStage({
            workflowDefinitionId: definition.id,
            name: stageData.name,
            description: stageData.description,
            templateId: stageData.templateId,
            order: stageData.order,
            prompts: stageData.prompts,
            harnessConfigOverrides: stageData.harnessConfigOverrides,
            variables: stageData.variables,
            hooks: stageData.hooks,
            retryPolicy: stageData.retryPolicy ?? undefined,
            timeoutMs: stageData.timeoutMs ?? undefined,
            condition: stageData.condition ?? undefined,
            contextFilter: stageData.contextFilter ?? undefined,
            agentName: stageData.agentName ?? undefined,
            resultValidation: stageData.resultValidation ?? undefined,
            expectedOutput: stageData.expectedOutput ?? undefined,
            outputSchema: stageData.outputSchema ?? undefined,
            iterationConfig: stageData.iterationConfig ?? undefined,
            approvalRequired: stageData.approvalRequired ?? false,
          });
          stageIdsByIndex.push(stage.id);
        }

        // 3. Create edges using index-to-ID mapping
        for (const edgeData of data.edges) {
          await this.addEdge({
            workflowDefinitionId: definition.id,
            fromStageId: stageIdsByIndex[edgeData.fromStageIndex]!,
            toStageId: stageIdsByIndex[edgeData.toStageIndex]!,
            edgeType: edgeData.edgeType,
          });
        }

        // 4. Validate the DAG
        const validation = await this.validateDefinition(definition.id);
        if (!validation.valid) {
          throw new ValidationError(
            `Imported workflow has invalid DAG: ${validation.errors.join('; ')}`,
          );
        }

        // 5. Return the full definition with stages and edges
        return this.getDefinitionWithStages(definition.id);
      } catch (error) {
        // In a transaction the rollback removes stages/edges/definition for us;
        // otherwise compensate (cascading delete removes stages and edges too).
        if (!this.withTransaction) await this.deleteDefinition(definition.id);
        throw error;
      }
    };

    return this.withTransaction ? this.withTransaction(build) : build();
  }
}
