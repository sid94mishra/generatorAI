// ────────────────────────────────────────────────────────────────
// ConfigResolver — merges template defaults + session overrides
// v2: also supports 3-level merge for WorkflowDefinition → Stage
// ────────────────────────────────────────────────────────────────

import type { HookDefinition, HarnessConfig, WorkflowTemplate } from '@generatorai/shared';
import type { WorkflowDefinition, VariableDefinition } from '@generatorai/shared';
import type { StageDefinition } from '@generatorai/shared';
import { ValidationError, deepMerge, interpolateVariables } from '@generatorai/shared';
import type { TemplateRegistry } from './TemplateRegistry.js';

export interface ResolvedWorkflowConfig {
  template: WorkflowTemplate;
  prompts: Array<{
    label: string;
    text: string;
    waitForCompletion: boolean;
    attachments?: Array<{ path: string }>;
  }>;
  harnessConfig: HarnessConfig;
  hooks: HookDefinition[];
  variables: Record<string, unknown>;
}

export interface SessionWorkflowOverrides {
  variables?: Record<string, unknown>;
  hookOverrides?: Record<string, Partial<HookDefinition>>;
  harnessConfigOverrides?: Partial<HarnessConfig>;
}

/**
 * Resolved configuration for a single stage within a workflow run (v2).
 * Result of 3-level merge: WorkflowDefinition → StageDefinition → runtime overrides.
 */
export interface ResolvedStageConfig {
  harnessConfig: HarnessConfig;
  variables: Record<string, unknown>;
  hooks: HookDefinition[];
  prompts: StageDefinition['prompts'];
  timeoutMs?: number;
  retryPolicy?: StageDefinition['retryPolicy'];
}

export class ConfigResolver {
  constructor(public readonly templateRegistry: TemplateRegistry) {}

  /**
   * Resolve the final workflow configuration by merging template defaults
   * with session-level overrides.
   */
  resolve(templateId: string, overrides: SessionWorkflowOverrides): ResolvedWorkflowConfig {
    const template = this.templateRegistry.getWorkflowTemplate(templateId);
    if (!template) {
      throw new ValidationError(`Unknown template: ${templateId}`);
    }

    // 1. Resolve variables (template defaults → session overrides)
    const variables = {
      ...this.getDefaultVariables(template),
      ...(overrides.variables ?? {}),
    };

    // 2. Validate required variables
    for (const v of template.variables) {
      if (v.required && !(v.name in variables)) {
        throw new ValidationError(`Missing required variable: ${v.label ?? v.name}`);
      }
    }

    // 3. Collect and interpolate prompts from all stages (templates no longer have top-level prompts)
    const prompts = template.stages.flatMap((stage) =>
      stage.prompts.map((p) => ({
        label: p.label ?? stage.name,
        text: interpolateVariables(p.text, variables),
        waitForCompletion: p.waitForCompletion ?? true,
        attachments: p.attachments?.map((a) => ({ path: a })),
      })),
    );

    // 4. Merge Copilot config (template → overrides)
    const harnessConfig = deepMerge(
      (template.harnessConfig ?? {}) as Record<string, unknown>,
      overrides.harnessConfigOverrides ?? {},
    ) as unknown as HarnessConfig;

    // 5. Merge hooks (override by hookId)
    const hooks = template.hooks.map((h) => {
      const override = overrides.hookOverrides?.[h.id];
      return override ? ({ ...h, ...override } as HookDefinition) : h;
    });

    return { template, prompts, harnessConfig: harnessConfig, hooks, variables };
  }

  /**
   * Resolve configuration for a workflow stage using 3-level merge:
   *   1. WorkflowDefinition harnessConfig (base)
   *   2. StageDefinition harnessConfigOverrides (stage overrides)
   *   3. Runtime variable overrides (runtime overrides)
   *
   * This replaces template-based resolution for the v2 DAG workflow system.
   */
  resolveStageConfig(
    definition: WorkflowDefinition,
    stage: StageDefinition,
    runtimeOverrides?: { variables?: Record<string, unknown>; harnessConfigOverrides?: Partial<HarnessConfig> },
  ): ResolvedStageConfig {
    // 1. Base variables from definition VariableDefinition defaults
    const defVariableDefaults = this.getVariableDefinitionDefaults(definition.variables);

    // 2. Merge: definition defaults → stage variables → runtime overrides
    const variables: Record<string, unknown> = {
      ...defVariableDefaults,
      ...(stage.variables ?? {}),
      ...(runtimeOverrides?.variables ?? {}),
    };

    // 3. Validate required variables
    for (const v of definition.variables) {
      if (v.required && !(v.name in variables)) {
        throw new ValidationError(`Missing required variable: ${v.label ?? v.name}`);
      }
    }

    // 4. Three-level Copilot config merge: definition → stage → runtime
    let harnessConfig = (definition.harnessConfig ?? {}) as HarnessConfig;
    if (stage.harnessConfigOverrides) {
      harnessConfig = deepMerge(
        harnessConfig as unknown as Record<string, unknown>,
        stage.harnessConfigOverrides as unknown as Record<string, unknown>,
      ) as unknown as HarnessConfig;
    }
    if (runtimeOverrides?.harnessConfigOverrides) {
      harnessConfig = deepMerge(
        harnessConfig as unknown as Record<string, unknown>,
        runtimeOverrides.harnessConfigOverrides as unknown as Record<string, unknown>,
      ) as unknown as HarnessConfig;
    }

    // 5. Merge hooks (stage hooks override definition-level hooks by ID)
    const hooks = stage.hooks;

    // 6. Interpolate variables into stage prompts
    const prompts = stage.prompts.map((p) => ({
      ...p,
      text: interpolateVariables(p.text, variables),
    }));

    return {
      harnessConfig: harnessConfig,
      variables,
      hooks,
      prompts,
      timeoutMs: stage.timeoutMs,
      retryPolicy: stage.retryPolicy,
    };
  }

  /**
   * Resolve global hooks (not tied to any specific template).
   * These are hooks that trigger on Copilot CLI client lifecycle events.
   * Gathered from all templates that define client-level hooks.
   */
  resolveGlobalHooks(): HookDefinition[] {
    const globalPhases = new Set([
      'on_client_start',
      'on_client_stop',
      'on_client_error',
      'on_client_restart',
    ]);

    const hooks: HookDefinition[] = [];
    for (const template of this.templateRegistry.getAllWorkflowTemplates()) {
      for (const hook of template.hooks) {
        if (globalPhases.has(hook.phase) && hook.enabled) {
          hooks.push(hook);
        }
      }
    }

    // Deduplicate by hook ID (first wins)
    const seen = new Set<string>();
    return hooks.filter((h) => {
      if (seen.has(h.id)) return false;
      seen.add(h.id);
      return true;
    });
  }

  // interpolate() removed — now using shared interpolateVariables() from @generatorai/shared

  private getDefaultVariables(template: WorkflowTemplate): Record<string, unknown> {
    const defaults: Record<string, unknown> = {};
    for (const v of template.variables) {
      if (v.defaultValue !== undefined) defaults[v.name] = v.defaultValue;
    }
    return defaults;
  }

  private getVariableDefinitionDefaults(variables: VariableDefinition[]): Record<string, unknown> {
    const defaults: Record<string, unknown> = {};
    for (const v of variables) {
      if (v.defaultValue !== undefined) {
        defaults[v.name] = this.coerceDefault(v.type, v.defaultValue);
      }
    }
    return defaults;
  }

  /** Coerce a stored defaultValue to match the variable's declared type. */
  private coerceDefault(type: VariableDefinition['type'], value: unknown): unknown {
    if (value === undefined || value === null) return value;
    switch (type) {
      case 'number': {
        const n = Number(value);
        return isNaN(n) ? value : n;
      }
      case 'boolean':
        return value === true || value === 'true' || value === '1';
      default:
        return value;
    }
  }
}
