// ────────────────────────────────────────────────────────────────
// Template System — Unified schemas for Workflow Templates,
// Stage Templates
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { REASONING_EFFORTS } from '../types/ProviderConfig.js';

// ── Hook Definition (shared across templates) ──────────────────

export const HookDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  phase: z.enum([
    'pre_run',
    'post_run',
    'pre_clone',
    'post_clone',
    'pre_prompt',
    'post_prompt',
    'pre_commit',
    'post_commit',
    'on_error',
    'on_cancel',
    'pre_tool_use',
    'post_tool_use',
    'on_message',
    'on_reasoning',
    'on_session_start',
    'on_session_idle',
    'on_session_error',
    // W13 / Finding-7 named this phase in the `HookPhase` TYPE and documented
    // that authors must opt into it separately from `on_session_error` — but
    // it was never added to this enum, so any hook declaring it was rejected
    // at the route boundary and could not be persisted at all. The type and
    // the validator must list the same phases or one of them is a lie.
    'on_session_cancelled',
    'on_client_start',
    'on_client_stop',
    'on_client_error',
    'on_client_restart',
    'on_permission',
    // Workflow-level phases (included for union compat)
    'on_run_start',
    'on_run_complete',
    'on_run_failed',
    'on_run_cancelled',
    'on_pr_created',
    'on_preprocessing_complete',
    'on_postprocessing_start',
    'on_all_stages_scheduled',
    'on_stage_completed',
    'on_stage_failed',
    'on_parallel_join',
  ]),
  type: z.enum(['script', 'http', 'function']),
  priority: z.number().default(0),
  enabled: z.boolean().default(true),
  failurePolicy: z.enum(['abort', 'skip', 'continue']).default('skip'),
  timeoutMs: z.number().default(30_000),
  retries: z.number().default(0),
  config: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('script'),
      command: z.string(),
      args: z.array(z.string()).optional(),
      cwd: z.string().optional(),
      env: z.record(z.string()).optional(),
    }),
    z.object({
      type: z.literal('http'),
      url: z.string().url(),
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
      headers: z.record(z.string()).optional(),
      bodyTemplate: z.string().optional(),
    }),
    z.object({
      type: z.literal('function'),
      modulePath: z.string().optional(),
      handlerName: z.string().optional(),
      args: z.record(z.unknown()).optional(),
    }),
  ]),
});

// ── Workflow-Level Hook Definition ─────────────────────────────

export const WorkflowHookDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  phase: z.enum([
    // Run lifecycle
    'on_run_start', 'on_run_complete', 'on_run_failed', 'on_run_cancelled',
    // Git / SCM (reuse)
    'pre_clone', 'post_clone', 'pre_commit', 'post_commit', 'on_pr_created',
    // Orchestration
    'on_preprocessing_complete', 'on_postprocessing_start', 'on_all_stages_scheduled',
    // Cross-stage coordination
    'on_stage_completed', 'on_stage_failed', 'on_parallel_join',
  ]),
  type: z.enum(['script', 'http', 'function']),
  priority: z.number().default(0),
  enabled: z.boolean().default(true),
  failurePolicy: z.enum(['abort', 'skip', 'continue']).default('skip'),
  timeoutMs: z.number().default(30_000),
  retries: z.number().default(0),
  config: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('script'),
      command: z.string(),
      args: z.array(z.string()).optional(),
      cwd: z.string().optional(),
      env: z.record(z.string()).optional(),
    }),
    z.object({
      type: z.literal('http'),
      url: z.string().url(),
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
      headers: z.record(z.string()).optional(),
      bodyTemplate: z.string().optional(),
    }),
    z.object({
      type: z.literal('function'),
      modulePath: z.string().optional(),
      handlerName: z.string().optional(),
      args: z.record(z.unknown()).optional(),
    }),
  ]),
});

// ── Hooks File Config Schema ───────────────────────────────────

export const HooksFileConfigSchema = z.object({
  version: z.literal(1),
  workflow: z.array(WorkflowHookDefinitionSchema).default([]),
  stages: z.record(z.array(HookDefinitionSchema)).default({}),
});

// ── Template Category ──────────────────────────────────────────

export const TemplateCategorySchema = z.enum([
  'code-generation',
  'code-review',
  'testing',
  'e2e-testing',
  'refactoring',
  'documentation',
  'deployment',
  'custom',
  'system',
]);

// ── Harness Config (shared LLM/agent configuration) ────────────

export const TemplateHarnessConfigSchema = z.object({
  model: z.string().default('claude-sonnet-4.6'),
  systemMessage: z
    .object({
      mode: z.enum(['append', 'replace']).default('append'),
      content: z.string(),
    })
    .optional(),
  systemPromptAppend: z.string().optional(),
  streaming: z.boolean().default(true),
  mcpServers: z
    .record(
      z.object({
        type: z.enum(['http', 'stdio']),
        url: z.string().optional(),
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
      }),
    )
    .default({}),
  availableTools: z.array(z.string()).default([]),
  excludedTools: z.array(z.string()).default([]),
  skillDirectories: z.array(z.string()).default([]),
  disabledSkills: z.array(z.string()).default([]),
  customAgents: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
        instructions: z.string(),
        tools: z.array(z.string()).optional(),
      }),
    )
    .default([]),
  provider: z
    .object({
      name: z.string(),
      baseUrl: z.string().url(),
      apiKey: z.string(),
      model: z.string().optional(),
    })
    .optional(),
  configDir: z.string().optional(),
  reasoningEffort: z.enum(REASONING_EFFORTS).optional(),
  maxTurns: z.number().int().min(1).optional(),
}).default({});

// ── Configurable Variable ──────────────────────────────────────

export const ConfigurableVariableSchema = z.object({
  name: z.string().min(1).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'Variable name must be a valid identifier'),
  type: z.enum(['string', 'number', 'boolean', 'choice', 'text', 'git_url', 'git_urls']),
  label: z.string().min(1),
  description: z.string().optional(),
  required: z.boolean().default(false),
  defaultValue: z.unknown().optional(),
  options: z.array(z.string()).optional(),
});

// ── Preprocessing Step ─────────────────────────────────────────

export const PreprocessingStepSchema = z.object({
  type: z.enum(['clone_repo', 'run_script', 'validate_input', 'set_variable', 'conditional']),
  name: z.string(),
  config: z.record(z.unknown()).default({}),
  failOnError: z.boolean().default(false),
  order: z.number().int().min(0).default(0),
});

// ── Result Validation Rule ─────────────────────────────────────

export const ResultValidationSchema = z.object({
  stageIndex: z.number().int().min(0),
  rules: z.array(z.object({
    type: z.enum(['min_length', 'max_length', 'contains', 'not_contains', 'regex']),
    value: z.union([z.string(), z.number()]),
    message: z.string(),
  })),
});

// ── Stage Template Prompt ──────────────────────────────────────

export const StageTemplatePromptSchema = z.object({
  label: z.string().min(1),
  text: z.string().min(1),
  waitForCompletion: z.boolean().default(true),
});

// ── Stage Template (reusable per-stage blueprint) ──────────────

export const StageTemplateSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  description: z.string().default(''),
  category: TemplateCategorySchema.default('custom'),
  version: z.string().default('1.0.0'),
  tags: z.array(z.string()).default([]),
  /** Prompt templates with {{variable}} placeholders */
  prompts: z.array(StageTemplatePromptSchema).min(1),
  /** Per-stage harness config overrides */
  harnessConfigOverrides: TemplateHarnessConfigSchema.optional(),
  /** Variables this stage expects */
  variables: z.array(ConfigurableVariableSchema).default([]),
  /** Hooks for this stage */
  hooks: z.array(HookDefinitionSchema).default([]),
  /** Retry policy */
  retryPolicy: z.object({
    maxRetries: z.number().int().min(0).max(10).default(0),
    backoffMs: z.number().int().min(100).default(1000),
    backoffMultiplier: z.number().min(1).default(2),
  }).optional(),
  /** Timeout in ms */
  timeoutMs: z.number().int().min(1000).optional(),
  /** Whether this stage is locked (non-editable when used in a workflow) */
  isLocked: z.boolean().default(false),
});

export type StageTemplate = z.infer<typeof StageTemplateSchema>;

// ── Workflow Template Stage ────────────────────────────────────

export const WorkflowTemplateStageSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  order: z.number().int().min(0),
  /** Either inline prompts OR a reference to a stage template */
  stageTemplateId: z.string().optional(),
  prompts: z.array(StageTemplatePromptSchema).default([]),
  harnessConfigOverrides: TemplateHarnessConfigSchema.optional(),
  hooks: z.array(HookDefinitionSchema).default([]),
  retryPolicy: z.object({
    maxRetries: z.number().int().min(0).max(10).default(0),
    backoffMs: z.number().int().min(100).default(1000),
    backoffMultiplier: z.number().min(1).default(2),
  }).optional(),
  timeoutMs: z.number().int().min(1000).optional(),
  condition: z.object({
    type: z.enum(['always', 'on_success', 'on_failure', 'expression']),
    expression: z.string().optional(),
  }).optional(),
  /**
   * Execution settings carried through export/import.
   *
   * These are all optional and were previously absent, which meant
   * `GET /workflow-definitions/:id/export` produced JSON that dropped every
   * stage's run condition, context filter, validation rules and approval
   * gate — `import-json` has always read them, only the exporter never wrote
   * them, so a round-trip silently returned a different workflow.
   */
  contextFilter: z.enum(['full', 'summary-only', 'none', 'structured']).optional(),
  contextSources: z.array(z.string().min(1).max(200)).max(50).optional(),
  outputFormat: z.enum(['text', 'json']).optional(),
  resultValidation: z
    .array(
      z.object({
        type: z.enum([
          'contains',
          'not_contains',
          'min_length',
          'max_length',
          'regex',
          'custom_script',
          'json_schema',
          'llm_validation',
        ]),
        value: z.union([z.string(), z.number(), z.record(z.unknown())]).optional(),
        message: z.string(),
      }),
    )
    .max(20)
    .optional(),
  expectedOutput: z.string().max(5000).optional(),
  outputSchema: z.record(z.unknown()).optional(),
  approvalRequired: z.boolean().optional(),
  agentRef: z.string().max(128).optional(),

  /** Whether the user can modify this stage's prompts */
  isLocked: z.boolean().default(false),
});

// ── Workflow Template Edge ─────────────────────────────────────

export const WorkflowTemplateEdgeSchema = z.object({
  fromStageIndex: z.number().int().min(0),
  toStageIndex: z.number().int().min(0),
  edgeType: z.enum(['on_success', 'on_failure', 'on_completion', 'always']).default('on_success'),
});

// ── Workflow Template (full DAG blueprint) ─────────────────────

export const WorkflowTemplateSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  description: z.string().default(''),
  category: TemplateCategorySchema.default('custom'),
  version: z.string().default('1.0.0'),
  tags: z.array(z.string()).default([]),
  icon: z.string().optional(),

  /** Whether the workflow requires a codebase */
  requiresCodebase: z.boolean().default(false),
  /** Whether multiple codebases are supported */
  supportsMultipleCodebases: z.boolean().default(false),

  /** Session mode for harness sessions */
  sessionMode: z.enum(['single', 'per-stage', 'auto']).default('auto'),

  /** Workflow-level agent harness configuration */
  harnessConfig: TemplateHarnessConfigSchema.optional(),

  /** DAG stages */
  stages: z.array(WorkflowTemplateStageSchema).min(1),
  /** DAG edges (using stage array indices) */
  edges: z.array(WorkflowTemplateEdgeSchema).default([]),

  /** Preprocessing steps (run before DAG execution) */
  preprocessingSteps: z.array(PreprocessingStepSchema).default([]),

  /** Variables users fill in when creating from this template */
  variables: z.array(ConfigurableVariableSchema).default([]),

  /** Hooks at the workflow level */
  hooks: z.array(HookDefinitionSchema).default([]),

  /** Result validations (post-stage output checks) */
  resultValidations: z.array(ResultValidationSchema).default([]),
});

export type WorkflowTemplate = z.infer<typeof WorkflowTemplateSchema>;



// ── Template stage → CreateStageParams ─────────────────────────

export type WorkflowTemplateStage = z.infer<typeof WorkflowTemplateStageSchema>;

/**
 * Map one template stage onto the params `addStage` takes.
 *
 * Both entry points that materialise a template into a real workflow —
 * `WorkflowDefinitionService.importFromJSON` (import JSON / round-trip an
 * export) and `WorkflowDefinitionService.importFromTemplate` (Settings →
 * Templates → Use) — must use this. They previously each hand-wrote the
 * mapping and had drifted apart, silently discarding retry policies,
 * timeouts, conditions, validation rules, approval gates, hooks and model
 * overrides the template declared.
 */
export function templateStageToCreateParams(
  stage: WorkflowTemplateStage,
  workflowDefinitionId: string,
  order?: number,
): Record<string, unknown> {
  return {
    workflowDefinitionId,
    name: stage.name,
    description: stage.description,
    templateId: (stage as { templateId?: string }).templateId,
    order: order ?? stage.order,
    prompts: stage.prompts,
    harnessConfigOverrides: stage.harnessConfigOverrides,
    hooks: stage.hooks,
    retryPolicy: stage.retryPolicy ?? undefined,
    timeoutMs: stage.timeoutMs ?? undefined,
    condition: stage.condition ?? undefined,
    contextFilter: stage.contextFilter ?? undefined,
    contextSources: stage.contextSources ?? undefined,
    outputFormat: stage.outputFormat ?? undefined,
    agentRef: stage.agentRef ?? undefined,
    resultValidation: stage.resultValidation ?? undefined,
    expectedOutput: stage.expectedOutput ?? undefined,
    outputSchema: stage.outputSchema ?? undefined,
    iterationConfig: (stage as { iterationConfig?: unknown }).iterationConfig ?? undefined,
    approvalRequired: stage.approvalRequired ?? false,
  };
}
