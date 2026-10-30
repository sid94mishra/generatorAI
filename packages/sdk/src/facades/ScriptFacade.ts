// ────────────────────────────────────────────────────────────────
// ScriptFacade — ai.scripts.*
// ────────────────────────────────────────────────────────────────

import type { CoreServices, WorkflowScriptLoader, ScriptMetadata, LoadedScript } from '@generatorai/core';
import type { InvocationResult, WorkflowDefinitionRecord } from '@generatorai/workflow-spec';
import type { ResolvedConfig } from '../config.js';
import { SDK_INVOCATION_CONTEXT } from './WorkflowFacade.js';

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
    this.services.workflowInvocationService.setScripts(loader);
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
   * SDK-5: Materialize a loaded `.workflow.mjs` into a persisted definition
   * through the one materializer (`createFromSpec`), mirroring the server's
   * POST /workflow-scripts/:id/materialize. The definition is published so it
   * can run.
   */
  async materialize(scriptId: string, options?: MaterializeScriptOptions): Promise<WorkflowDefinitionRecord> {
    if (!this.scriptLoader) throw new Error('Script loader not initialized');
    const script = this.scriptLoader.getScript(scriptId);
    if (!script) throw new Error(`Script not found: ${scriptId}`);
    const workflow = script.graph.workflow;
    return this.services.workflowDefinitionService.createFromSpec(
      {
        ...script.graph,
        workflow: {
          ...workflow,
          ...(options?.name ? { name: options.name } : {}),
          ...(options?.projectId ? { projectId: options.projectId } : {}),
          tags: [...new Set([...workflow.tags, `script:${scriptId}`])].slice(0, 20),
        },
      },
      { canEditCommands: true, status: 'published' },
    );
  }

  /**
   * SDK-5: run a script — THE invocation with a script target (P04): the
   * script is materialized once per content and its named profile sits
   * under the call's own inputs. Resolves once the run is starting.
   */
  async run(scriptId: string, options?: RunScriptOptions): Promise<InvocationResult> {
    if (!this.scriptLoader) throw new Error('Script loader not initialized');
    return this.services.workflowInvocationService.invoke(
      {
        target: { kind: 'script', scriptId },
        variables: options?.variables ?? {},
        ...(options?.profileName ? { profile: options.profileName } : {}),
        ...(options?.projectId ? { projectId: options.projectId } : {}),
        client: 'sdk',
      },
      SDK_INVOCATION_CONTEXT,
    );
  }
}
