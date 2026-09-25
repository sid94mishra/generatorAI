// ────────────────────────────────────────────────────────────────
// WorkflowBuilder — Fluent builder for programmatic workflow scripts
//
// Provides a code-first API for defining workflows as an alternative
// to JSON templates. Users write .workflow.mjs files using this builder.
// ────────────────────────────────────────────────────────────────

import { generateId } from '../utils/index.js';
import { MAX_STAGES_PER_WORKFLOW } from '../constants/index.js';
import type { HarnessConfig } from '../types/Workflow.js';
import type {
  VariableDefinition,
  WorkflowSessionMode,
} from '../types/WorkflowDefinition.js';
import type { StageEdgeType } from '../types/StageDefinition.js';
import type {
  HookType,
  HookConfig,
  WorkflowHookPhase,
} from '../types/HookDefinition.js';
import type {
  PreprocessingStep,
  StageResultValidation,
} from '../types/WorkflowOrchestrator.js';
import type {
  VariableConfig,
  McpServerBuilderConfig,
  HookDefinitionConfig,
  WorkflowHookHandler,
  StageHookHandler,
  WorkflowScriptOutput,
  EdgeOutput,
} from './types.js';
import { StageBuilder } from './StageBuilder.js';

export class WorkflowBuilder {
  private _name = '';
  private _description?: string;
  private _sessionMode: WorkflowSessionMode = 'auto';
  private _tags: string[] = [];
  private _variables: VariableDefinition[] = [];
  private _model?: string;
  private _systemPromptAppend?: string;
  private _mcpServers: Record<string, McpServerBuilderConfig> = {};
  private _harnessConfig: Partial<HarnessConfig> = {};
  private _availableTools?: string[];
  private _excludedTools?: string[];
  private _stages: Array<{ localId: string; builder: StageBuilder }> = [];
  private _edges: EdgeOutput[] = [];
  private _preprocessingSteps: PreprocessingStep[] = [];
  private _resultValidations: StageResultValidation[] = [];
  private _useWorktree?: boolean;
  private _requiresCodebase?: boolean;
  private _hooks: Array<{
    id: string;
    name: string;
    phase: WorkflowHookPhase | 'pre_clone' | 'post_clone' | 'pre_commit' | 'post_commit';
    type: HookType;
    priority: number;
    enabled: boolean;
    failurePolicy: 'abort' | 'skip' | 'continue';
    timeoutMs: number;
    retries: number;
    config: HookConfig;
  }> = [];
  private _inlineHooks = new Map<string, WorkflowHookHandler>();

  constructor(private readonly _id: string) {
    if (!_id || _id.length === 0) {
      throw new Error('WorkflowBuilder requires a non-empty id');
    }
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(_id)) {
      throw new Error('Workflow id must start with a letter and contain only letters, digits, hyphens, and underscores');
    }
  }

  // ═══ Identity ═══

  name(name: string): this {
    this._name = name;
    return this;
  }

  description(description: string): this {
    this._description = description;
    return this;
  }

  tags(tags: string[]): this {
    this._tags = tags;
    return this;
  }

  // ═══ Session Mode ═══

  sessionMode(mode: WorkflowSessionMode): this {
    this._sessionMode = mode;
    return this;
  }

  // ═══ Variables (User Inputs) ═══

  variable(name: string, config: VariableConfig): this {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      throw new Error(`Variable name '${name}' must be a valid identifier`);
    }
    // Map git_url/git_urls to 'string' type for VariableDefinition compat
    const varType = (config.type === 'git_url' || config.type === 'git_urls')
      ? 'string'
      : config.type;

    this._variables.push({
      name,
      type: varType as VariableDefinition['type'],
      label: config.label,
      description: config.description,
      required: config.required,
      defaultValue: config.defaultValue,
      options: config.options,
    });
    return this;
  }

  // ═══ Harness (LLM) Configuration ═══

  model(model: string): this {
    this._model = model;
    return this;
  }

  systemPromptAppend(content: string): this {
    this._systemPromptAppend = content;
    return this;
  }

  mcpServer(name: string, config: McpServerBuilderConfig): this {
    this._mcpServers[name] = config;
    return this;
  }

  harnessConfig(config: Partial<HarnessConfig>): this {
    this._harnessConfig = { ...this._harnessConfig, ...config };
    return this;
  }

  availableTools(tools: string[]): this {
    this._availableTools = tools;
    return this;
  }

  excludedTools(tools: string[]): this {
    this._excludedTools = tools;
    return this;
  }

  // ═══ Stages ═══

  stage(localId: string, configurator: (stage: StageBuilder) => StageBuilder): this {
    if (this._stages.length >= MAX_STAGES_PER_WORKFLOW) {
      throw new Error(`Cannot add more than ${MAX_STAGES_PER_WORKFLOW} stages. Current count: ${this._stages.length}`);
    }
    if (this._stages.some(s => s.localId === localId)) {
      throw new Error(`Duplicate stage localId: '${localId}'`);
    }
    const builder = new StageBuilder();
    configurator(builder);
    this._stages.push({ localId, builder });
    return this;
  }

  // ═══ Edges (DAG Connections) ═══

  edge(
    fromStageId: string,
    toStageId: string,
    edgeType: StageEdgeType,
    condition?: string,
  ): this {
    this._edges.push({ from: fromStageId, to: toStageId, edgeType, condition });
    return this;
  }

  // ═══ Workflow-Level Hooks (Inline Functions) ═══

  onRunStart(handler: WorkflowHookHandler): this {
    return this.addInlineWorkflowHook('on_run_start', handler);
  }

  onRunComplete(handler: WorkflowHookHandler): this {
    return this.addInlineWorkflowHook('on_run_complete', handler);
  }

  onRunFailed(handler: WorkflowHookHandler): this {
    return this.addInlineWorkflowHook('on_run_failed', handler);
  }

  onRunCancelled(handler: WorkflowHookHandler): this {
    return this.addInlineWorkflowHook('on_run_cancelled', handler);
  }

  onPreprocessingComplete(handler: WorkflowHookHandler): this {
    return this.addInlineWorkflowHook('on_preprocessing_complete', handler);
  }

  onAllStagesScheduled(handler: WorkflowHookHandler): this {
    return this.addInlineWorkflowHook('on_all_stages_scheduled', handler);
  }

  // ═══ Workflow-Level Hooks (Declarative Config) ═══

  hook(phase: WorkflowHookPhase | 'pre_clone' | 'post_clone' | 'pre_commit' | 'post_commit', config: HookDefinitionConfig): this {
    const hookId = generateId();
    const hookConfig = this.buildHookConfig(config);
    this._hooks.push({
      id: hookId,
      name: config.name ?? `${phase} hook`,
      phase,
      type: config.type,
      priority: config.priority ?? this._hooks.length,
      enabled: true,
      failurePolicy: config.failurePolicy ?? 'continue',
      timeoutMs: config.timeoutMs ?? 30000,
      retries: config.retries ?? 0,
      config: hookConfig,
    });
    return this;
  }

  // ═══ Orchestrator Configuration ═══

  preprocessingStep(step: PreprocessingStep): this {
    this._preprocessingSteps.push(step);
    return this;
  }

  resultValidation(stageId: string, rules: StageResultValidation['rules']): this {
    // Find stage index by localId
    const idx = this._stages.findIndex(s => s.localId === stageId);
    this._resultValidations.push({ stageIndex: idx >= 0 ? idx : 0, rules });
    return this;
  }

  requiresCodebase(requires: boolean): this {
    this._requiresCodebase = requires;
    return this;
  }

  useWorktree(use: boolean): this {
    this._useWorktree = use;
    return this;
  }

  // ═══ Build ═══

  build(): WorkflowScriptOutput {
    // Validate
    if (!this._name) {
      throw new Error('Workflow must have a name (call .name())');
    }
    if (this._stages.length === 0) {
      throw new Error('Workflow must have at least one stage');
    }

    // Validate edges reference existing stages
    const stageIds = new Set(this._stages.map(s => s.localId));
    for (const edge of this._edges) {
      if (!stageIds.has(edge.from)) {
        throw new Error(`Edge references unknown source stage: '${edge.from}'`);
      }
      if (!stageIds.has(edge.to)) {
        throw new Error(`Edge references unknown target stage: '${edge.to}'`);
      }
      if (edge.from === edge.to) {
        throw new Error(`Self-referencing edge not allowed: '${edge.from}'`);
      }
    }

    // Detect cycles using topological sort
    this.detectCycles();

    // Build stages
    const stages = this._stages.map((s, idx) => s.builder._build(s.localId, idx));

    // Collect all inline hooks from stages + workflow level
    const allInlineHooks = new Map<string, WorkflowHookHandler | StageHookHandler>();

    // Add workflow-level inline hooks
    for (const [hookId, handler] of this._inlineHooks) {
      allInlineHooks.set(hookId, handler);
    }

    // Add stage-level inline hooks
    for (const stage of stages) {
      if (stage.inlineHooks) {
        for (const [hookId, handler] of stage.inlineHooks) {
          allInlineHooks.set(hookId, handler);
        }
      }
    }

    // Build harness config
    const harnessConfig = this.buildHarnessConfig();

    // Build orchestrator config
    const orchestratorConfig = this.buildOrchestratorConfig();

    return {
      id: this._id,
      definition: {
        name: this._name,
        description: this._description,
        sessionMode: this._sessionMode,
        harnessConfig: Object.keys(harnessConfig).length > 0 ? harnessConfig : undefined,
        variables: this._variables,
        tags: this._tags,
        orchestratorConfig: Object.keys(orchestratorConfig).length > 0 ? orchestratorConfig : undefined,
        hooks: this._hooks.length > 0 ? this._hooks : undefined,
        useWorktree: this._useWorktree,
      },
      stages,
      edges: this._edges,
      inlineHooks: allInlineHooks.size > 0 ? allInlineHooks : undefined,
    };
  }

  // ─── Private Helpers ───

  private addInlineWorkflowHook(phase: WorkflowHookPhase, handler: WorkflowHookHandler): this {
    const hookId = `wf_${phase}_${generateId().slice(0, 8)}`;
    this._inlineHooks.set(hookId, handler);
    this._hooks.push({
      id: hookId,
      name: `${phase} (inline)`,
      phase,
      type: 'function',
      priority: this._hooks.length,
      enabled: true,
      failurePolicy: 'continue',
      timeoutMs: 30000,
      retries: 0,
      config: { type: 'function', handlerName: '' }, // Placeholder — filled during materialize
    });
    return this;
  }

  private buildHookConfig(config: HookDefinitionConfig): HookConfig {
    switch (config.type) {
      case 'script':
        return {
          type: 'script',
          command: config.command ?? '',
          args: config.args,
          cwd: config.cwd,
          env: config.env,
        };
      case 'http':
        return {
          type: 'http',
          url: config.url ?? '',
          method: config.method ?? 'POST',
          headers: config.headers,
          bodyTemplate: config.bodyTemplate,
        };
      case 'function':
        return {
          type: 'function',
          modulePath: config.modulePath,
          handlerName: config.handlerName,
          args: config.handlerArgs,
        };
      default:
        throw new Error(`Unknown hook type: ${config.type}`);
    }
  }

  private buildHarnessConfig(): Partial<HarnessConfig> {
    const config: Partial<HarnessConfig> = { ...this._harnessConfig };
    if (this._model) {
      (config as Record<string, unknown>)['model'] = this._model;
    }
    if (this._systemPromptAppend) {
      (config as Record<string, unknown>)['systemMessage'] = {
        mode: 'append',
        content: this._systemPromptAppend,
      };
    }
    if (Object.keys(this._mcpServers).length > 0) {
      (config as Record<string, unknown>)['mcpServers'] = this._mcpServers;
    }
    if (this._availableTools) {
      (config as Record<string, unknown>)['availableTools'] = this._availableTools;
    }
    if (this._excludedTools) {
      (config as Record<string, unknown>)['excludedTools'] = this._excludedTools;
    }
    return config;
  }

  private buildOrchestratorConfig(): Partial<Record<string, unknown>> {
    const config: Record<string, unknown> = {};
    if (this._preprocessingSteps.length > 0) {
      config['preprocessingSteps'] = this._preprocessingSteps;
    }
    if (this._resultValidations.length > 0) {
      config['resultValidations'] = this._resultValidations;
    }
    if (this._requiresCodebase !== undefined) {
      config['requiresCodebase'] = this._requiresCodebase;
    }
    return config;
  }

  private detectCycles(): void {
    // Kahn's algorithm for cycle detection
    const adjacency = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    for (const s of this._stages) {
      adjacency.set(s.localId, []);
      inDegree.set(s.localId, 0);
    }

    for (const edge of this._edges) {
      adjacency.get(edge.from)!.push(edge.to);
      inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    }

    const queue: string[] = [];
    for (const [node, degree] of inDegree) {
      if (degree === 0) queue.push(node);
    }

    let visited = 0;
    while (queue.length > 0) {
      const node = queue.shift()!;
      visited++;
      for (const neighbor of adjacency.get(node) ?? []) {
        const newDegree = (inDegree.get(neighbor) ?? 0) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) queue.push(neighbor);
      }
    }

    if (visited !== this._stages.length) {
      throw new Error('Workflow DAG contains a cycle. Check edge definitions for circular dependencies.');
    }
  }
}
