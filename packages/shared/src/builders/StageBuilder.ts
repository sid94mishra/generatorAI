// ────────────────────────────────────────────────────────────────
// StageBuilder — Fluent builder for individual stage configuration
// ────────────────────────────────────────────────────────────────

import { generateId } from '../utils/index.js';
import type {
  PromptDefinition,
  RetryPolicy,
  StageCondition,
  ContextFilter,
  StageSkillReference,
  IterationConfig,
} from '../types/StageDefinition.js';
import type { HarnessConfig } from '../types/Workflow.js';
import type { HookPhase, HookType, HookConfig } from '../types/HookDefinition.js';
import type {
  HookDefinitionConfig,
  StageHookHandler,
  StageOutput,
} from './types.js';

export class StageBuilder {
  private _name = '';
  private _description?: string;
  private _prompts: PromptDefinition[] = [];
  private _agentRef?: string;
  private _timeoutMs?: number;
  private _retryPolicy?: RetryPolicy;
  private _condition?: StageCondition;
  private _contextFilter?: ContextFilter;
  private _contextSources?: string[];
  private _outputFormat?: 'text' | 'json';
  private _outputSchema?: Record<string, unknown>;
  private _variables?: Record<string, unknown>;
  private _harnessOverrides?: Partial<HarnessConfig>;
  private _iterationConfig?: IterationConfig;
  private _skills: StageSkillReference[] = [];
  private _approvalRequired?: boolean;
  private _hooks: Array<{
    id: string;
    name: string;
    phase: HookPhase;
    type: HookType;
    priority: number;
    enabled: boolean;
    failurePolicy: 'abort' | 'skip' | 'continue';
    timeoutMs: number;
    retries: number;
    config: HookConfig;
  }> = [];
  private _inlineHooks = new Map<string, StageHookHandler>();

  /** Set stage display name. */
  name(name: string): this {
    this._name = name;
    return this;
  }

  /** Set stage description. */
  description(description: string): this {
    this._description = description;
    return this;
  }

  /** Set a single inline prompt text. */
  prompt(text: string): this {
    this._prompts = [{
      label: this._name || 'Prompt',
      text,
      source: 'inline' as const,
      waitForCompletion: true,
    }];
    return this;
  }

  /** Load prompt from a file path. */
  promptFile(path: string): this {
    this._prompts = [{
      label: this._name || 'Prompt',
      text: '',
      source: 'file' as const,
      filePath: path,
      waitForCompletion: true,
    }];
    return this;
  }

  /** Set multiple prompts. */
  prompts(prompts: PromptDefinition[]): this {
    this._prompts = prompts;
    return this;
  }

  /**
   * Bind a FIRST-CLASS agent by its portable `scope:slug` ref (AGT-01). A ref
   * survives export/import because it does not depend on the row id, and it
   * brings the agent's skills, MCP servers and tool policy with it.
   */
  agentRef(ref: string): this {
    this._agentRef = ref;
    return this;
  }

  /** Set execution timeout in milliseconds. */
  timeout(ms: number): this {
    this._timeoutMs = ms;
    return this;
  }

  /** Set retry policy. */
  retryPolicy(policy: { maxRetries: number; backoffMs: number; backoffMultiplier?: number }): this {
    this._retryPolicy = {
      maxRetries: policy.maxRetries,
      backoffMs: policy.backoffMs,
      backoffMultiplier: policy.backoffMultiplier ?? 1,
    };
    return this;
  }

  /** Set incoming edge condition expression. */
  condition(expression: string): this {
    this._condition = { type: 'expression', expression };
    return this;
  }

  /** Set context filter mode for this stage. */
  contextFilter(filter: ContextFilter): this {
    this._contextFilter = filter;
    return this;
  }

  /** Explicitly declare which stages provide context to this one. */
  contextFrom(stageNames: string[]): this {
    this._contextSources = stageNames;
    return this;
  }

  /** Set expected output format. */
  outputFormat(format: 'text' | 'json'): this {
    this._outputFormat = format;
    return this;
  }

  /** Set JSON schema for expected output. */
  outputSchema(schema: Record<string, unknown>): this {
    this._outputSchema = schema;
    return this;
  }

  /** Set expected output description text. */
  expectedOutput(description: string): this {
    // Store as metadata in the first prompt
    if (this._prompts.length > 0) {
      this._prompts[0]!.text += `\n\nExpected output: ${description}`;
    }
    return this;
  }

  /** Set stage-scoped variables. */
  variables(vars: Record<string, unknown>): this {
    this._variables = vars;
    return this;
  }

  /** Add a hook (declarative config or inline handler). */
  hook(phase: HookPhase, config: HookDefinitionConfig | StageHookHandler): this {
    if (typeof config === 'function') {
      // Inline function hook
      const hookId = `stage_${phase}_${generateId().slice(0, 8)}`;
      this._inlineHooks.set(hookId, config);
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
    } else {
      // Declarative hook config
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
    }
    return this;
  }

  /** Per-stage harness/LLM configuration overrides. */
  harnessOverrides(config: Partial<HarnessConfig>): this {
    this._harnessOverrides = config;
    return this;
  }

  /** Configure iteration (sub-workflow loop) for this stage. */
  iterationConfig(config: IterationConfig): this {
    this._iterationConfig = config;
    return this;
  }

  /** Toggle the human review gate. When true, the workflow pauses after this
   *  stage completes and waits for approve/request-changes before advancing. */
  approvalRequired(required = true): this {
    this._approvalRequired = required;
    return this;
  }

  /** Add a skill reference to this stage. */
  skill(ref: StageSkillReference): this {
    this._skills.push(ref);
    return this;
  }

  /** Build the stage output. Called internally by WorkflowBuilder. */
  _build(localId: string, order: number): StageOutput {
    if (!this._name) {
      throw new Error(`Stage '${localId}' must have a name (call .name())`);
    }
    if (this._prompts.length === 0 && !this._agentRef) {
      throw new Error(`Stage '${localId}' must have at least one prompt or an agent`);
    }

    return {
      localId,
      config: {
        name: this._name,
        description: this._description,
        order,
        prompts: this._prompts,
        hooks: this._hooks.length > 0 ? this._hooks : undefined,
        variables: this._variables,
        harnessConfigOverrides: this._harnessOverrides,
        agentRef: this._agentRef,
        contextFilter: this._contextFilter,
        contextSources: this._contextSources,
        outputFormat: this._outputFormat,
        outputSchema: this._outputSchema,
        retryPolicy: this._retryPolicy,
        timeoutMs: this._timeoutMs,
        condition: this._condition,
        iterationConfig: this._iterationConfig,
        skills: this._skills.length > 0 ? this._skills : undefined,
        approvalRequired: this._approvalRequired,
      },
      inlineHooks: this._inlineHooks.size > 0 ? this._inlineHooks : undefined,
    };
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
}
