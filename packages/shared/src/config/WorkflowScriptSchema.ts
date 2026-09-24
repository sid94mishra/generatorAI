// ────────────────────────────────────────────────────────────────
// WorkflowScriptSchema — Zod validation for script outputs
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { MAX_STAGES_PER_WORKFLOW } from '../constants/index.js';

const HookConfigSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('script'),
    command: z.string(),
    args: z.array(z.string()).optional(),
    cwd: z.string().optional(),
    env: z.record(z.string()).optional(),
  }),
  z.object({
    type: z.literal('http'),
    url: z.string(),
    method: z.enum(['GET', 'POST', 'PUT']).default('POST'),
    headers: z.record(z.string()).optional(),
    bodyTemplate: z.string().optional(),
  }),
  z.object({
    type: z.literal('function'),
    modulePath: z.string().optional(),
    handlerName: z.string().optional(),
    args: z.record(z.unknown()).optional(),
  }),
]);

const HookDefinitionOutputSchema = z.object({
  id: z.string(),
  name: z.string(),
  phase: z.string(),
  type: z.enum(['script', 'http', 'function']),
  priority: z.number().int().min(0),
  enabled: z.boolean(),
  failurePolicy: z.enum(['abort', 'skip', 'continue']),
  timeoutMs: z.number().int().positive(),
  retries: z.number().int().min(0),
  config: HookConfigSchema,
});

const PromptDefinitionOutputSchema = z.object({
  label: z.string().optional(),
  text: z.string(),
  waitForCompletion: z.boolean().optional(),
});

const RetryPolicyOutputSchema = z.object({
  maxRetries: z.number().int().min(0).max(10),
  backoffMs: z.number().int().min(0),
  backoffMultiplier: z.number().min(1).optional(),
});

const StageConditionOutputSchema = z.object({
  // Mirror the canonical StageCondition: `type` is the discriminator and
  // `expression` is only required for `type: 'expression'`. The previous shape
  // (expression-only) stripped `type` and rejected non-expression conditions.
  type: z.enum(['always', 'on_success', 'on_failure', 'expression']),
  expression: z.string().optional(),
});

const IterationConfigOutputSchema = z.object({
  subWorkflowDefinitionId: z.string().optional(),
  inputMapping: z.record(z.string()).optional(),
  outputMapping: z.record(z.string()).optional(),
  maxIterations: z.number().int().positive().optional(),
  exitField: z.string().optional(),
  exitValue: z.string().optional(),
});

const StageSkillReferenceOutputSchema = z.object({
  name: z.string(),
  directory: z.string().optional(),
  description: z.string().optional(),
});

const StageOutputSchema = z.object({
  localId: z.string().min(1).regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/),
  config: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    order: z.number().int().min(0),
    prompts: z.array(PromptDefinitionOutputSchema).min(0),
    hooks: z.array(HookDefinitionOutputSchema).optional(),
    harnessConfigOverrides: z.record(z.unknown()).optional(),
    contextFilter: z.enum(['full', 'summary-only', 'none', 'structured']).optional(),
    contextSources: z.array(z.string()).optional(),
    outputFormat: z.enum(['text', 'json']).optional(),
    outputSchema: z.record(z.unknown()).optional(),
    retryPolicy: RetryPolicyOutputSchema.optional(),
    timeoutMs: z.number().int().positive().optional(),
    condition: StageConditionOutputSchema.optional(),
    iterationConfig: IterationConfigOutputSchema.optional(),
    skills: z.array(StageSkillReferenceOutputSchema).optional(),
  }),
});

const EdgeOutputSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  edgeType: z.enum(['on_success', 'on_failure', 'on_completion', 'always']),
  condition: z.string().optional(),
});

const VariableDefinitionOutputSchema = z.object({
  name: z.string().min(1).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  type: z.enum(['string', 'number', 'boolean', 'choice', 'text']),
  label: z.string().min(1),
  description: z.string().optional(),
  required: z.boolean(),
  defaultValue: z.unknown().optional(),
  options: z.array(z.string()).optional(),
});

const SkillReferenceOutputSchema = z.object({
  name: z.string(),
  directory: z.string().optional(),
  description: z.string().optional(),
});

const AgentReferenceOutputSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  instructions: z.string().optional(),
  tools: z.array(z.string()).optional(),
});

const WorkflowHookPhaseSchema = z.enum([
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
  'pre_clone',
  'post_clone',
  'pre_commit',
  'post_commit',
]);

const WorkflowHookDefinitionOutputSchema = z.object({
  id: z.string(),
  name: z.string(),
  phase: WorkflowHookPhaseSchema,
  type: z.enum(['script', 'http', 'function']),
  priority: z.number().int().min(0),
  enabled: z.boolean(),
  failurePolicy: z.enum(['abort', 'skip', 'continue']),
  timeoutMs: z.number().int().positive(),
  retries: z.number().int().min(0),
  config: HookConfigSchema,
});

/**
 * Zod schema for validating WorkflowScriptOutput from .workflow.mjs files.
 * The inlineHooks field (Map of functions) is excluded from schema validation
 * since functions can't be serialized — it's validated separately at runtime.
 */
export const WorkflowScriptOutputSchema = z.object({
  id: z.string().min(1).regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/),
  definition: z.object({
    name: z.string().min(1).max(255),
    description: z.string().max(2000).optional(),
    sessionMode: z.enum(['single', 'per-stage', 'auto']),
    harnessConfig: z.record(z.unknown()).optional(),
    variables: z.array(VariableDefinitionOutputSchema),
    tags: z.array(z.string()),
    orchestratorConfig: z.record(z.unknown()).optional(),
    hooks: z.array(WorkflowHookDefinitionOutputSchema).optional(),
    useWorktree: z.boolean().optional(),
    skills: z.array(SkillReferenceOutputSchema).optional(),
    agents: z.array(AgentReferenceOutputSchema).optional(),
  }),
  stages: z.array(StageOutputSchema).min(1).max(MAX_STAGES_PER_WORKFLOW),
  edges: z.array(EdgeOutputSchema),
});

/** Schema for RunProfileConfig as exported by scripts. */
export const ScriptRunProfileSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1),
  description: z.string().optional(),
  variables: z.record(z.unknown()).default({}),
  // Accepts BOTH the script-authoring vocabulary (`askOnEachTool`/`askOnce`)
  // and the canonical runtime vocabulary. The server's `mapScriptPermissionMode`
  // (apps/server/src/routes/workflowScripts.ts) translates the former to the
  // latter before persisting. Both must be allowed so existing scripts using
  // `askOnce` keep loading while canonical values also work.
  permissionMode: z
    .enum(['askOnEachTool', 'askOnce', 'bypassPermissions', 'default', 'acceptEdits', 'plan'])
    .optional(),
  sessionMode: z.enum(['single', 'per-stage', 'auto']).optional(),
  stageOverrides: z.array(z.object({
    stageName: z.string().optional(),
    stageIndex: z.number().int().min(0).optional(),
    agentName: z.string().optional(),
    contextFilter: z.enum(['full', 'summary-only', 'none', 'structured']).optional(),
    timeoutMs: z.number().int().positive().optional(),
    variables: z.record(z.unknown()).optional(),
    skip: z.boolean().optional(),
  })).optional(),
});

export type WorkflowScriptOutputParsed = z.infer<typeof WorkflowScriptOutputSchema>;
export type ScriptRunProfileParsed = z.infer<typeof ScriptRunProfileSchema>;
