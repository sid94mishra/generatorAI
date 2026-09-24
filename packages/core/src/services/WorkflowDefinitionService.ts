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
  OrchestratorConfig,
} from '@generatorai/shared';
import { generateId, ValidationError, DAGValidationError, ConflictError } from '@generatorai/shared';
import type { IWorkflowDefinitionRepository } from '../domain/ports/IWorkflowDefinitionRepository.js';
import type { IStageDefinitionRepository } from '../domain/ports/IStageDefinitionRepository.js';
import type { IStageEdgeRepository } from '../domain/ports/IStageEdgeRepository.js';
import type { IWorkflowRunRepository } from '../domain/ports/IWorkflowRunRepository.js';
import { validateDAG, buildDAG } from '../domain/dag/DAGValidator.js';
import type { DAGValidationResult } from '../domain/dag/types.js';
import type { TemplateRegistry } from './TemplateRegistry.js';
import type { WorkflowTemplate, WorkflowTemplateStage } from '@generatorai/shared';
import { templateStageToCreateParams } from '@generatorai/shared';
import type { DAGScheduler } from './DAGScheduler.js';

/** Options for `WorkflowDefinitionService.importFromTemplate`. */
export interface ImportFromTemplateOptions {
  /** Definition name; defaults to the template's. */
  name?: string;
  /** Bind the new definition to a project. */
  projectId?: string;
  /** Per-variable default overrides, keyed by variable name. */
  variableOverrides?: Record<string, unknown>;
  /** Auto-commit post-processing; default false. */
  autoCommit?: boolean;
  /**
   * Push the run's work branch after the auto-commit; default false. Implied
   * by `autoCreatePR`, so it only matters for "commit + push, no PR".
   */
  autoPush?: boolean;
}

/**
 * Template variable type → definition variable type. Template authors use
 * `git_url`/`git_urls` for repository inputs; a definition only knows the
 * five primitive kinds.
 */
function templateVariableType(type: string): 'string' | 'number' | 'boolean' | 'choice' | 'text' {
  switch (type) {
    case 'choice':
      return 'choice';
    case 'text':
      return 'text';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    default:
      return 'string';
  }
}

/**
 * Map a template's configurable variables onto definition variables, applying
 * caller-supplied default overrides. Shared by every template import path.
 */
export function templateVariablesToDefinitions(
  variables: ReadonlyArray<Record<string, unknown>>,
  overrides?: Record<string, unknown>,
): Array<Record<string, unknown>> {
  return variables.map((cv) => ({
    name: cv['name'],
    type: templateVariableType(String(cv['type'] ?? 'string')),
    label: cv['label'],
    description: cv['description'],
    required: cv['required'],
    defaultValue: overrides?.[String(cv['name'])] ?? cv['defaultValue'],
    options: cv['options'],
  }));
}

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
    /**
     * Item 9 — optional so every existing construction site keeps compiling;
     * when omitted, `deleteDefinition` falls back to the old unconditional
     * cascade (no run-count guard) rather than throwing on a missing
     * dependency. Wire it up wherever runs can actually exist.
     */
    private workflowRunRepo?: IWorkflowRunRepository,
  ) {}

  // ── Definition CRUD ──

  /**
   * Item 8 — throws `DAGValidationError` (422, `validationErrors` carries the
   * structured list) when `stages`/`edges` (or, if omitted, the definition's
   * CURRENT persisted stages/edges) do not form a valid DAG. Every write path
   * that can change the graph's shape — create, addStage, updateStage,
   * addEdge — runs this before persisting, so a cycle is rejected at save
   * time instead of surfacing only when the workflow runs.
   */
  private async assertValidDAG(
    workflowDefinitionId: string,
    stages?: StageDefinition[],
    edges?: StageEdge[],
  ): Promise<void> {
    const resolvedStages = stages ?? (await this.stageRepo.getByDefinitionId(workflowDefinitionId));
    const resolvedEdges = edges ?? (await this.edgeRepo.getByDefinitionId(workflowDefinitionId));
    const result = validateDAG(resolvedStages, resolvedEdges);
    if (!result.valid) {
      throw new DAGValidationError(
        `Workflow definition is not a valid DAG: ${result.errors.join('; ')}`,
        result.errors,
      );
    }
  }

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
    const created = await this.definitionRepo.create(definition);
    // A brand-new definition has no stages/edges yet, so this is trivially
    // valid today — it exists so this path can't silently diverge from
    // addStage/updateStage/addEdge if `createDefinition` ever grows the
    // ability to seed initial stages.
    await this.assertValidDAG(created.id, [], []);
    return created;
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

  /**
   * Item 9 — deletes a definition and its stages/edges atomically.
   *
   * Previously this ran three unguarded deletes with no transaction: when
   * the workflow had runs, the second delete (stages) failed on a foreign
   * key, leaving edges already deleted and everything else intact —
   * silently corrupting the definition instead of refusing the operation.
   *
   * Now: when runs reference this definition, refuse with a `ConflictError`
   * (409) naming how many, UNLESS `opts.force` is set, in which case the
   * runs are deleted too — all inside one transaction (when the caller
   * supplied `withTransaction`), so a mid-delete failure can't leave a
   * partially-deleted definition.
   */
  async deleteDefinition(id: string, opts?: { force?: boolean }): Promise<void> {
    const runs = this.workflowRunRepo ? await this.workflowRunRepo.getByDefinitionId(id) : [];
    if (runs.length > 0 && !opts?.force) {
      throw new ConflictError(
        `Cannot delete workflow definition ${id}: ${runs.length} run${runs.length === 1 ? '' : 's'} ` +
        `still reference it. Delete the run${runs.length === 1 ? '' : 's'} first, or pass force:true to remove ${runs.length === 1 ? 'it' : 'them'} too.`,
      );
    }

    const doDelete = async (): Promise<void> => {
      if (runs.length > 0 && opts?.force && this.workflowRunRepo) {
        for (const run of runs) {
          await this.workflowRunRepo.delete(run.id);
        }
      }
      // Cascade: edges first, then stages, then definition
      await this.edgeRepo.deleteByDefinitionId(id);
      await this.stageRepo.deleteByDefinitionId(id);
      await this.definitionRepo.delete(id);
    };

    if (this.withTransaction) {
      await this.withTransaction(doDelete);
    } else {
      await doDelete();
    }
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
      resultValidation: params.resultValidation,
      expectedOutput: params.expectedOutput,
      outputSchema: params.outputSchema,
      iterationConfig: params.iterationConfig,
      contextSources: params.contextSources,
      outputFormat: params.outputFormat,
      approvalRequired: params.approvalRequired ?? false,
      // These are all declared on CreateStageParams but were never copied onto
      // the entity, so anything set on a stage *before its first save* — the
      // agent binding, its skills, the prompt type, agent mode and per-stage
      // browser config — was dropped on create and only stuck if the user
      // happened to save a second time (which goes through updateStage).
      // `null` is the wire form for "no agent"; the entity uses undefined.
      agentRef: params.agentRef ?? undefined,
      skills: params.skills,
      promptType: params.promptType,
      agentMode: params.agentMode,
      browserConfig: params.browserConfig,
      createdAt: new Date(),
    };

    // Item 8 — validate the DAG as it WOULD be with this stage added, before
    // persisting.
    const edges = await this.edgeRepo.getByDefinitionId(params.workflowDefinitionId);
    await this.assertValidDAG(params.workflowDefinitionId, [...existing, stage], edges);

    const created = await this.stageRepo.create(stage);
    this.dagScheduler?.clearCache(params.workflowDefinitionId);
    return created;
  }

  async updateStage(id: string, updates: Partial<StageDefinition>): Promise<StageDefinition> {
    // Item 8 — validate the DAG as it WOULD be with these updates applied,
    // before persisting. Most stage edits (prompt text, timeouts, ...) can't
    // affect DAG shape, but this stays correct even for the ones that could
    // in the future without needing to know which fields those are.
    const current = await this.stageRepo.getById(id);
    const merged: StageDefinition = { ...current, ...updates };
    const siblings = await this.stageRepo.getByDefinitionId(current.workflowDefinitionId);
    const nextStages = siblings.map((s) => (s.id === id ? merged : s));
    const edges = await this.edgeRepo.getByDefinitionId(current.workflowDefinitionId);
    await this.assertValidDAG(current.workflowDefinitionId, nextStages, edges);

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

    // Item 8 — this is the edit that actually CAN close a cycle, so this is
    // the one check that must run before the edge is persisted, not after.
    const stages = await this.stageRepo.getByDefinitionId(params.workflowDefinitionId);
    const existingEdges = await this.edgeRepo.getByDefinitionId(params.workflowDefinitionId);
    await this.assertValidDAG(params.workflowDefinitionId, stages, [...existingEdges, edge]);

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

  async validateDefinition(id: string): Promise<DAGValidationResult> {
    const stages = await this.stageRepo.getByDefinitionId(id);
    const edges = await this.edgeRepo.getByDefinitionId(id);

    const result = validateDAG(stages, edges);
    // `issues` carries the same findings with the stage/edge each belongs to,
    // so a client can navigate from an error to the element responsible
    // instead of re-parsing the prose in `errors`.
    return {
      valid: result.valid,
      errors: result.errors,
      warnings: result.warnings,
      issues: result.issues,
    };
  }

  // ── Template Import/Export ──

  /**
   * THE template importer. Settings → Templates and the
   * `/workflow-definitions/import` route both come through here.
   *
   * There used to be two: this one and a copy in the orchestrator that was
   * not transactional (a stage-insert failure left a half-built definition),
   * hardcoded `sessionMode: 'auto'` where this honoured the template's, forced
   * `autoCommit: true`, and dropped the `imported` tag — the "fixed in one
   * path, left in its duplicate" pattern. The orchestrator's extra inputs
   * (project binding, per-variable default overrides, auto-commit) are options
   * here so there is exactly one mapping.
   */
  async importFromTemplate(
    templateId: string,
    options: ImportFromTemplateOptions = {},
  ): Promise<WorkflowDefinition> {
    const template = this.templateRegistry.getWorkflowTemplate(templateId);
    if (!template) throw new ValidationError(`Template not found: ${templateId}`);

    // P0#4 — definition + stages + edges commit atomically (or roll back).
    const build = async (): Promise<WorkflowDefinition> => {
      const definition = await this.createDefinition({
        name: options.name ?? template.name,
        description: template.description,
        sessionMode: template.sessionMode ?? 'auto',
        harnessConfig: template.harnessConfig,
        tags: ['imported', `template:${templateId}`, ...(template.tags ?? [])],
        ...(options.projectId ? { projectId: options.projectId } : {}),
        // Item 7 — these were silently dropped on every template import: a
        // template's declared variables/hooks never reached the definition,
        // and its preprocessing/result-validation/codebase-requirement
        // settings (`orchestratorConfig`) never reached the run at all.
        variables: templateVariablesToDefinitions(
          (template.variables ?? []) as unknown as ReadonlyArray<Record<string, unknown>>,
          options.variableOverrides,
        ) as unknown as CreateWorkflowDefinitionParams['variables'],
        hooks: (template.hooks ?? []) as unknown as CreateWorkflowDefinitionParams['hooks'],
        orchestratorConfig: {
          category: 'derived',
          parentTemplateId: templateId,
          requiresCodebase: template.requiresCodebase ?? false,
          preprocessingSteps: (template.preprocessingSteps ?? []) as unknown as OrchestratorConfig['preprocessingSteps'],
          postProcessingSteps: [],
          resultValidations: (template.resultValidations ?? []) as unknown as OrchestratorConfig['resultValidations'],
          autoCommit: options.autoCommit ?? false,
          autoPush: options.autoPush ?? false,
          autoCreatePR: false,
        } satisfies OrchestratorConfig,
      });

      try {
        // Create stages from template stages.
        //
        // Item 7 — this used to hand-pick six fields off each template stage
        // (name/order/prompts/hooks/harnessConfigOverrides/variables), which
        // silently dropped retryPolicy, timeoutMs, condition, contextFilter,
        // resultValidation, expectedOutput, outputSchema,
        // agentRef, contextSources and outputFormat — including
        // `approvalRequired`, so an approval-gated template ran unattended.
        // `templateStageToCreateParams` is the SAME mapper `importFromJSON`
        // (below) already uses; using it here too means there is exactly one
        // template-stage → CreateStageParams mapping in the codebase instead
        // of two that can drift apart.
        const createdStages: Array<{ id: string }> = [];
        for (let i = 0; i < template.stages.length; i++) {
          const tplStage = template.stages[i]!;
          const stage = await this.addStage(
            templateStageToCreateParams(tplStage, definition.id, i) as unknown as CreateStageParams,
          );
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
      // These round-trip back out of the exported template, so hardcoding them threw away part of every round trip: a
      // workflow that required a codebase came back not requiring one.
      requiresCodebase: def.orchestratorConfig?.requiresCodebase ?? false,
      supportsMultipleCodebases: (def.orchestratorConfig?.codebaseAliases?.length ?? 0) > 1,
      harnessConfig: (def.harnessConfig ?? {}) as WorkflowTemplate['harnessConfig'],
      // Everything `importFromJSON` knows how to read has to be written here,
      // or the documented "re-importable" round-trip quietly returns a
      // different workflow: retry policies, timeouts, run conditions, context
      // filters, validation rules and approval gates were all dropped.
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
        ...(stage.retryPolicy ? { retryPolicy: stage.retryPolicy } : {}),
        ...(stage.timeoutMs !== undefined ? { timeoutMs: stage.timeoutMs } : {}),
        ...(stage.condition ? { condition: stage.condition } : {}),
        ...(stage.contextFilter ? { contextFilter: stage.contextFilter } : {}),
        ...(stage.contextSources ? { contextSources: stage.contextSources } : {}),
        ...(stage.outputFormat ? { outputFormat: stage.outputFormat } : {}),
        ...(stage.resultValidation?.length ? { resultValidation: stage.resultValidation } : {}),
        ...(stage.expectedOutput ? { expectedOutput: stage.expectedOutput } : {}),
        ...(stage.outputSchema ? { outputSchema: stage.outputSchema } : {}),
        ...(stage.approvalRequired ? { approvalRequired: true } : {}),
        ...(stage.agentRef ? { agentRef: stage.agentRef } : {}),
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
      hooks: (def.hooks ?? []) as WorkflowTemplate['hooks'],
      preprocessingSteps: (def.orchestratorConfig?.preprocessingSteps
        ?? []) as unknown as WorkflowTemplate['preprocessingSteps'],
      resultValidations: (def.orchestratorConfig?.resultValidations
        ?? []) as unknown as WorkflowTemplate['resultValidations'],
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
          const stage = await this.addStage(
            templateStageToCreateParams(
              stageData as unknown as WorkflowTemplateStage,
              definition.id,
            ) as unknown as CreateStageParams,
          );
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
