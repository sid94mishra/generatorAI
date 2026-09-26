// ────────────────────────────────────────────────────────────────
// WorkflowSpec v2: the workflow-level document (P01 design decision 2).
//
// Workflow-level validations no longer exist: rules live in each stage's
// `output.rules`. Codebases, worktrees, preprocessing and post-processing
// are the run lifecycle, grouped under `lifecycle`.
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { MAX_TEMPLATE_LENGTH, MAX_VARIABLES } from '../constants.js';
import {
  ActionDefinitionSchema,
  ExprSchema,
  TemplateSchema,
  VariableDefinitionSchema,
  WorkflowHookDefinitionSchema,
} from './common.js';
import { SessionSpecSchema } from './session.js';
import { BudgetSchema } from './stage.js';

export const CodebaseAliasSchema = z
  .string()
  .min(1)
  .max(50)
  .regex(/^[A-Za-z0-9._-]+$/, 'Aliases may contain letters, digits, . _ -')
  .describe('Alias of a project codebase');

const InputRuleSchema = z
  .discriminatedUnion('type', [
    z
      .object({
        type: z.literal('required').describe('The variable has a non-empty value'),
        message: z.string().min(1).max(1000).describe('Error shown when the rule fails'),
      })
      .strict()
      .describe('Required rule'),
    z
      .object({
        type: z.literal('regex').describe('The value matches `pattern` (linear-time engine)'),
        pattern: z.string().min(1).max(1000).describe('Pattern without slashes'),
        flags: z.string().regex(/^[ims]{0,3}$/).optional().describe('Flags: i, m, s'),
        message: z.string().min(1).max(1000).describe('Error shown when the rule fails'),
      })
      .strict()
      .describe('Pattern rule'),
    z
      .object({
        type: z.literal('min_length').describe('The value has at least `value` characters'),
        value: z.number().int().min(0).max(1_000_000).describe('Minimum length'),
        message: z.string().min(1).max(1000).describe('Error shown when the rule fails'),
      })
      .strict()
      .describe('Minimum length rule'),
    z
      .object({
        type: z.literal('max_length').describe('The value has at most `value` characters'),
        value: z.number().int().min(0).max(1_000_000).describe('Maximum length'),
        message: z.string().min(1).max(1000).describe('Error shown when the rule fails'),
      })
      .strict()
      .describe('Maximum length rule'),
  ])
  .describe('A check on one input variable');

const runScriptConfig = {
  script: z
    .string()
    .min(1)
    .max(20_000)
    .describe('Shell script; a literal (templates are rejected, variables arrive as GEN_VAR_* environment variables)'),
  cwd: z.string().max(1000).optional().describe('Working directory, relative to the run workspace'),
  timeoutMs: z.number().int().min(1000).max(3_600_000).optional().describe('Timeout (default 60 s)'),
};

export type PreprocessingStepInput = {
  name: string;
  failOnError?: boolean;
  config:
    | { type: 'clone_repo'; repoAlias: string }
    | { type: 'run_script'; script: string; cwd?: string; timeoutMs?: number }
    | { type: 'validate_input'; variableName: string; rules: unknown[] }
    | { type: 'set_variable'; variableName: string; value: string }
    | { type: 'conditional'; condition: string; thenSteps: PreprocessingStepInput[]; elseSteps?: PreprocessingStepInput[] };
};

export const PreprocessingStepSchema: z.ZodType<PreprocessingStep, z.ZodTypeDef, PreprocessingStepInput> = z
    .object({
      name: z.string().min(1).max(200).describe('Display name'),
      failOnError: z.boolean().default(true).describe('Fail the run when the step fails'),
      config: z
        .discriminatedUnion('type', [
          z
            .object({
              type: z.literal('clone_repo').describe('Prepare a checkout of a codebase'),
              repoAlias: CodebaseAliasSchema,
            })
            .strict()
            .describe('Codebase checkout step'),
          z
            .object({ type: z.literal('run_script').describe('Run a shell script'), ...runScriptConfig })
            .strict()
            .describe('Script step'),
          z
            .object({
              type: z.literal('validate_input').describe('Check an input variable'),
              variableName: z.string().min(1).max(64).describe('Variable to check'),
              rules: z.array(InputRuleSchema).min(1).max(20).describe('Rules, all of which must pass'),
            })
            .strict()
            .describe('Input validation step'),
          z
            .object({
              type: z.literal('set_variable').describe('Set a variable for the rest of the run'),
              variableName: z.string().min(1).max(64).describe('Variable to set (a declared or a new one)'),
              value: TemplateSchema.describe('Value, a template'),
            })
            .strict()
            .describe('Variable step'),
          z
            .object({
              type: z.literal('conditional').describe('Run steps depending on an expression'),
              condition: ExprSchema.describe('Boolean expression over variables'),
              thenSteps: z
                .array(z.lazy(() => PreprocessingStepSchema))
                .max(20)
                .describe('Steps run when the condition is true'),
              elseSteps: z
                .array(z.lazy(() => PreprocessingStepSchema))
                .max(20)
                .optional()
                .describe('Steps run otherwise'),
            })
            .strict()
            .describe('Conditional step'),
        ])
        .describe('What the step does'),
    })
    .strict()
    .describe('A step run in the starting phase, before any stage');

export interface PreprocessingStep {
  name: string;
  failOnError: boolean;
  config:
    | { type: 'clone_repo'; repoAlias: string }
    | { type: 'run_script'; script: string; cwd?: string; timeoutMs?: number }
    | { type: 'validate_input'; variableName: string; rules: z.infer<typeof InputRuleSchema>[] }
    | { type: 'set_variable'; variableName: string; value: string }
    | { type: 'conditional'; condition: string; thenSteps: PreprocessingStep[]; elseSteps?: PreprocessingStep[] };
}

export const PostProcessingStepSchema = z
  .object({
    name: z.string().min(1).max(200).describe('Display name'),
    failOnError: z.boolean().default(true).describe('Fail the run when the step fails'),
    config: z
      .discriminatedUnion('type', [
        z
          .object({
            type: z.literal('commit_and_push').describe('Commit the run changes and optionally push'),
            repoAlias: CodebaseAliasSchema.optional(),
            commitMessage: z.string().min(1).max(MAX_TEMPLATE_LENGTH).describe('Commit message, a template'),
            push: z.boolean().optional().describe('Push after committing'),
            generateMessage: z.boolean().optional().describe('Let an agent write the message'),
            baseBranch: z.string().max(200).optional().describe('Branch the work branch is based on'),
          })
          .strict()
          .describe('Commit step'),
        z
          .object({
            type: z.literal('create_pr').describe('Open a pull request'),
            repoAlias: CodebaseAliasSchema.optional(),
            title: z.string().min(1).max(MAX_TEMPLATE_LENGTH).describe('Title, a template'),
            body: TemplateSchema.describe('Body, a template'),
            baseBranch: z.string().max(200).optional().describe('Target branch'),
            generateText: z.boolean().optional().describe('Let an agent write the title and body'),
            draft: z.boolean().optional().describe('Open as a draft'),
          })
          .strict()
          .describe('Pull request step'),
        z
          .object({ type: z.literal('run_script').describe('Run a shell script'), ...runScriptConfig })
          .strict()
          .describe('Script step'),
      ])
      .describe('What the step does'),
  })
  .strict()
  .describe('A step run while the run finalizes, after the stages');
export type PostProcessingStep = z.infer<typeof PostProcessingStepSchema>;

export const LifecycleSchema = z
  .object({
    codebaseAliases: z
      .array(CodebaseAliasSchema)
      .max(5)
      .default([])
      .describe('Project codebases the run mounts; exposed as run.codebases.<alias>'),
    useWorktree: z.boolean().default(true).describe('Mount codebases as isolated worktrees rather than in place'),
    requiresCodebase: z.boolean().default(false).describe('Refuse to start without at least one codebase'),
    sandbox: z
      .enum(['required', 'optional'])
      .default('required')
      .describe('When the deployment runs stages in a sandbox: required fails the run if the sandbox cannot start; optional runs on the host instead'),
    preprocessingSteps: z.array(PreprocessingStepSchema).max(50).default([]).describe('Steps run before any stage'),
    postProcessing: z
      .object({
        autoCommit: z.boolean().default(false).describe('Commit the changes when the run completes'),
        autoPush: z.boolean().default(false).describe('Push the work branch after committing'),
        autoCreatePR: z.boolean().default(false).describe('Open a pull request (implies commit and push)'),
        steps: z.array(PostProcessingStepSchema).max(50).default([]).describe('Extra steps, all run in order'),
      })
      .strict()
      .default({})
      .describe('What happens after the stages complete'),
  })
  .strict()
  .describe('Run lifecycle: codebases, worktrees, preprocessing and post-processing');
export type Lifecycle = z.infer<typeof LifecycleSchema>;

export const WorkflowSpecSchema = z
  .object({
    name: z.string().min(1).max(200).describe('Workflow name'),
    description: z.string().max(2000).optional().describe('What the workflow does'),
    session: SessionSpecSchema.default({}),
    variables: z.array(VariableDefinitionSchema).max(MAX_VARIABLES).default([]).describe('Input variables'),
    hooks: z.array(WorkflowHookDefinitionSchema).max(50).default([]).describe('Workflow lifecycle hooks'),
    onExit: z.array(ActionDefinitionSchema).max(20).optional().describe('Actions run when the run finalizes, whatever the outcome'),
    onFailure: z.array(ActionDefinitionSchema).max(20).optional().describe('Actions run when the run finalizes as failed'),
    lifecycle: LifecycleSchema.default({}),
    budget: BudgetSchema.optional(),
    maxParallel: z.number().int().min(1).max(32).optional().describe('Stages running at once (engine default 4)'),
    outputs: z
      .record(ExprSchema)
      .optional()
      .describe('Named results of the workflow, as expressions over its stages (read by parent workflows)'),
    tags: z.array(z.string().min(1).max(50)).max(20).default([]).describe('Tags'),
    projectId: z.string().uuid().nullable().optional().describe('Owning project; null or omitted means global'),
  })
  .strict()
  .describe('Workflow-level settings');
export type WorkflowSpec = z.infer<typeof WorkflowSpecSchema>;
