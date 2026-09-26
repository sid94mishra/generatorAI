// ────────────────────────────────────────────────────────────────
// Building blocks shared by the stage, edge and workflow schemas.
//
// R-6: every input object is `.strict()` and every field is described; the
// descriptions feed the generated JSON Schema, FIELDS.md and the authoring
// skill, and a test fails when one is missing.
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';
import {
  CODEBASE_ALIAS_PATTERN,
  FORBIDDEN_VARIABLE_NAME_PATTERN,
  MAX_EXPRESSION_LENGTH,
  MAX_TEMPLATE_LENGTH,
  RESERVED_ROOTS,
  STAGE_KEY_PATTERN,
  VARIABLE_NAME_PATTERN,
} from '../constants.js';

/**
 * zod custom issues carry their stable validator code in `params.code`, so
 * `validateWorkflow` reports `reserved-variable-name` rather than a generic
 * schema error.
 */
export function customIssue(ctx: z.RefinementCtx, code: string, message: string, path: (string | number)[] = []): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, message, path, params: { code } });
}

export const StageKeySchema = z
  .string()
  .regex(STAGE_KEY_PATTERN, 'Stage keys are lower snake case: a letter, then letters, digits or _ (at most 48)')
  .describe('Stable stage key, unique per workflow; edges, context sources and expressions refer to stages by key');
export type StageKey = z.infer<typeof StageKeySchema>;

export const CodebaseAliasSchema = z
  .string()
  .min(1)
  .max(50)
  .regex(CODEBASE_ALIAS_PATTERN, 'Aliases may contain letters, digits, . _ -')
  .describe('Alias of a project codebase');

export const ExprSchema = z
  .string()
  .min(1)
  .max(MAX_EXPRESSION_LENGTH)
  .describe('An Expression v2 source string, parsed and type-checked at save time');

export const TemplateSchema = z
  .string()
  .max(MAX_TEMPLATE_LENGTH)
  .describe('Template text: {{ expression }} placeholders, {{#if expr}}…{{/if}} blocks; a bare {{name}} means {{variables.name}}');

/** A `secretref:` reference into the secret store. Literal secrets are never accepted. */
export const SecretRefSchema = z
  .string()
  .regex(/^secretref:[A-Za-z0-9_.:/-]{1,200}$/, 'Secrets must be secretref: references')
  .describe('A secretref: reference into the secret store (literal secrets are rejected)');

export const PositionSchema = z
  .object({
    x: z.number().finite().describe('Canvas x coordinate'),
    y: z.number().finite().describe('Canvas y coordinate'),
  })
  .strict()
  .describe('Builder canvas position of the node');

// ── Prompts ──────────────────────────────────────────────────────

export const PromptDefinitionSchema = z
  .object({
    label: z.string().min(1).max(200).describe('Short label shown in the builder and run page'),
    text: z.string().min(1).max(MAX_TEMPLATE_LENGTH).describe('The prompt text, a template'),
  })
  .strict()
  .describe('One prompt turn sent to the stage agent');
export type PromptDefinition = z.infer<typeof PromptDefinitionSchema>;

// ── Variables ────────────────────────────────────────────────────

/** Report a name that is an expression root or a system name (`__*`, `repo_path_*`, `repo_branch_*`). */
export function reservedVariableName(name: string, ctx: z.RefinementCtx, path: (string | number)[] = []): void {
  if ((RESERVED_ROOTS as readonly string[]).includes(name)) {
    customIssue(ctx, 'reserved-variable-name', `'${name}' is a reserved expression root and cannot be a variable name`, path);
  } else if (FORBIDDEN_VARIABLE_NAME_PATTERN.test(name)) {
    customIssue(
      ctx,
      'reserved-variable-name',
      `'${name}' is reserved: names starting with __, repo_path_ or repo_branch_ are system values (use run.codebases.<alias>)`,
      path,
    );
  }
}

/** `list` is a list of strings; `json` is any JSON value (P05, P5-23). */
export const VARIABLE_TYPES = ['string', 'number', 'boolean', 'choice', 'text', 'list', 'json'] as const;
export type VariableType = (typeof VARIABLE_TYPES)[number];

export const VariableDefinitionSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(64)
      .regex(VARIABLE_NAME_PATTERN, 'Variable names are identifiers')
      .describe('Identifier referenced as variables.<name> (or bare {{name}} in templates)'),
    type: z
      .enum(VARIABLE_TYPES)
      .describe('Value type; choice restricts the value to `options`; list is a list of strings; json is any JSON value'),
    label: z.string().min(1).max(200).describe('Label shown in the run form'),
    description: z.string().max(2000).optional().describe('Help text shown in the run form'),
    required: z.boolean().default(false).describe('Whether a run must supply a value (or rely on the default)'),
    defaultValue: z.unknown().optional().describe('Value used when a run supplies none; must match `type`'),
    options: z
      .array(z.string().min(1).max(200))
      .max(100)
      .optional()
      .describe('Allowed values of a choice variable'),
  })
  .strict()
  .superRefine((v, ctx) => reservedVariableName(v.name, ctx, ['name']))
  .describe('A workflow input variable');
export type VariableDefinition = z.infer<typeof VariableDefinitionSchema>;

// ── Hooks ────────────────────────────────────────────────────────

/** Phases a stage hook can run in. Every phase has a producer in the stage executor. */
export const STAGE_HOOK_PHASES = [
  'pre_run',
  'post_run',
  'pre_prompt',
  'post_prompt',
  'on_error',
  'on_cancel',
  'pre_tool_use',
  'post_tool_use',
  'on_message',
  'on_reasoning',
  'on_session_start',
  'on_session_idle',
  'on_session_error',
  'on_session_cancelled',
] as const;
export type StageHookPhase = (typeof STAGE_HOOK_PHASES)[number];

/** Phases a workflow-level hook can run in. */
export const WORKFLOW_HOOK_PHASES = [
  'on_run_start',
  'on_run_complete',
  'on_run_failed',
  'on_run_cancelled',
  'pre_clone',
  'post_clone',
  'pre_commit',
  'post_commit',
  'on_pr_created',
  'on_preprocessing_complete',
  'on_postprocessing_start',
  'on_all_stages_scheduled',
  'on_stage_completed',
  'on_stage_failed',
  'on_parallel_join',
] as const;
export type WorkflowHookPhase = (typeof WORKFLOW_HOOK_PHASES)[number];
export type HookPhase = StageHookPhase | WorkflowHookPhase;

/** Category and description of every hook phase: the `GET /hooks/phases` catalogue. */
export const HOOK_PHASE_INFO: Readonly<Record<HookPhase, { category: string; description: string }>> = {
  pre_run: { category: 'stage', description: 'Before the stage attempt starts' },
  post_run: { category: 'stage', description: 'After the stage attempt finishes' },
  pre_prompt: { category: 'prompt', description: 'Before a prompt is sent to the agent' },
  post_prompt: { category: 'prompt', description: 'After the agent answered a prompt' },
  on_error: { category: 'error', description: 'When the stage attempt fails' },
  on_cancel: { category: 'lifecycle', description: 'When the stage is cancelled' },
  pre_tool_use: { category: 'tool', description: 'Before an agent tool is invoked' },
  post_tool_use: { category: 'tool', description: 'After an agent tool completes' },
  on_message: { category: 'message', description: 'When the agent sends a message' },
  on_reasoning: { category: 'message', description: 'When the agent emits reasoning content' },
  on_session_start: { category: 'session', description: 'When the stage session starts' },
  on_session_idle: { category: 'session', description: 'When the stage session becomes idle' },
  on_session_error: { category: 'session', description: 'When the stage session reports an error' },
  on_session_cancelled: { category: 'session', description: 'When the stage session is stopped by a user' },
  on_run_start: { category: 'run', description: 'When a workflow run starts' },
  on_run_complete: { category: 'run', description: 'When a workflow run completes' },
  on_run_failed: { category: 'run', description: 'When a workflow run fails' },
  on_run_cancelled: { category: 'run', description: 'When a workflow run is cancelled' },
  pre_clone: { category: 'git', description: 'Before the run prepares its codebases' },
  post_clone: { category: 'git', description: 'After the run prepared its codebases' },
  pre_commit: { category: 'git', description: 'Before post-processing commits' },
  post_commit: { category: 'git', description: 'After post-processing committed' },
  on_pr_created: { category: 'git', description: 'After post-processing opened a pull request' },
  on_preprocessing_complete: { category: 'orchestration', description: 'After the preprocessing steps complete' },
  on_postprocessing_start: { category: 'orchestration', description: 'Before the post-processing steps start' },
  on_all_stages_scheduled: { category: 'orchestration', description: 'After every root stage has been scheduled' },
  on_stage_completed: { category: 'stage', description: 'When any stage completes' },
  on_stage_failed: { category: 'stage', description: 'When any stage fails' },
  on_parallel_join: { category: 'stage', description: 'When parallel branches join' },
};

const ScriptHookConfigSchema = z
  .object({
    type: z.literal('script').describe('Run a local command'),
    command: z
      .string()
      .min(1)
      .max(1000)
      .describe('Executable to run; a literal (templates are rejected, pass values through env)'),
    args: z
      .array(z.string().max(4000))
      .max(64)
      .optional()
      .describe('Literal arguments (templates are rejected, pass values through env)'),
    cwd: z.string().max(1000).optional().describe('Working directory, relative to the run workspace'),
    env: z
      .record(z.string().max(4000))
      .optional()
      .describe('Environment variables; values may be templates of non-secret values or secretref: references'),
  })
  .strict()
  .describe('Script hook configuration');

const HttpHookConfigSchema = z
  .object({
    type: z.literal('http').describe('Call an HTTP endpoint'),
    url: z.string().url().max(2000).describe('Endpoint URL'),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).describe('HTTP method'),
    headers: z
      .record(z.string().max(4000))
      .optional()
      .describe('Request headers; secret values must be secretref: references'),
    bodyTemplate: z.string().max(100_000).optional().describe('Request body template'),
  })
  .strict()
  .describe('HTTP hook configuration');

const FunctionHookConfigSchema = z
  .object({
    type: z.literal('function').describe('Run a registered in-process handler or a module in a subprocess'),
    modulePath: z.string().max(1000).optional().describe('Module (relative to the workspace) whose default export is the hook'),
    handlerName: z.string().max(200).optional().describe('Name of an in-process handler registered with the hook executor'),
    args: z.record(z.unknown()).optional().describe('Payload passed to the handler as ctx.args'),
  })
  .strict()
  .describe('Function hook configuration');

export const HookConfigSchema = z
  .discriminatedUnion('type', [ScriptHookConfigSchema, HttpHookConfigSchema, FunctionHookConfigSchema])
  .superRefine((c, ctx) => {
    if (c.type === 'function' && !c.modulePath && !c.handlerName) {
      customIssue(ctx, 'function-hook-target', 'A function hook needs modulePath or handlerName');
    }
  })
  .describe('What the hook does');
export type HookConfig = z.infer<typeof HookConfigSchema>;

const hookCommon = {
  id: z.string().min(1).max(100).describe('Stable hook id, unique within its list'),
  name: z.string().min(1).max(200).describe('Display name'),
  type: z.enum(['script', 'http', 'function']).describe('Hook kind; must equal config.type'),
  priority: z.number().int().min(-1000).max(1000).default(0).describe('Higher priorities run first within a phase'),
  enabled: z.boolean().default(true).describe('Disabled hooks are kept but never run'),
  failurePolicy: z
    .enum(['abort', 'skip', 'continue'])
    .default('skip')
    .describe('abort fails the owner, skip ignores the failure, continue logs and proceeds'),
  timeoutMs: z.number().int().min(100).max(600_000).default(30_000).describe('Per-execution timeout'),
  retries: z.number().int().min(0).max(5).default(0).describe('Retries after a failed execution'),
  config: HookConfigSchema,
};

function hookTypeMatches(h: { type: string; config: { type: string } }, ctx: z.RefinementCtx): void {
  if (h.type !== h.config.type) customIssue(ctx, 'hook-type-mismatch', 'type must equal config.type', ['type']);
}

export const HookDefinitionSchema = z
  .object({
    ...hookCommon,
    phase: z.enum(STAGE_HOOK_PHASES).describe('Stage lifecycle phase the hook runs in'),
  })
  .strict()
  .superRefine(hookTypeMatches)
  .describe('A stage hook');
export type HookDefinition = z.infer<typeof HookDefinitionSchema>;

export const WorkflowHookDefinitionSchema = z
  .object({
    ...hookCommon,
    phase: z.enum(WORKFLOW_HOOK_PHASES).describe('Run lifecycle phase the hook runs in'),
  })
  .strict()
  .superRefine(hookTypeMatches)
  .describe('A workflow-level hook');
export type WorkflowHookDefinition = z.infer<typeof WorkflowHookDefinitionSchema>;

/** A one-shot action: the workflow's `onExit` / `onFailure` entries. */
export const ActionDefinitionSchema = z
  .object({
    name: z.string().min(1).max(200).describe('Display name'),
    config: HookConfigSchema,
    timeoutMs: z.number().int().min(100).max(600_000).default(30_000).describe('Per-execution timeout'),
    retries: z.number().int().min(0).max(5).default(0).describe('Retries after a failed execution'),
  })
  .strict()
  .describe('An action run once while the run finalizes');
export type ActionDefinition = z.infer<typeof ActionDefinitionSchema>;

const RestoreCheckpointConfigSchema = z
  .object({
    type: z.literal('restore_checkpoint').describe("Restore the workspace to the checkpoint taken before the stage's first attempt"),
  })
  .strict()
  .describe('Built-in compensation: restore the pre-stage checkpoint');

/** A saga compensation for a completed stage, run in reverse completion order. */
export const CompensationActionSchema = z
  .object({
    name: z.string().min(1).max(200).describe('Display name'),
    config: z
      .union([HookConfigSchema, RestoreCheckpointConfigSchema])
      .describe('What the compensation does: a hook action or restore_checkpoint'),
    timeoutMs: z.number().int().min(100).max(600_000).default(30_000).describe('Per-execution timeout'),
    retries: z.number().int().min(0).max(5).default(3).describe('Retries after a failed execution'),
  })
  .strict()
  .describe('Undo action for a completed stage, run when the run fails or is cancelled');
export type CompensationAction = z.infer<typeof CompensationActionSchema>;

// ── Result validation rules ──────────────────────────────────────

const ruleMessage = z.string().max(1000).optional().describe('Message recorded when the rule fails');

export const ResultValidationRuleSchema = z
  .discriminatedUnion('type', [
    z
      .object({
        type: z.literal('contains').describe('The output contains `value`'),
        value: z.string().min(1).max(10_000).describe('Required substring'),
        message: ruleMessage,
      })
      .strict()
      .describe('Substring rule'),
    z
      .object({
        type: z.literal('not_contains').describe('The output does not contain `value`'),
        value: z.string().min(1).max(10_000).describe('Forbidden substring'),
        message: ruleMessage,
      })
      .strict()
      .describe('Negative substring rule'),
    z
      .object({
        type: z.literal('min_length').describe('The output has at least `value` characters'),
        value: z.number().int().min(0).max(10_000_000).describe('Minimum length'),
        message: ruleMessage,
      })
      .strict()
      .describe('Minimum length rule'),
    z
      .object({
        type: z.literal('max_length').describe('The output has at most `value` characters'),
        value: z.number().int().min(0).max(10_000_000).describe('Maximum length'),
        message: ruleMessage,
      })
      .strict()
      .describe('Maximum length rule'),
    z
      .object({
        type: z.literal('regex').describe('The output matches `pattern` (linear-time engine, no backtracking)'),
        pattern: z.string().min(1).max(1000).describe('Pattern without slashes; backreferences and lookaround are not supported'),
        flags: z
          .string()
          .regex(/^[ims]{0,3}$/, 'flags are a subset of i, m, s')
          .optional()
          .describe('Flags: i (ignore case), m (multiline anchors), s (dot matches newline)'),
        message: ruleMessage,
      })
      .strict()
      .describe('Regular-expression rule'),
    z
      .object({
        type: z.literal('custom_script').describe('A command validates the output; exit code 0 passes'),
        command: z.string().min(1).max(1000).describe('Executable; a literal (templates are rejected)'),
        args: z.array(z.string().max(4000)).max(64).default([]).describe('Literal arguments'),
        env: z
          .record(z.string().max(4000))
          .optional()
          .describe('Environment; templates of non-secret values or secretref: references. STAGE_OUTPUT is always set'),
        timeoutMs: z.number().int().min(1000).max(600_000).default(60_000).describe('Timeout for the command'),
        message: ruleMessage,
      })
      .strict()
      .describe('Script rule'),
    z
      .object({
        type: z.literal('json_schema').describe('The output parses as JSON and validates against `schema`'),
        schema: z.record(z.unknown()).describe('JSON Schema (draft 2020-12)'),
        message: ruleMessage,
      })
      .strict()
      .describe('JSON Schema rule'),
    z
      .object({
        type: z
          .literal('judge')
          .describe('A model scores the output 0-10 against a rubric, in a fresh session without tools, after the hard rules; below the threshold the stage repairs with the reasons'),
        rubric: z.string().min(1).max(10_000).describe('What a good output is: the criteria the judge scores against'),
        threshold: z.number().min(0).max(10).describe('The lowest passing score (0-10)'),
        model: z.string().min(1).max(200).optional().describe("Catalog id of the judge's model; omitted uses the stage's"),
        include: z
          .array(z.enum(['diff']))
          .max(1)
          .optional()
          .describe('Extra evidence for the judge: diff = the working-tree diff of the stage mount'),
        message: ruleMessage,
      })
      .strict()
      .describe('Judge rule (use a judge STAGE with a score schema when a loop should decide instead)'),
  ])
  .describe('A hard rule the stage output must satisfy before the stage completes');
export type ResultValidationRule = z.infer<typeof ResultValidationRuleSchema>;
