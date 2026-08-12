// ────────────────────────────────────────────────────────────────
// ScriptFacade — ai.scripts.*
// ────────────────────────────────────────────────────────────────

import type { CoreServices, WorkflowScriptLoader, ScriptMetadata, LoadedScript } from '@generatorai/core';
import type { StageEdgeType, WorkflowDefinition, WorkflowRun } from '@generatorai/shared';
import type { ResolvedConfig } from '../config.js';

export type { ScriptMetadata };

export interface RunScriptOptions {
  profileName?: string;
  variables?: Record<string, unknown>;
  projectId?: string;
}

export interface MaterializeScriptOptions {
  name?: string;
  projectId?: string;
  variables?: Record<string, unknown>;
}

export class ScriptFacade {
  private scriptLoader?: WorkflowScriptLoader;

  constructor(
    private services: CoreServices,
    private config: ResolvedConfig,
    scriptLoader?: WorkflowScriptLoader,
  ) {
    this.scriptLoader = scriptLoader;
  }

  /** Inject script loader (late binding) */
  setScriptLoader(loader: WorkflowScriptLoader): void {
    this.scriptLoader = loader;
  }

  /** List all loaded scripts metadata */
  list(): ScriptMetadata[] {
    if (!this.scriptLoader) return [];
    return this.scriptLoader.getAllMetadata();
  }

  /** Get a loaded script by ID */
  get(scriptId: string): LoadedScript | undefined {
    if (!this.scriptLoader) return undefined;
    return this.scriptLoader.getScript(scriptId);
  }

  /** Validate a script file */
  async validate(filePath: string): Promise<{ valid: boolean; errors: string[] }> {
    if (!this.scriptLoader) return { valid: false, errors: ['Script loader not initialized'] };
    return this.scriptLoader.validateScriptFile(filePath);
  }

  /** Reload all scripts from disk */
  async reload(): Promise<ScriptMetadata[]> {
    if (!this.scriptLoader) return [];
    return this.scriptLoader.reloadAll();
  }

  /** Reload a specific script */
  async reloadScript(scriptId: string): Promise<LoadedScript> {
    if (!this.scriptLoader) throw new Error('Script loader not initialized');
    return this.scriptLoader.reloadScript(scriptId);
  }

  /**
   * SDK-5: Materialize a loaded `.workflow.mjs` into a persisted
   * WorkflowDefinition (createDefinition → addStage×N → addEdge×M), mirroring
   * the server's POST /workflow-scripts/:id/materialize. Returns the created
   * definition. Was previously absent (the doc-comment advertised it but the
   * facade only had list/get/validate/reload).
   */
  async materialize(scriptId: string, options?: MaterializeScriptOptions): Promise<WorkflowDefinition> {
    if (!this.scriptLoader) throw new Error('Script loader not initialized');
    const script = this.scriptLoader.getScript(scriptId);
    if (!script) throw new Error(`Script not found: ${scriptId}`);

    const out = script.output;
    const definition = await this.services.workflowDefinitionService.createDefinition({
      name: options?.name ?? out.definition.name,
      description: out.definition.description,
      sessionMode: out.definition.sessionMode,
      harnessConfig: out.definition.harnessConfig,
      variables: out.definition.variables,
      tags: [...(out.definition.tags ?? []), `script:${scriptId}`],
      projectId: options?.projectId,
      skills: out.definition.skills,
      agents: out.definition.agents,
      hooks: out.definition.hooks,
    });

    const stageIdMap = new Map<string, string>();
    for (const stage of out.stages) {
      const created = await this.services.workflowDefinitionService.addStage({
        workflowDefinitionId: definition.id,
        name: stage.config.name,
        description: stage.config.description,
        order: stage.config.order,
        prompts: stage.config.prompts,
        hooks: stage.config.hooks,
        variables: stage.config.variables
          ? { ...stage.config.variables, ...(options?.variables ?? {}) }
          : options?.variables,
        harnessConfigOverrides: stage.config.harnessConfigOverrides,
        agentName: stage.config.agentName,
        agentRef: stage.config.agentRef,
        contextFilter: stage.config.contextFilter,
        contextSources: stage.config.contextSources, // SCRIPT-2 parity
        outputFormat: stage.config.outputFormat,
        retryPolicy: stage.config.retryPolicy,
        timeoutMs: stage.config.timeoutMs,
        condition: stage.config.condition,
        iterationConfig: stage.config.iterationConfig,
        skills: stage.config.skills,
      });
      stageIdMap.set(stage.localId, created.id);
    }

    for (const edge of out.edges) {
      const fromStageId = stageIdMap.get(edge.from);
      const toStageId = stageIdMap.get(edge.to);
      if (fromStageId && toStageId) {
        await this.services.workflowDefinitionService.addEdge({
          workflowDefinitionId: definition.id,
          fromStageId,
          toStageId,
          edgeType: edge.edgeType as StageEdgeType,
        });
      }
    }

    return definition;
  }

  /**
   * SDK-5: Materialize a script and start a run of it (createRun → startRun).
   * Honors a named profile's variables when `profileName` is given. Returns the
   * started run. This is the SDK's headline "load a script and run it" path.
   */
  async run(scriptId: string, options?: RunScriptOptions): Promise<WorkflowRun> {
    if (!this.scriptLoader) throw new Error('Script loader not initialized');
    const script = this.scriptLoader.getScript(scriptId);
    if (!script) throw new Error(`Script not found: ${scriptId}`);

    // Merge profile variables (if any) under explicit call-site variables.
    let mergedVars = options?.variables ?? {};
    if (options?.profileName) {
      const profile = script.profiles.find((p) => p.name === options.profileName);
      if (!profile) throw new Error(`Profile not found: ${options.profileName}`);
      mergedVars = { ...profile.variables, ...mergedVars };
    }

    const definition = await this.materialize(scriptId, {
      projectId: options?.projectId,
      variables: mergedVars,
    });

    const run = await this.services.workflowRunService.createRun({
      workflowDefinitionId: definition.id,
      variables: mergedVars,
      projectId: options?.projectId,
    });
    await this.services.workflowRunService.startRun(run.id);
    return run;
  }
}
