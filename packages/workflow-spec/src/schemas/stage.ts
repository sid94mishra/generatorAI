// ────────────────────────────────────────────────────────────────
// StageSpec v2 (P01 design decision 2; G5 §2.3, §3.2; P05 §1.3).
//
// A discriminated union on `kind`: `agent` (P01), `check`, the `loop` and
// `map` containers, `subworkflow` and `wait` (P05). Every kind spreads the
// same `stageBase` and declares exactly the fields that apply to it (P05
// §1.3): a field of another kind is the validator error
// `field-not-applicable`.
//
// Fields whose engine default the v1 engine cannot execute (onExhausted,
// timeouts) are optional here, with the engine default in
// `STAGE_DEFAULTS`: a zod default would write them into every document and
// the engine gate would then reject every stage.
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { BARE_COMMAND_PATTERN, VARIABLE_NAME_PATTERN } from '../constants.js';
import {
  CodebaseAliasSchema,
  CompensationActionSchema,
  ExprSchema,
  HookDefinitionSchema,
  PositionSchema,
  PromptDefinitionSchema,
  ResultValidationRuleSchema,
  StageKeySchema,
  TemplateSchema,
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
    maxTokens: z.number().int().min(1).max(10_000_000_000).optional().describe('Input plus output tokens reported by the provider'),
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
    compactAfter: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe(
        'With sessionReuse continue: every n iterations the conversation is replaced by a fresh one seeded with a deterministic digest (no model call)',
      ),
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

// ── check (P05 §1.2) ─────────────────────────────────────────────

/** A path inside a mount: relative, no `..` segment, no drive letter. */
export const RelativePathSchema = z
  .string()
  .min(1)
  .max(1000)
  .regex(/^(?![\\/])(?![A-Za-z]:)(?!(.*[\\/])?\.\.([\\/]|$)).+$/, 'A path inside the mount: relative, without ..')
  .describe('A path relative to the mount root (no .., not absolute)');

export const CheckSpecSchema = z
  .object({
    command: z
      .string()
      .regex(BARE_COMMAND_PATTERN, 'A bare executable name, resolved through PATH (no path separators)')
      .describe('Executable to run: a bare name on the command allow-list (a literal; templates are rejected)'),
    args: z
      .array(z.string().max(4000))
      .max(64)
      .default([])
      .describe('Literal arguments; a template is rejected (check-args-literal): pass values through env'),
    env: z
      .record(TemplateSchema.describe('Value: a template of non-secret values, or a secretref: reference'))
      .optional()
      .describe('Environment variables: the ONLY place templated values reach the command'),
    mount: CodebaseAliasSchema.optional().describe('Run mount (codebase alias) the command runs in; omitted means the primary mount'),
    cwd: RelativePathSchema.optional().describe('Working directory inside the mount'),
    timeoutMs: z
      .number()
      .int()
      .min(1000)
      .max(3_600_000)
      .default(600_000)
      .describe('Kill the command after this long; the output is then timedOut: true, passed: false'),
    parseJson: z.boolean().default(false).describe('Parse stdout as JSON into output.json (a parse error is output.jsonError)'),
    failOnNonZero: z
      .boolean()
      .default(false)
      .describe('A non-zero exit (or a timeout) fails the stage instead of completing with passed: false'),
    tailBytes: z
      .number()
      .int()
      .min(1024)
      .max(262_144)
      .default(16_384)
      .describe('How much of the end of stdout and stderr the output keeps (ANSI colours stripped)'),
  })
  .strict()
  .describe('The command a check stage runs');
export type CheckSpec = z.infer<typeof CheckSpecSchema>;

export const CheckTimeoutsSchema = z
  .object({
    queueMs: TimeoutsSchema.shape.queueMs,
  })
  .strict()
  .describe('Timeouts of a check stage: only the admission wait (the command has check.timeoutMs)');

export const CheckStageSchema = z
  .object({
    ...stageBase,
    kind: z.literal('check').describe('One deterministic command, no LLM: its exit code and output are the stage output'),
    check: CheckSpecSchema,
    retry: RetryPolicySchema.optional(),
    timeouts: CheckTimeoutsSchema.optional(),
  })
  .strict()
  .describe('Check stage (runs repository code: the run capability `shell`)');
export type CheckStage = z.infer<typeof CheckStageSchema>;

// ── loop (P05 §2.1) ──────────────────────────────────────────────

export const LOOP_EXIT_ACTIONS = ['complete', 'fail', 'pause', 'exhaust'] as const;
export type LoopExitAction = (typeof LOOP_EXIT_ACTIONS)[number];

/** Identifier names of carried values and `output.select` entries. */
const LoopNameSchema = z.string().regex(VARIABLE_NAME_PATTERN, 'An identifier').max(64);

export const ExitRuleSchema = z
  .object({
    when: ExprSchema.describe('Boolean expression evaluated after each iteration (context E(k)); an error or null counts as false'),
    action: z
      .enum(LOOP_EXIT_ACTIONS)
      .describe('complete ends the loop successfully; fail fails it; pause parks it for an operator decision; exhaust applies onLimit'),
    consecutive: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(1)
      .describe('How many iterations in a row the rule must hold (a streak; reset by an operator command, a firing, an error or a failed iteration)'),
    reason: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,39}$/, 'lower snake case, at most 40 characters')
      .describe('Recorded as the exit reason and shown in the run page'),
  })
  .strict()
  .describe('An exit rule of a loop: when it fires, the loop takes its action');
export type ExitRule = z.infer<typeof ExitRuleSchema>;

export const LoopOnLimitSchema = z
  .discriminatedUnion('mode', [
    z.object({ mode: z.literal('pause').describe('Park the loop for an operator decision (default)') }).strict().describe('Pause'),
    z.object({ mode: z.literal('fail').describe('Fail the loop') }).strict().describe('Fail'),
    z
      .object({ mode: z.literal('accept_last').describe('Complete with the last iteration (exitAction accept_last)') })
      .strict()
      .describe('Accept the last iteration'),
    z
      .object({
        mode: z.literal('accept_best').describe('Complete with the best-scoring iteration; its workspace checkpoint is restored'),
        score: ExprSchema.describe('Number evaluated after each iteration (context E(k)); ties go to the latest; all null behaves as pause'),
      })
      .strict()
      .describe('Accept the best iteration'),
  ])
  .describe('What exhausting the loop does (max iterations, the budget, an exhaust rule)');
export type LoopOnLimit = z.infer<typeof LoopOnLimitSchema>;

export const LoopWrapUpSchema = z
  .object({
    stage: StageKeySchema.describe('Body agent stage (sessionReuse continue) whose conversation writes the wrap-up'),
    prompt: PromptDefinitionSchema.describe('The wrap-up prompt (a template, context T of the last iteration)'),
    maxTurns: z.number().int().min(1).max(5).default(1).describe('Turns the wrap-up may take'),
    maxCostShare: z
      .number()
      .min(0)
      .max(0.5)
      .default(0.1)
      .describe('Its own allowance: this share of budget.maxCostUsd, outside the 1.25× hard cap'),
  })
  .strict()
  .describe('A last turn run once when the budget is exhausted, before onLimit applies');
export type LoopWrapUp = z.infer<typeof LoopWrapUpSchema>;

export const LoopSpecSchema = z
  .object({
    maxIterations: z.number().int().min(1).max(50).describe('Hard cap on iterations (operators may grant more)'),
    exits: z.array(ExitRuleSchema).max(12).default([]).describe('Exit rules; precedence when several fire: fail > complete > pause > exhaust, then order'),
    carryInit: z
      .record(LoopNameSchema, ExprSchema)
      .optional()
      .describe('Initial carried values, evaluated once when the loop starts; a carry without one is null in iteration 0'),
    carry: z
      .record(LoopNameSchema, ExprSchema)
      .optional()
      .describe('Carried values, evaluated after each iteration all at once (each reads the previous carry: key order is irrelevant)'),
    carrySchema: z
      .record(LoopNameSchema, z.record(z.unknown()).describe('JSON Schema of the carried value'))
      .optional()
      .describe('Explicit types of carried values (otherwise inferred from their expressions)'),
    onLimit: LoopOnLimitSchema.default({ mode: 'pause' }),
    wrapUp: LoopWrapUpSchema.optional(),
    onBodyFailure: z
      .enum(['fail', 'next_iteration'])
      .default('fail')
      .describe('fail fails the loop when an iteration fails; next_iteration continues and exposes loop.last.failures'),
    checkpointEachIteration: z
      .boolean()
      .optional()
      .describe('Checkpoint the workspace after each iteration (accept_iteration, re-run from an iteration); on by default with accept_best'),
    output: z
      .object({
        select: z
          .record(LoopNameSchema, ExprSchema)
          .optional()
          .describe('Extra fields of the loop output, evaluated at exit (context E of the chosen iteration)'),
      })
      .strict()
      .default({})
      .describe('The loop output'),
  })
  .strict()
  .describe('Loop settings: bounds, exit rules, carried state and exhaustion');
export type LoopSpec = z.infer<typeof LoopSpecSchema>;

export const LoopStageSchema = z
  .object({
    ...stageBase,
    kind: z.literal('loop').describe('Repeat the body (the stages whose parentKey is this key) until a rule fires'),
    loop: LoopSpecSchema,
    budget: BudgetSchema.optional().describe('Cumulative budget of every iteration (a wrap-up has its own allowance)'),
  })
  .strict()
  .describe('Loop container stage');
export type LoopStage = z.infer<typeof LoopStageSchema>;

// ── map (P05 §4.1) ───────────────────────────────────────────────

export const MAP_WORKSPACES = ['shared', 'mount_per_item'] as const;
export const MAP_MERGES = ['none', 'sequential', 'pr_per_item'] as const;

export const MapSpecSchema = z
  .object({
    items: ExprSchema.describe('The list to fan out over (evaluated when the map starts, context T of its enclosing loops)'),
    itemKey: ExprSchema.optional().describe(
      'A stable key per item (a string, `item` bound); omitted means the index. Duplicate keys fail the map (map_duplicate_item_key)',
    ),
    maxItems: z.number().int().min(1).max(200).default(50).describe('More items than this fails the map (map_too_large)'),
    concurrency: z.number().int().min(1).max(16).default(4).describe('Items whose body runs at the same time'),
    toleratedFailurePercent: z
      .number()
      .min(0)
      .max(100)
      .default(0)
      .describe('Failed items tolerated, in percent of all items; above it the map fails'),
    workspace: z
      .enum(MAP_WORKSPACES)
      .default('shared')
      .describe(
        "shared: every item works in the run's mounts; mount_per_item: each item gets its own git worktree cut from a snapshot of the run mounts",
      ),
    merge: z
      .enum(MAP_MERGES)
      .default('none')
      .describe(
        'How item mounts come back (mount_per_item only): none keeps them; sequential merges each into the run mount; pr_per_item pushes a branch per item',
      ),
    itemSetup: z
      .array(CheckSpecSchema)
      .max(5)
      .optional()
      .describe('Commands run in each item mount before its body (for example pnpm install --offline); a failure fails the item'),
    output: z
      .object({
        select: z
          .record(z.string().regex(VARIABLE_NAME_PATTERN, 'An identifier').max(64), ExprSchema)
          .optional()
          .describe('Extra fields of every result entry, evaluated per item (the item and its body stages in scope)'),
      })
      .strict()
      .default({})
      .describe('The map output'),
  })
  .strict()
  .describe('Map settings: the list, bounds, tolerance, workspaces and merges');
export type MapSpec = z.infer<typeof MapSpecSchema>;

export const MapStageSchema = z
  .object({
    ...stageBase,
    kind: z.literal('map').describe('Run the body (the stages whose parentKey is this key) once per item of a runtime list'),
    map: MapSpecSchema,
    budget: BudgetSchema.optional().describe('Cumulative budget of every item'),
  })
  .strict()
  .describe('Map container stage');
export type MapStage = z.infer<typeof MapStageSchema>;

// ── sub-workflow (P05 §4.2) ──────────────────────────────────────

export const WorkflowRefSchema = z
  .union([
    z.object({ id: z.string().min(1).max(100).describe('Workflow definition id') }).strict().describe('By id'),
    z
      .object({
        name: z.string().min(1).max(200).describe('Workflow name (portable across export and import)'),
        projectScope: z
          .enum(['project', 'global'])
          .optional()
          .describe("project: the parent's project only; global: workflows without a project; omitted: the project first, then global"),
      })
      .strict()
      .describe('By name'),
  ])
  .describe('The child workflow; resolved at save and at invoke');
export type WorkflowRef = z.infer<typeof WorkflowRefSchema>;

export const SubworkflowSpecSchema = z
  .object({
    workflowRef: WorkflowRefSchema,
    version: z
      .union([z.literal('pin_at_run_start'), z.number().int().min(1)])
      .default('pin_at_run_start')
      .describe('pin_at_run_start: the published version current when the stage starts; a number pins that published version'),
    inputs: z
      .record(z.string().regex(VARIABLE_NAME_PATTERN, 'A variable name').max(64), ExprSchema)
      .default({})
      .describe("The child's variables, each an expression evaluated when the stage starts"),
    workspace: z
      .enum(['inherit', 'isolated'])
      .default('inherit')
      .describe(
        "inherit: the child works in the parent's mounts (its mounts and post-processing are skipped; the parent commits); isolated: a full child lifecycle",
      ),
  })
  .strict()
  .describe('Sub-workflow settings');
export type SubworkflowSpec = z.infer<typeof SubworkflowSpecSchema>;

export const SubworkflowStageSchema = z
  .object({
    ...stageBase,
    kind: z.literal('subworkflow').describe("Run another published workflow as this stage; its output is the child's declared outputs"),
    subworkflow: SubworkflowSpecSchema,
    budget: BudgetSchema.optional().describe("The child run's budget (its share of the parent's)"),
  })
  .strict()
  .describe('Sub-workflow stage');
export type SubworkflowStage = z.infer<typeof SubworkflowStageSchema>;

// ── wait (P05 §4.3) ──────────────────────────────────────────────

const waitTimeoutMs = z
  .number()
  .int()
  .min(1000)
  .max(2_592_000_000)
  .optional()
  .describe('Give up after this long (an unattended run without one expires after 72 h)');
const waitOnTimeout = z
  .enum(['fail', 'complete'])
  .default('fail')
  .describe('fail fails the stage (wait_timeout); complete completes it with outcome timeout (route on stages.<key>.output.outcome)');

export const WaitSpecSchema = z
  .discriminatedUnion('type', [
    z
      .object({
        type: z.literal('approval').describe('A person approves or rejects, optionally filling a form'),
        prompt: PromptDefinitionSchema.describe('What the approver is asked (a template)'),
        form: z.record(z.unknown()).optional().describe("JSON Schema of the approver's input (output.data)"),
        timeoutMs: waitTimeoutMs,
        onTimeout: waitOnTimeout,
      })
      .strict()
      .describe('Approval wait'),
    z
      .object({
        type: z.literal('event').describe('An external event: the deliver_event command or the per-wait callback URL'),
        eventKey: ExprSchema.describe("The event key to wait for (a string expression, for example concat('ci:', stages.push.output.sha))"),
        timeoutMs: waitTimeoutMs,
        onTimeout: waitOnTimeout,
      })
      .strict()
      .describe('Event wait'),
    z
      .object({
        type: z.literal('timer').describe('A fixed delay'),
        durationMs: z.number().int().min(1000).max(2_592_000_000).describe('How long to wait'),
      })
      .strict()
      .describe('Timer wait'),
  ])
  .describe('What the stage waits for; it holds no executor, lease or admission slot');
export type WaitSpec = z.infer<typeof WaitSpecSchema>;

export const WAIT_OUTCOMES = ['approved', 'rejected', 'event', 'timeout', 'elapsed'] as const;
export type WaitOutcome = (typeof WAIT_OUTCOMES)[number];

export const WaitStageSchema = z
  .object({
    ...stageBase,
    kind: z.literal('wait').describe('Wait for an approval, an external event or a timer; the output is {outcome, data, by, at}'),
    wait: WaitSpecSchema,
  })
  .strict()
  .describe('Wait stage');
export type WaitStage = z.infer<typeof WaitStageSchema>;

export const StageSpecSchema = z
  .discriminatedUnion('kind', [AgentStageSchema, CheckStageSchema, LoopStageSchema, MapStageSchema, SubworkflowStageSchema, WaitStageSchema])
  .describe('One stage of the workflow graph');
export type StageSpec = z.infer<typeof StageSpecSchema>;
export type StageKind = StageSpec['kind'];

/** Every stage kind the schema knows, in declaration order. */
export const STAGE_KINDS: readonly StageKind[] = ['agent', 'check', 'loop', 'map', 'subworkflow', 'wait'];

/** Container kinds own a body of child stages (`parentKey`); a sub-workflow's scope is its child run, not a body. */
export const CONTAINER_STAGE_KINDS: readonly string[] = ['loop', 'map'];

const KIND_SHAPES: Readonly<Record<string, Record<string, unknown>>> = {
  agent: AgentStageSchema.shape,
  check: CheckStageSchema.shape,
  loop: LoopStageSchema.shape,
  map: MapStageSchema.shape,
  subworkflow: SubworkflowStageSchema.shape,
  wait: WaitStageSchema.shape,
};

/** The fields each kind accepts beyond `stageBase` (P05 §1.3), for `field-not-applicable`. */
export function kindFields(kind: string): readonly string[] {
  const shape = KIND_SHAPES[kind];
  return shape ? Object.keys(shape) : [];
}

/** Templates of a stage, as JSON-pointer suffix → text (used by the validator and the builders). */
export function stageTemplateFields(stage: StageSpec): Array<{ pointer: string; text: string }> {
  const out: Array<{ pointer: string; text: string }> = [];
  switch (stage.kind) {
    case 'agent':
      stage.prompts.forEach((p, i) => out.push({ pointer: `/prompts/${i}/text`, text: p.text }));
      stage.followUpPrompts?.forEach((p, i) => out.push({ pointer: `/followUpPrompts/${i}/text`, text: p.text }));
      if (stage.approval?.prompt) out.push({ pointer: '/approval/prompt', text: stage.approval.prompt });
      if (stage.output.instructions) out.push({ pointer: '/output/instructions', text: stage.output.instructions });
      break;
    case 'check':
      for (const [name, text] of Object.entries(stage.check.env ?? {})) out.push({ pointer: `/check/env/${name}`, text });
      break;
    case 'loop':
      if (stage.loop.wrapUp) out.push({ pointer: '/loop/wrapUp/prompt/text', text: stage.loop.wrapUp.prompt.text });
      break;
    case 'map':
      stage.map.itemSetup?.forEach((c, i) => {
        for (const [name, text] of Object.entries(c.env ?? {})) out.push({ pointer: `/map/itemSetup/${i}/env/${name}`, text });
      });
      break;
    case 'wait':
      if (stage.wait.type === 'approval') out.push({ pointer: '/wait/prompt/text', text: stage.wait.prompt.text });
      break;
    case 'subworkflow':
      break;
  }
  return out;
}
