# Workflow scripts and profiles: configuration fields

Generated from `packages/shared/src/config/WorkflowScriptSchema.ts` by `npm run configuration:generate`. These are the actual evaluated Zod contracts, including composed/partial schemas, defaults, nested objects, unions, and numeric/string limits.

Start with the [configuration map](./index.md) and [worked examples](./examples.md). **Schema defaults are not necessarily effective runtime defaults**: entrypoints, persisted preferences, agent resolution, and route logic may override them. A field accepted by a schema is not a promise of UI availability or provider support.

Nested fields apply only when their parent/union variant is present. Arrays use `[]`; records use `{key}`. Required children of an optional object do not make that parent required. Custom refinements, transforms and cross-field rules are preserved in the source contract below and explained in the feature guides.

## WorkflowScriptOutputSchema

Zod schema for validating WorkflowScriptOutput from .workflow.mjs files.
The inlineHooks field (Map of functions) is excluded from schema validation
since functions can't be serialized — it's validated separately at runtime.

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| id | string | `required` | min 1; regex /^[a-zA-Z][a-zA-Z0-9_-]*$/ |
| definition | object | `required` | unknown keys: strip |
| definition.name | string | `required` | min 1; max 255 |
| definition.description | string | `optional` | max 2000 |
| definition.sessionMode | "single" / "per-stage" / "auto" | `required` | — |
| definition.harnessConfig | map of unknown | `optional` | — |
| definition.variables | array of object | `required` | — |
| definition.variables[] | object | `required` | unknown keys: strip |
| definition.variables[].name | string | `required` | min 1; regex /^[a-zA-Z_][a-zA-Z0-9_]*$/ |
| definition.variables[].type | "string" / "number" / "boolean" / "choice" / "text" | `required` | — |
| definition.variables[].label | string | `required` | min 1 |
| definition.variables[].description | string | `optional` | — |
| definition.variables[].required | boolean | `required` | — |
| definition.variables[].defaultValue | unknown | `optional` | — |
| definition.variables[].options | array of string | `optional` | — |
| definition.tags | array of string | `required` | — |
| definition.orchestratorConfig | map of unknown | `optional` | — |
| definition.hooks | array of object | `optional` | — |
| definition.hooks[] | object | `required` | unknown keys: strip |
| definition.hooks[].id | string | `required` | — |
| definition.hooks[].name | string | `required` | — |
| definition.hooks[].phase | "on_run_start" / "on_run_complete" / "on_run_failed" / "on_run_cancelled" / "on_pr_created" / "on_preprocessing_complete" / "on_postprocessing_start" / "on_all_stages_scheduled" / "on_stage_completed" / "on_stage_failed" / "on_parallel_join" / "pre_clone" / "post_clone" / "pre_commit" / "post_commit" | `required` | — |
| definition.hooks[].type | "script" / "http" / "function" | `required` | — |
| definition.hooks[].priority | number | `required` | int; min 0 |
| definition.hooks[].enabled | boolean | `required` | — |
| definition.hooks[].failurePolicy | "abort" / "skip" / "continue" | `required` | — |
| definition.hooks[].timeoutMs | number | `required` | int; min 0 (exclusive) |
| definition.hooks[].retries | number | `required` | int; min 0 |
| definition.hooks[].config | variants by type (object / object / object) | `required` | — |
| definition.hooks[].config&lt;variant 1&gt; | object | `required` | unknown keys: strip |
| definition.hooks[].config&lt;variant 1&gt;.type | "script" | `required` | — |
| definition.hooks[].config&lt;variant 1&gt;.command | string | `required` | — |
| definition.hooks[].config&lt;variant 1&gt;.args | array of string | `optional` | — |
| definition.hooks[].config&lt;variant 1&gt;.cwd | string | `optional` | — |
| definition.hooks[].config&lt;variant 1&gt;.env | map of string | `optional` | — |
| definition.hooks[].config&lt;variant 2&gt; | object | `required` | unknown keys: strip |
| definition.hooks[].config&lt;variant 2&gt;.type | "http" | `required` | — |
| definition.hooks[].config&lt;variant 2&gt;.url | string | `required` | — |
| definition.hooks[].config&lt;variant 2&gt;.method | "GET" / "POST" / "PUT" | `default "POST"` | — |
| definition.hooks[].config&lt;variant 2&gt;.headers | map of string | `optional` | — |
| definition.hooks[].config&lt;variant 2&gt;.bodyTemplate | string | `optional` | — |
| definition.hooks[].config&lt;variant 3&gt; | object | `required` | unknown keys: strip |
| definition.hooks[].config&lt;variant 3&gt;.type | "function" | `required` | — |
| definition.hooks[].config&lt;variant 3&gt;.modulePath | string | `optional` | — |
| definition.hooks[].config&lt;variant 3&gt;.handlerName | string | `optional` | — |
| definition.hooks[].config&lt;variant 3&gt;.args | map of unknown | `optional` | — |
| definition.useWorktree | boolean | `optional` | — |
| definition.skills | array of object | `optional` | — |
| definition.skills[] | object | `required` | unknown keys: strip |
| definition.skills[].name | string | `required` | — |
| definition.skills[].directory | string | `optional` | — |
| definition.skills[].description | string | `optional` | — |
| definition.agents | array of object | `optional` | — |
| definition.agents[] | object | `required` | unknown keys: strip |
| definition.agents[].name | string | `required` | — |
| definition.agents[].description | string | `optional` | — |
| definition.agents[].instructions | string | `optional` | — |
| definition.agents[].tools | array of string | `optional` | — |
| stages | array of object | `required` | minLength 1; maxLength 50 |
| stages[] | object | `required` | unknown keys: strip |
| stages[].localId | string | `required` | min 1; regex /^[a-zA-Z][a-zA-Z0-9_-]*$/ |
| stages[].config | object | `required` | unknown keys: strip |
| stages[].config.name | string | `required` | min 1 |
| stages[].config.description | string | `optional` | — |
| stages[].config.order | number | `required` | int; min 0 |
| stages[].config.prompts | array of object | `required` | minLength 0 |
| stages[].config.prompts[] | object | `required` | unknown keys: strip |
| stages[].config.prompts[].label | string | `optional` | — |
| stages[].config.prompts[].text | string | `required` | — |
| stages[].config.prompts[].source | "inline" / "file" | `optional` | — |
| stages[].config.prompts[].filePath | string | `optional` | — |
| stages[].config.prompts[].attachments | array of string | `optional` | — |
| stages[].config.prompts[].waitForCompletion | boolean | `optional` | — |
| stages[].config.hooks | array of object | `optional` | — |
| stages[].config.hooks[] | object | `required` | unknown keys: strip |
| stages[].config.hooks[].id | string | `required` | — |
| stages[].config.hooks[].name | string | `required` | — |
| stages[].config.hooks[].phase | string | `required` | — |
| stages[].config.hooks[].type | "script" / "http" / "function" | `required` | — |
| stages[].config.hooks[].priority | number | `required` | int; min 0 |
| stages[].config.hooks[].enabled | boolean | `required` | — |
| stages[].config.hooks[].failurePolicy | "abort" / "skip" / "continue" | `required` | — |
| stages[].config.hooks[].timeoutMs | number | `required` | int; min 0 (exclusive) |
| stages[].config.hooks[].retries | number | `required` | int; min 0 |
| stages[].config.hooks[].config | variants by type (object / object / object) | `required` | — |
| stages[].config.hooks[].config&lt;variant 1&gt; | object | `required` | unknown keys: strip |
| stages[].config.hooks[].config&lt;variant 1&gt;.type | "script" | `required` | — |
| stages[].config.hooks[].config&lt;variant 1&gt;.command | string | `required` | — |
| stages[].config.hooks[].config&lt;variant 1&gt;.args | array of string | `optional` | — |
| stages[].config.hooks[].config&lt;variant 1&gt;.cwd | string | `optional` | — |
| stages[].config.hooks[].config&lt;variant 1&gt;.env | map of string | `optional` | — |
| stages[].config.hooks[].config&lt;variant 2&gt; | object | `required` | unknown keys: strip |
| stages[].config.hooks[].config&lt;variant 2&gt;.type | "http" | `required` | — |
| stages[].config.hooks[].config&lt;variant 2&gt;.url | string | `required` | — |
| stages[].config.hooks[].config&lt;variant 2&gt;.method | "GET" / "POST" / "PUT" | `default "POST"` | — |
| stages[].config.hooks[].config&lt;variant 2&gt;.headers | map of string | `optional` | — |
| stages[].config.hooks[].config&lt;variant 2&gt;.bodyTemplate | string | `optional` | — |
| stages[].config.hooks[].config&lt;variant 3&gt; | object | `required` | unknown keys: strip |
| stages[].config.hooks[].config&lt;variant 3&gt;.type | "function" | `required` | — |
| stages[].config.hooks[].config&lt;variant 3&gt;.modulePath | string | `optional` | — |
| stages[].config.hooks[].config&lt;variant 3&gt;.handlerName | string | `optional` | — |
| stages[].config.hooks[].config&lt;variant 3&gt;.args | map of unknown | `optional` | — |
| stages[].config.variables | map of unknown | `optional` | — |
| stages[].config.harnessConfigOverrides | map of unknown | `optional` | — |
| stages[].config.agentName | string | `optional` | — |
| stages[].config.contextFilter | "full" / "summary-only" / "none" / "structured" | `optional` | — |
| stages[].config.contextSources | array of string | `optional` | — |
| stages[].config.outputFormat | "text" / "json" | `optional` | — |
| stages[].config.outputSchema | map of unknown | `optional` | — |
| stages[].config.retryPolicy | object | `optional` | unknown keys: strip |
| stages[].config.retryPolicy.maxRetries | number | `required` | int; min 0; max 10 |
| stages[].config.retryPolicy.backoffMs | number | `required` | int; min 0 |
| stages[].config.retryPolicy.backoffMultiplier | number | `optional` | min 1 |
| stages[].config.timeoutMs | number | `optional` | int; min 0 (exclusive) |
| stages[].config.condition | object | `optional` | unknown keys: strip |
| stages[].config.condition.type | "always" / "on_success" / "on_failure" / "expression" | `required` | — |
| stages[].config.condition.expression | string | `optional` | — |
| stages[].config.iterationConfig | object | `optional` | unknown keys: strip |
| stages[].config.iterationConfig.subWorkflowDefinitionId | string | `optional` | — |
| stages[].config.iterationConfig.inputMapping | map of string | `optional` | — |
| stages[].config.iterationConfig.outputMapping | map of string | `optional` | — |
| stages[].config.iterationConfig.maxIterations | number | `optional` | int; min 0 (exclusive) |
| stages[].config.iterationConfig.exitField | string | `optional` | — |
| stages[].config.iterationConfig.exitValue | string | `optional` | — |
| stages[].config.skills | array of object | `optional` | — |
| stages[].config.skills[] | object | `required` | unknown keys: strip |
| stages[].config.skills[].name | string | `required` | — |
| stages[].config.skills[].directory | string | `optional` | — |
| stages[].config.skills[].description | string | `optional` | — |
| edges | array of object | `required` | — |
| edges[] | object | `required` | unknown keys: strip |
| edges[].from | string | `required` | min 1 |
| edges[].to | string | `required` | min 1 |
| edges[].edgeType | "on_success" / "on_failure" / "on_completion" / "always" | `required` | — |
| edges[].condition | string | `optional` | — |

## ScriptRunProfileSchema

Schema for RunProfileConfig as exported by scripts.

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| version | 1 | `required` | — |
| name | string | `required` | min 1 |
| description | string | `optional` | — |
| variables | map of unknown | `default {}` | — |
| permissionMode | "askOnEachTool" / "askOnce" / "bypassPermissions" / "default" / "acceptEdits" / "plan" | `optional` | — |
| sessionMode | "single" / "per-stage" / "auto" | `optional` | — |
| stageOverrides | array of object | `optional` | — |
| stageOverrides[] | object | `required` | unknown keys: strip |
| stageOverrides[].stageName | string | `optional` | — |
| stageOverrides[].stageIndex | number | `optional` | int; min 0 |
| stageOverrides[].agentName | string | `optional` | — |
| stageOverrides[].contextFilter | "full" / "summary-only" / "none" / "structured" | `optional` | — |
| stageOverrides[].timeoutMs | number | `optional` | int; min 0 (exclusive) |
| stageOverrides[].variables | map of unknown | `optional` | — |
| stageOverrides[].skip | boolean | `optional` | — |

## Complete validation contract

The following source snapshot contains the additional refinements, transformations, comments, and imported contract names. It is reference material, not a configuration file to paste into the app.

<details>
<summary>Read the complete WorkflowScriptSchema.ts source contract</summary>

```typescript
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
  source: z.enum(['inline', 'file']).optional(),
  filePath: z.string().optional(),
  attachments: z.array(z.string()).optional(),
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
    variables: z.record(z.unknown()).optional(),
    harnessConfigOverrides: z.record(z.unknown()).optional(),
    agentName: z.string().optional(),
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
```

</details>
