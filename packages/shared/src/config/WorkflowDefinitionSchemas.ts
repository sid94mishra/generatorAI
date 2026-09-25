// ────────────────────────────────────────────────────────────────
// WorkflowDefinition Zod validation schemas
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { HARNESS_PROVIDER_IDS, REASONING_EFFORTS } from '../types/ProviderConfig.js';
import { HookDefinitionSchema, WorkflowHookDefinitionSchema, HooksFileConfigSchema } from './WorkflowTemplate.js';
import { BrowserConfigSchema } from './BrowserConfigSchema.js';
import { McpServerConfigSchema, AgentOverridesSchema } from './AgentSchemas.js';
import { AgentModeSchema } from './ChatSchemas.js';

/** Zod schema for PromptDefinition */
export const PromptDefinitionSchema = z.object({
  label: z.string().min(1),
  text: z.string().min(1),
});

/** Zod schema for Skill reference (independent of prompts) */
export const SkillDefinitionSchema = z.object({
  name: z.string().min(1),
  directory: z.string().optional(),
  description: z.string().optional(),
});

/** Zod schema for RetryPolicy */
export const RetryPolicySchema = z.object({
  maxRetries: z.number().int().min(0).max(10).default(0),
  backoffMs: z.number().int().min(100).default(1000),
  backoffMultiplier: z.number().min(1).default(2),
});

/** Zod schema for StageCondition */
export const StageConditionSchema = z.object({
  type: z.enum(['always', 'on_success', 'on_failure', 'expression']),
  expression: z.string().optional(),
});

/** Zod schema for VariableDefinition */
export const VariableDefinitionSchema = z.object({
  name: z.string().min(1).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'Variable name must be a valid identifier'),
  type: z.enum(['string', 'number', 'boolean', 'choice', 'text']),
  label: z.string().min(1),
  description: z.string().optional(),
  required: z.boolean().default(false),
  defaultValue: z.unknown().optional(),
  options: z.array(z.string()).optional(),
});

/** Agent harness config schema — provider-agnostic (supports copilot, claude-agent, etc.) */
const HarnessConfigSchema = z.object({
  model: z.string().optional(),
  /**
   * Agent provider that should run this stage / workflow. Omit to route by
   * `model` (the provider whose live catalog owns it), falling back to the
   * server's primary provider. Lets stage 1 run on Claude and stage 2 on
   * Copilot within the same run.
   */
  harnessType: z.enum(HARNESS_PROVIDER_IDS).optional(),
  systemMessage: z.object({
    mode: z.enum(['append', 'replace']).default('append'),
    content: z.string(),
  }).optional(),
  systemPromptAppend: z.string().optional(),
  streaming: z.boolean().optional(),
  mcpServers: z.record(McpServerConfigSchema).optional(),
  availableTools: z.array(z.string()).optional(),
  excludedTools: z.array(z.string()).optional(),
  excludedMcpServerIds: z.array(z.string()).optional(),
  skillDirectories: z.array(z.string()).optional(),
  disabledSkills: z.array(z.string()).optional(),
  customAgents: z.array(z.object({
    name: z.string(),
    description: z.string(),
    instructions: z.string(),
    tools: z.array(z.string()).optional(),
  })).optional(),
  provider: z.object({
    name: z.string(),
    baseUrl: z.string().url(),
    apiKey: z.string(),
    model: z.string().optional(),
  }).optional(),
  configDir: z.string().optional(),
  reasoningEffort: z.enum(REASONING_EFFORTS).optional(),
  contextTier: z.enum(['default', 'long_context']).optional(),
  maxTurns: z.number().int().min(1).optional(),
  permissionMode: z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk']).optional(),
  planModeInstructions: z.string().max(20_000).optional(),
  /** Portable `scope:slug` ref of the agent driving this scope. */
  agentRef: z.string().max(128).optional(),
  /** Additive capability delta layered on top of the bound agent. */
  agentOverrides: AgentOverridesSchema.optional(),
}).partial();

/** Zod schema for PreprocessingStep */
const PreprocessingStepSchema = z.object({
  type: z.enum(['run_script', 'validate_input', 'set_variable', 'conditional']),
  name: z.string().min(1),
  config: z.record(z.unknown()),
  failOnError: z.boolean().default(true),
  order: z.number().int().min(0).default(0),
});

/** Zod schema for a post-processing step's config — discriminated on `type` */
const PostProcessingStepConfigSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('commit_and_push'),
    repoAlias: z.string().optional(),
    commitMessage: z.string().min(1),
    push: z.boolean().optional(),
    generateMessage: z.boolean().optional(),
    baseBranch: z.string().optional(),
  }),
  z.object({
    type: z.literal('create_pr'),
    repoAlias: z.string().optional(),
    title: z.string().min(1),
    body: z.string(),
    baseBranch: z.string().optional(),
    generateText: z.boolean().optional(),
    draft: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('run_script'),
    script: z.string().min(1),
    cwd: z.string().optional(),
    timeoutMs: z.number().int().positive().optional(),
  }),
]);

/** Zod schema for a post-processing step. `type` must match `config.type`. */
const PostProcessingStepSchema = z
  .object({
    type: z.enum(['commit_and_push', 'create_pr', 'run_script']),
    name: z.string().min(1),
    config: PostProcessingStepConfigSchema,
    failOnError: z.boolean().default(true),
    order: z.number().int().min(0).default(0),
  })
  .refine((step) => step.type === step.config.type, {
    message: 'type must match config.type',
    path: ['config', 'type'],
  });

/** Zod schema for a single ResultValidationRule */
const ResultValidationRuleSchema = z.object({
  type: z.enum(['contains', 'not_contains', 'min_length', 'max_length', 'regex', 'custom_script', 'json_schema', 'llm_validation']),
  value: z.union([z.string(), z.number(), z.record(z.unknown())]).optional(),
  message: z.string(),
});

/** Zod schema for StageResultValidation */
const StageResultValidationSchema = z.object({
  stageIndex: z.number().int().min(0),
  rules: z.array(ResultValidationRuleSchema),
});

/** Zod schema for OrchestratorConfig — uses project/codebase model (no direct git repo cloning) */
const OrchestratorConfigSchema = z.object({
  category: z.enum(['system', 'custom', 'derived']).default('custom'),
  parentTemplateId: z.string().optional(),
  /** Codebase aliases from the linked project to use for this workflow */
  codebaseAliases: z.array(z.string().min(1).max(50)).max(5).default([]),
  preprocessingSteps: z.array(PreprocessingStepSchema).default([]),
  resultValidations: z.array(StageResultValidationSchema).default([]),
  requiresCodebase: z.boolean().default(false),
  autoCommit: z.boolean().optional(),
  /** Push the run's work branch after committing (implied by autoCreatePR). */
  autoPush: z.boolean().optional(),
  autoCreatePR: z.boolean().optional(),
  /** Every declared step runs; `config.type` names what it does. */
  postProcessingSteps: z.array(PostProcessingStepSchema).default([]),
});

/** Zod schema for creating a WorkflowDefinition */
export const CreateWorkflowDefinitionSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  sessionMode: z.enum(['single', 'per-stage', 'auto']).default('auto'),
  harnessConfig: HarnessConfigSchema.optional(),
  variables: z.array(VariableDefinitionSchema).max(50).default([]),
  tags: z.array(z.string().max(50)).max(20).default([]),
  orchestratorConfig: OrchestratorConfigSchema.optional(),
  /** Project ID — scopes this workflow to a project and its codebases */
  projectId: z.string().uuid().optional(),
  /** Workflow-level lifecycle hooks */
  hooks: z.array(WorkflowHookDefinitionSchema).max(50).optional(),
  /** Imported hooks file config (.hooks.json) */
  hooksFile: HooksFileConfigSchema.optional(),
  /** Whether to create worktrees for project codebases during execution */
  useWorktree: z.boolean().optional(),
  /** Integrated Browser configuration (workflow-level default). */
  browserConfig: BrowserConfigSchema.optional(),
});

/** Zod schema for updating a WorkflowDefinition */
export const UpdateWorkflowDefinitionSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  sessionMode: z.enum(['single', 'per-stage', 'auto']).optional(),
  harnessConfig: HarnessConfigSchema.optional(),
  variables: z.array(VariableDefinitionSchema).max(50).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  orchestratorConfig: OrchestratorConfigSchema.optional(),
  projectId: z.string().uuid().optional().nullable(),
  /** Workflow-level lifecycle hooks */
  hooks: z.array(WorkflowHookDefinitionSchema).max(50).optional(),
  /** Imported hooks file config (.hooks.json) */
  hooksFile: HooksFileConfigSchema.optional(),
  /** Whether to create worktrees for project codebases during execution */
  useWorktree: z.boolean().optional(),
  /** Integrated Browser configuration (workflow-level default). */
  browserConfig: BrowserConfigSchema.optional(),
});

/** Zod schema for creating a StageDefinition */
export const CreateStageSchema = z.object({
  workflowDefinitionId: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  /** When omitted, the service auto-appends (`max existing order + 1`). */
  order: z.number().int().min(0).optional(),
  prompts: z.array(PromptDefinitionSchema).default([]),
  harnessConfigOverrides: HarnessConfigSchema.optional(),
  hooks: z.array(HookDefinitionSchema).default([]),
  retryPolicy: RetryPolicySchema.optional(),
  timeoutMs: z.number().int().min(1000).optional(),
  condition: StageConditionSchema.optional(),
  contextFilter: z.enum(['full', 'summary-only', 'none', 'structured']).optional(),
  /** Explicit list of stage names to pull context from (overrides DAG predecessors) */
  contextSources: z.array(z.string().min(1).max(200)).max(50).optional(),
  /** Output format: 'text' for summary, 'json' for schema-validated JSON */
  outputFormat: z.enum(['text', 'json']).optional(),
  /** Skills specifically for this stage */
  skills: z.array(SkillDefinitionSchema).max(10).optional(),
  /** Per-stage result validation rules */
  resultValidation: z.array(ResultValidationRuleSchema).max(20).optional(),
  /** Expected output description appended to the stage prompt */
  expectedOutput: z.string().max(5000).optional(),
  /** JSON Schema describing the expected structured output */
  outputSchema: z.record(z.unknown()).optional(),
  /** When true, pause the stage in `awaiting_input` after completion for human review before advancing the DAG. Default false. */
  approvalRequired: z.boolean().optional(),
  /** Per-stage agent mode ('auto' | 'plan'). */
  agentMode: AgentModeSchema.optional(),
  /** Integrated Browser overrides for this stage (deep-merged with workflow-level). */
  browserConfig: BrowserConfigSchema.optional(),
  /** Portable `scope:slug` ref of the agent driving this stage. */
  agentRef: z.string().max(128).optional().nullable(),
});

/** Zod schema for creating a StageEdge */
export const CreateEdgeSchema = z.object({
  workflowDefinitionId: z.string().uuid(),
  fromStageId: z.string().uuid(),
  toStageId: z.string().uuid(),
  edgeType: z.enum(['on_success', 'on_failure', 'on_completion', 'always']).default('on_success'),
});

/** Zod schema for creating a WorkflowRun */
export const CreateWorkflowRunSchema = z.object({
  workflowDefinitionId: z.string().uuid(),
  variables: z.record(z.unknown()).default({}),
  projectId: z.string().uuid().optional(),
});

/** Full WorkflowDefinition validation schema (for import/export) */
export const WorkflowDefinitionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  version: z.number().int().min(1),
  sessionMode: z.enum(['single', 'per-stage', 'auto']),
  harnessConfig: HarnessConfigSchema.optional(),
  variables: z.array(VariableDefinitionSchema),
  tags: z.array(z.string()),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

/** Inline stage definition for JSON upload (no workflowDefinitionId needed) */
const ImportStageSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  order: z.number().int().min(0),
  prompts: z.array(PromptDefinitionSchema).default([]),
  harnessConfigOverrides: HarnessConfigSchema.optional(),
  hooks: z.array(HookDefinitionSchema).default([]),
  retryPolicy: RetryPolicySchema.optional(),
  timeoutMs: z.number().int().min(1000).optional(),
  condition: StageConditionSchema.optional(),
  contextFilter: z.enum(['full', 'summary-only', 'none', 'structured']).optional(),
  /** Explicit list of stage names to pull context from (overrides DAG predecessors) */
  contextSources: z.array(z.string().min(1).max(200)).max(50).optional(),
  /** Output format: 'text' for summary, 'json' for schema-validated JSON */
  outputFormat: z.enum(['text', 'json']).optional(),
  skills: z.array(SkillDefinitionSchema).max(10).optional(),
  /** Per-stage result validation rules */
  resultValidation: z.array(ResultValidationRuleSchema).max(20).optional(),
  /** Expected output description appended to the stage prompt */
  expectedOutput: z.string().max(5000).optional(),
  /** JSON Schema describing the expected structured output */
  outputSchema: z.record(z.unknown()).optional(),
  /** When true, pause after completion for human review before advancing. */
  approvalRequired: z.boolean().optional(),
  /** Per-stage agent mode ('auto' | 'plan'). */
  agentMode: AgentModeSchema.optional(),
  /** Integrated Browser overrides for this stage (deep-merged with workflow-level). */
  browserConfig: BrowserConfigSchema.optional(),
  /** Portable `scope:slug` ref of the agent driving this stage. */
  agentRef: z.string().max(128).optional(),
});

/** Edge definition using stage array indices instead of UUIDs */
const ImportEdgeSchema = z.object({
  fromStageIndex: z.number().int().min(0),
  toStageIndex: z.number().int().min(0),
  edgeType: z.enum(['on_success', 'on_failure', 'on_completion', 'always']).default('on_success'),
});

/** Zod schema for importing a full workflow from a JSON file upload */
export const ImportWorkflowJsonSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  sessionMode: z.enum(['single', 'per-stage', 'auto']).default('auto'),
  harnessConfig: HarnessConfigSchema.optional(),
  variables: z.array(VariableDefinitionSchema).max(50).default([]),
  tags: z.array(z.string().max(50)).max(20).default([]),
  stages: z.array(ImportStageSchema).min(1, 'At least one stage is required').max(100),
  edges: z.array(ImportEdgeSchema).max(500).default([]),
  /** Orchestrator configuration */
  orchestratorConfig: OrchestratorConfigSchema.optional(),
  /** Project ID to link to */
  projectId: z.string().uuid().optional(),
  /** Workflow-level lifecycle hooks (on_run_start, on_run_complete, etc.) */
  hooks: z.array(WorkflowHookDefinitionSchema).max(50).optional(),
  /** Imported hooks file config (.hooks.json) */
  hooksFile: HooksFileConfigSchema.optional(),
  /** Integrated Browser configuration */
  browserConfig: BrowserConfigSchema.optional(),
});

export type ImportWorkflowJson = z.infer<typeof ImportWorkflowJsonSchema>;

// ────────────────────────────────────────────────────────────────
// RunProfile — Reusable run configuration (CLI + Web)
// ────────────────────────────────────────────────────────────────

/** Per-stage override schema */
export const StageRunOverrideSchema = z.object({
  stageName: z.string().optional(),
  stageIndex: z.number().int().min(0).optional(),
  variables: z.record(z.unknown()).optional(),
  skip: z.boolean().optional(),
}).refine(
  (data) => data.stageName !== undefined || data.stageIndex !== undefined,
  { message: 'Either stageName or stageIndex must be provided' },
);

/** RunProfile Zod schema for validation */
export const RunProfileSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  workflowDefinitionId: z.string().uuid(),
  runName: z.string().max(200).optional(),
  variables: z.record(z.unknown()).default({}),
  permissionMode: z.enum(['bypassPermissions', 'default', 'acceptEdits', 'plan']).optional(),
  sessionMode: z.enum(['single', 'per-stage', 'auto']).optional(),
  projectId: z.string().uuid().optional(),
  selectedCodebases: z.array(z.string()).optional(),
  stageOverrides: z.array(StageRunOverrideSchema).max(100).optional(),
  promptFiles: z.array(z.string()).optional(),
  skillFiles: z.array(z.string()).optional(),
  agentFiles: z.array(z.string()).optional(),
  /** Runtime override — deep-merged on top of workflow.browserConfig. */
  browserConfig: BrowserConfigSchema.optional(),
});

export type RunProfileInput = z.infer<typeof RunProfileSchema>;
