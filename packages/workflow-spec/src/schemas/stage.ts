// ────────────────────────────────────────────────────────────────
// StageSpec v2 (P01 design decision 2; G5 §2.3, §3.2; P05 §1.3).
//
// A discriminated union on `kind`. This phase ships `agent`; P05 adds the
// container and deterministic kinds (loop, map, subworkflow, wait, check)
// as further members that spread the same `stageBase`.
//
// Fields whose engine default the v1 engine cannot execute (onExhausted,
// timeouts) are optional here, with the engine default in
// `STAGE_DEFAULTS`: a zod default would write them into every document and
// the engine gate would then reject every stage.
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';
import {
  CompensationActionSchema,
  ExprSchema,
  HookDefinitionSchema,
  PositionSchema,
  PromptDefinitionSchema,
  ResultValidationRuleSchema,
  StageKeySchema,
} from './common.js';
import { StageErrorCodeSchema } from './errors.js';
import { SessionSpecSchema } from './session.js';

export const JoinPolicySchema = z
  .discriminatedUnion('mode', [
    z
      .object({ mode: z.literal('all').describe('Every predecessor must be satisfied (a dead predecessor skips the stage)') })
      .strict()
      .describe('All-of join'),
    z
      .object({
        mode: z.literal('any').describe('The first satisfied predecessor makes the stage ready'),
        cancelRemaining: z.boolean().default(false).describe('Cancel predecessors that only lead here once the join fires'),
      })
      .strict()
      .describe('Any-of join'),
    z
      .object({
        mode: z.literal('n_of_m').describe('Ready once n predecessors are satisfied'),
        n: z.number().int().min(1).max(100).describe('How many satisfied predecessors are needed'),
        cancelRemaining: z.boolean().default(false).describe('Cancel predecessors that only lead here once the join fires'),
      })
      .strict()
      .describe('N-of-M join'),
  ])
  .describe('How incoming edges combine');
export type JoinPolicy = z.infer<typeof JoinPolicySchema>;

export const RetryPolicySchema = z
  .object({
    maxAttempts: z.number().int().min(1).max(10).default(2).describe('Attempts including the first'),
    initialDelayMs: z.number().int().min(0).max(3_600_000).default(2000).describe('Delay before the first retry'),
    backoffMultiplier: z.number().min(1).max(10).default(2).describe('Delay multiplier per retry'),
    maxDelayMs: z.number().int().min(0).max(3_600_000).default(60_000).describe('Upper bound on one delay'),
    jitter: z
      .enum(['full', 'equal', 'none'])
      .default('full')
      .describe('full: random 0..delay; equal: delay/2 plus random 0..delay/2; none: exact delay'),
    retryOn: z
      .array(StageErrorCodeSchema)
      .max(40)
      .optional()
      .describe('Error codes that retry; omitted means every transient code'),
    mode: z
      .enum(['resume', 'restart'])
      .default('resume')
      .describe('resume continues the same conversation; restart begins again from the first prompt'),
    restoreCheckpointOnRestart: z
      .boolean()
      .default(true)
      .describe('Restore the workspace to the first attempt checkpoint before a restart'),
  })
  .strict()
  .describe('Retry policy for failed attempts');
export type RetryPolicy = z.infer<typeof RetryPolicySchema>;

export const RepairPolicySchema = z
  .object({
    maxRepairs: z.number().int().min(0).max(5).default(2).describe('Repair turns per attempt, a budget separate from retries'),
    restartOnExhausted: z
      .boolean()
      .default(true)
      .describe('After the last repair, use one retry attempt as a restart that carries the validation feedback'),
  })
  .strict()
  .describe('Repair turns sent when the output fails its contract');
export type RepairPolicy = z.infer<typeof RepairPolicySchema>;

export const TimeoutsSchema = z
  .object({
    queueMs: z
      .number()
      .int()
      .min(1000)
      .max(86_400_000)
      .optional()
      .describe('Admission wait before the stage fails with queue_timeout (engine default 30 min)'),
    attemptMs: z
      .number()
      .int()
      .min(1000)
      .max(86_400_000)
      .optional()
      .describe('Agent time per attempt, every turn included; human wait time is excluded'),
    idleMs: z
      .number()
      .int()
      .min(1000)
      .max(86_400_000)
      .optional()
      .describe('No harness event for this long fails the attempt with idle_timeout (engine default 10 min)'),
    totalMs: z.number().int().min(1000).max(604_800_000).optional().describe('Deadline across all attempts'),
  })
  .strict()
  .describe('Split timeouts');
export type Timeouts = z.infer<typeof TimeoutsSchema>;

export const BudgetSchema = z
  .object({
    maxTurns: z.number().int().min(1).max(100_000).optional().describe('Harness turns (one per usage report)'),
    maxCostUsd: z.number().positive().max(100_000).optional().describe('Provider-reported cost in USD'),
    maxWallClockMs: z.number().int().min(1000).max(604_800_000).optional().describe('Wall clock, excluding time parked for a human'),
  })
  .strict()
  .describe('Spending limits; exhausting one never counts as success');
export type Budget = z.infer<typeof BudgetSchema>;

export const OutputContractSchema = z
  .object({
    format: z.enum(['text', 'json']).default('text').describe('text: free text; json: a JSON value, validated against `schema`'),
    schema: z
      .record(z.unknown())
      .optional()
      .describe('JSON Schema (draft 2020-12) of the structured output; expressions are typed from it'),
    extraction: z
      .enum(['auto', 'native', 'tool', 'final_json_block'])
      .default('auto')
      .describe('How structured output is obtained: auto picks native, then the submit_output tool, then the final JSON block'),
    instructions: z
      .string()
      .max(5000)
      .optional()
      .describe('Description of the expected output, appended to the final prompt'),
    rules: z.array(ResultValidationRuleSchema).max(20).default([]).describe('Hard rules checked before the stage completes'),
  })
  .strict()
  .describe('The output contract: validated before the stage completes');
export type OutputContract = z.infer<typeof OutputContractSchema>;

export const ContextSpecSchema = z
  .object({
    from: z
      .array(StageKeySchema)
      .max(50)
      .optional()
      .describe('Stages whose output is delivered as context; omitted means the direct predecessors'),
    mode: z
      .enum(['summary', 'output', 'structured', 'none'])
      .default('summary')
      .describe('summary: each source summary; output: full output text; structured: JSON output; none: no context'),
  })
  .strict()
  .describe('Which upstream results the stage receives, fenced as untrusted context');
export type ContextSpec = z.infer<typeof ContextSpecSchema>;

export const ApprovalSpecSchema = z
  .object({
    prompt: z.string().max(5000).optional().describe('What the reviewer is asked'),
    allowChanges: z.boolean().default(true).describe('The reviewer may request changes, which runs another turn'),
    maxRounds: z.number().int().min(1).max(10).default(3).describe('Change-request rounds before the reviewer must approve or reject'),
  })
  .strict()
  .describe('Human review after the stage finishes, before successors start');
export type ApprovalSpec = z.infer<typeof ApprovalSpecSchema>;

/** Fields every stage kind has (P05 §1.3). Kinds spread this. */
export const stageBase = {
  key: StageKeySchema,
  name: z.string().min(1).max(200).describe('Display name (free text)'),
  description: z.string().max(2000).optional().describe('What the stage is for'),
  parentKey: StageKeySchema.optional().describe('Key of the enclosing container stage; omitted means top level'),
  guard: ExprSchema.optional().describe('Boolean expression evaluated once the stage is ready; false skips it (guard_false)'),
  join: JoinPolicySchema.default({ mode: 'all' }),
  position: PositionSchema.optional(),
  compensate: z
    .array(CompensationActionSchema)
    .max(20)
    .optional()
    .describe('Undo actions run (last completed first) when the run fails or is cancelled'),
};

export const AgentStageSchema = z
  .object({
    ...stageBase,
    kind: z.literal('agent').describe('An LLM agent stage'),
    prompts: z.array(PromptDefinitionSchema).max(50).default([]).describe('Prompt turns sent in order'),
    followUpPrompts: z
      .array(PromptDefinitionSchema)
      .max(50)
      .optional()
      .describe('Prompts used instead of `prompts` from the second loop iteration on'),
    session: SessionSpecSchema.optional(),
    sessionReuse: z
      .enum(['fresh', 'continue'])
      .default('fresh')
      .describe('continue keeps one conversation across loop iterations; fresh starts a new one each time'),
    sessionGroup: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,47}$/)
      .optional()
      .describe('Stages with the same group share one conversation, one at a time'),
    context: ContextSpecSchema.default({}),
    output: OutputContractSchema.default({}),
    retry: RetryPolicySchema.optional(),
    repair: RepairPolicySchema.optional(),
    onExhausted: z
      .enum(['pause', 'fail'])
      .optional()
      .describe('When retries and routing are exhausted: pause for an operator or fail (engine default pause)'),
    timeouts: TimeoutsSchema.optional(),
    budget: BudgetSchema.optional(),
    approval: ApprovalSpecSchema.optional(),
    hooks: z.array(HookDefinitionSchema).max(50).default([]).describe('Stage lifecycle hooks'),
  })
  .strict()
  .describe('Agent stage');
export type AgentStage = z.infer<typeof AgentStageSchema>;

export const StageSpecSchema = z.discriminatedUnion('kind', [AgentStageSchema]).describe('One stage of the workflow graph');
export type StageSpec = z.infer<typeof StageSpecSchema>;
export type StageKind = StageSpec['kind'];

/** Container kinds own a body of child stages (`parentKey`). None exist before P05. */
export const CONTAINER_STAGE_KINDS: readonly string[] = [];

/** Templates of a stage, as JSON-pointer suffix → text (used by the validator and the builders). */
export function stageTemplateFields(stage: StageSpec): Array<{ pointer: string; text: string }> {
  const out: Array<{ pointer: string; text: string }> = [];
  stage.prompts.forEach((p, i) => out.push({ pointer: `/prompts/${i}/text`, text: p.text }));
  stage.followUpPrompts?.forEach((p, i) => out.push({ pointer: `/followUpPrompts/${i}/text`, text: p.text }));
  if (stage.approval?.prompt) out.push({ pointer: '/approval/prompt', text: stage.approval.prompt });
  if (stage.output.instructions) out.push({ pointer: '/output/instructions', text: stage.output.instructions });
  return out;
}
