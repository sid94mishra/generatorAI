// ────────────────────────────────────────────────────────────────
// InvocationRequest, the trigger union, the plan and the run digest
// (P04 WP-4.2; G4 §1.3.3–1.3.4).
//
// The shapes live here so every client, the server route, the workflow
// tools and the generated schema share one definition;
// `WorkflowInvocationService` consumes them. The trigger is never taken
// from a request body: the server derives it and passes it in the trusted
// context. `RunProfileSchema` is the one saved-inputs shape (CLI profile
// files and the profiles a workflow script exports; C-10).
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';
import {
  FORBIDDEN_VARIABLE_NAME_PATTERN,
  HARNESS_PROVIDER_IDS,
  REASONING_EFFORTS,
  RUN_PERMISSION_MODES,
  type RunPermissionMode,
} from '../constants.js';
import { CodebaseAliasSchema, customIssue, StageKeySchema } from './common.js';

/** Caller-supplied variables. Engine-reserved names (`__*`, `repo_path_*`, `repo_branch_*`) are always refused (R-8). */
export const UserVariablesSchema = z
  .record(z.unknown())
  .superRefine((vars, ctx) => {
    for (const k of Object.keys(vars)) {
      if (FORBIDDEN_VARIABLE_NAME_PATTERN.test(k)) {
        customIssue(ctx, 'reserved-variable-name', 'Engine-reserved variable names (__*, repo_path_*, repo_branch_*) cannot be supplied by callers', [k]);
      }
    }
  })
  .describe('Variable values by name; engine-reserved names are refused');

export const InvocationTargetSchema = z
  .discriminatedUnion('kind', [
    z
      .object({
        kind: z.literal('definition').describe('Run a saved workflow definition'),
        workflowDefinitionId: z.string().uuid().describe('Definition id'),
        version: z.number().int().min(1).optional().describe('Published version; omitted means the current published version'),
        testRun: z.boolean().optional().describe('Run the draft as a test version (user principals only)'),
      })
      .strict()
      .describe('Definition target'),
    z
      .object({
        kind: z.literal('script').describe('Materialize (once per script content) and run a workflow script'),
        scriptId: z.string().min(1).max(200).describe('Script id'),
      })
      .strict()
      .describe('Script target'),
    z
      .object({
        kind: z.literal('fork').describe('Fork an earlier run, re-running from the given instances'),
        sourceRunId: z.string().min(1).max(100).describe('Run to fork'),
        rerunFrom: z
          .array(z.string().min(1).max(500))
          .max(50)
          .optional()
          .describe('Instance paths to re-run from; omitted means the failed instances'),
        definition: z.enum(['pinned', 'latest']).default('pinned').describe('Definition version of the fork'),
        workspace: z
          .enum(['restore_checkpoint', 'reuse', 'fresh'])
          .default('fresh')
          .describe('fresh provisions a new workspace; reuse runs in the source one; restore_checkpoint reuses it rolled back to before the earliest re-run instance'),
      })
      .strict()
      .describe('Fork target'),
  ])
  .describe('What to run');

export const CodebaseSelectionSchema = z
  .object({
    alias: CodebaseAliasSchema,
    baseRef: z.string().max(200).optional().describe('Branch or ref the mount is cut from; omitted means the default branch'),
    mode: z
      .enum(['worktree', 'in_place'])
      .default('worktree')
      .describe('worktree: isolated; in_place: edits the checkout (requires admin:settings)'),
  })
  .strict()
  .describe('A codebase the run mounts');

export const InvocationStageOverrideSchema = z
  .object({
    stageKey: StageKeySchema.describe('Stage to override'),
    skip: z.boolean().optional().describe('Skip the stage for this run'),
    variables: UserVariablesSchema.optional(),
    model: z.string().max(200).optional().describe('Model for this stage in this run'),
  })
  .strict()
  .describe('Per-stage override for one run');

export const RunOverridesSchema = z
  .object({
    model: z.string().max(200).optional().describe('Model for every stage without its own'),
    harnessType: z.enum(HARNESS_PROVIDER_IDS).optional().describe('Agent provider'),
    reasoningEffort: z.enum(REASONING_EFFORTS).optional().describe('Reasoning effort'),
    permissionMode: z.enum(RUN_PERMISSION_MODES).optional().describe('Permission mode; capped by the caller ceiling'),
  })
  .strict()
  .describe('Run-wide overrides');

export const InvocationBudgetSchema = z
  .object({
    maxDurationMs: z.number().int().min(10_000).max(86_400_000).optional().describe('Wall clock for the whole run'),
    maxChildRuns: z.number().int().min(0).max(50).optional().describe('Nested invocations this run and its descendants may make'),
    maxTokens: z.number().int().positive().optional().describe('Token budget'),
    maxCostUsd: z.number().positive().max(100_000).optional().describe('Cost budget in USD'),
  })
  .strict()
  .describe('Run budget');

export const INVOCATION_CLIENTS = ['web', 'desktop', 'mobile', 'cli', 'tui', 'sdk', 'mcp', 'http'] as const;

export const InvocationRequestSchema = z
  .object({
    target: InvocationTargetSchema,
    variables: UserVariablesSchema.default({}),
    projectId: z.string().uuid().optional().describe('Project whose codebases the run may mount'),
    codebases: z.array(CodebaseSelectionSchema).max(10).optional().describe('Codebases to mount; omitted means lifecycle.codebaseAliases'),
    stageOverrides: z.array(InvocationStageOverrideSchema).max(100).optional().describe('Per-stage overrides, by stage key'),
    overrides: RunOverridesSchema.optional(),
    uploads: z
      .array(
        z
          .object({
            uploadId: z.string().min(1).max(100).describe('Id returned by the uploads endpoint'),
            category: z.enum(['skills', 'agents', 'prompts']).describe('Upload category'),
          })
          .strict()
          .describe('A staged upload'),
      )
      .max(60)
      .optional()
      .describe('Files staged before the run starts'),
    profile: z
      .string()
      .max(200)
      .optional()
      .describe("A script target's exported run profile; this request's own inputs win over it"),
    name: z.string().max(200).optional().describe('Run name'),
    budget: InvocationBudgetSchema.optional(),
    idempotencyKey: z
      .string()
      .regex(/^[!-~]{1,200}$/)
      .optional()
      .describe('Replays return the same run; for clients that cannot send the Idempotency-Key header'),
    client: z.enum(INVOCATION_CLIENTS).optional().describe('Client label; the server decides the trigger'),
  })
  .strict()
  .describe('The one request that starts a workflow run');
export type InvocationRequest = z.infer<typeof InvocationRequestSchema>;

export const InvocationTriggerSchema = z
  .discriminatedUnion('kind', [
    z
      .object({
        kind: z.literal('user').describe('A person, through a client'),
        client: z.string().max(50).describe('Client label'),
        principalId: z.string().max(200).describe('Authenticated principal'),
      })
      .strict()
      .describe('User trigger'),
    z
      .object({
        kind: z.literal('automation').describe('An automation'),
        automationId: z.string().max(100).describe('Automation id'),
        executionId: z.string().max(100).describe('Automation execution id'),
        via: z.enum(['manual', 'schedule', 'webhook']).describe('What fired the automation'),
        iterationIndex: z.number().int().min(0).optional().describe('Dataset iteration'),
      })
      .strict()
      .describe('Automation trigger'),
    z
      .object({
        kind: z.literal('chat').describe('A chat tool call'),
        chatId: z.string().max(100).describe('Chat id'),
        turnId: z.string().max(100).optional().describe('Chat turn'),
        toolCallId: z.string().max(200).optional().describe('Tool call'),
      })
      .strict()
      .describe('Chat trigger'),
    z
      .object({
        kind: z.literal('orchestrator').describe('An orchestrator chat'),
        chatId: z.string().max(100).describe('Orchestrator chat id'),
        taskId: z.string().max(100).optional().describe('Orchestrator task'),
        toolCallId: z.string().max(200).optional().describe('Tool call'),
      })
      .strict()
      .describe('Orchestrator trigger'),
    z
      .object({
        kind: z.literal('stage').describe('A sub-workflow stage or a stage tool call'),
        runId: z.string().max(100).describe('Parent run'),
        stageRunId: z.string().max(100).describe('Parent stage instance'),
        toolCallId: z.string().max(200).optional().describe('Tool call, when a stage agent invoked it'),
      })
      .strict()
      .describe('Stage trigger'),
    z
      .object({
        kind: z.literal('external_agent').describe('An external agent'),
        via: z.enum(['mcp', 'http', 'sdk']).describe('Channel'),
        clientName: z.string().max(200).optional().describe('Client name'),
        principalId: z.string().max(200).describe('Authenticated principal'),
      })
      .strict()
      .describe('External agent trigger'),
    z
      .object({
        kind: z.literal('fork').describe('A fork of an earlier run'),
        sourceRunId: z.string().max(100).describe('Forked run'),
        principalId: z.string().max(200).describe('Principal that asked for the fork'),
      })
      .strict()
      .describe('Fork trigger'),
  ])
  .describe('Who or what started the run; server-derived, never read from a request body');
export type InvocationTrigger = z.infer<typeof InvocationTriggerSchema>;

/** Error codes of the invocation API's `{error: {code, message, issues[]}}` envelope. */
export const INVOCATION_ERROR_CODES = [
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'IDEMPOTENCY_KEY_REUSED',
  'DEPTH_LIMIT',
  'RECURSION',
  'BUDGET_EXHAUSTED',
  'PERMISSION_ESCALATION',
  'PERMISSION_GATING_UNSUPPORTED',
  'CODEBASE_REQUIRED',
  'DRAFT_NOT_RUNNABLE',
  'FORBIDDEN_SCOPE',
  'CONFLICT',
  'ENGINE_UNAVAILABLE',
] as const;
export type InvocationErrorCode = (typeof INVOCATION_ERROR_CODES)[number];

/** One problem with a request (`path` is the JSON path into the request). */
export interface InvocationIssue {
  code: string;
  path: Array<string | number>;
  message: string;
  severity: 'error' | 'warning';
}

/** A run started by a stage of another run is at most this deep (the root run is depth 0). */
export const MAX_INVOCATION_DEPTH = 3;

/** The lifecycle phases, in order (`workflow_run.phase_*` events; journalled as `lifecycle/<phase>`). */
export const PREPARE_PHASES = ['workspace', 'worktrees', 'uploads', 'projectConfigs', 'preprocess', 'sandbox'] as const;
export type PreparePhase = (typeof PREPARE_PHASES)[number];
export const FINALIZE_PHASES = ['compensate', 'hooks', 'postProcess', 'release'] as const;
export type FinalizePhase = (typeof FINALIZE_PHASES)[number];

/** What an invocation will do, computed before anything is written (`plan`, and part of `invoke`'s result). */
export interface InvocationPlan {
  workflowDefinitionId: string;
  /** The version the run pins (`null` when planning a script that is not materialized yet). */
  definitionVersionId: string | null;
  workflowName: string;
  stages: Array<{
    key: string;
    name: string;
    /** Topological layer (0 = roots). */
    layer: number;
    skipped: boolean;
    skipReason?: 'override' | 'guard_false';
    model?: string;
    harnessType?: string;
    agentRef?: string;
    /** A completion review parks the stage for a person. */
    approvalRequired: boolean;
    kind: string;
    /** The enclosing container (loop body stages). */
    parentKey?: string;
  }>;
  /**
   * What the run may do that deserves a look before it starts. `runs_repo_code`:
   * check stages execute repository code an agent may have just edited (the run
   * capability `shell`, P05 §1.2).
   */
  risks: Array<{ code: 'runs_repo_code'; stageKeys: string[]; message: string }>;
  codebases: Array<{ alias: string; baseRef: string | null; mode: 'worktree' | 'in_place'; source: 'request' | 'lifecycle' }>;
  /** Prepare phases with work to do, in order. */
  prepare: PreparePhase[];
  preprocessing: string[];
  postProcessing: string[];
  permissionMode: RunPermissionMode;
  lineage: { depth: number; rootRunId: string | null; parentRunId: string | null };
  warnings: InvocationIssue[];
}

/** What `invoke` answers (202). A replayed idempotency key answers the original run with `replayed: true`. */
export interface InvocationResult {
  invocationId: string;
  runId: string;
  workflowDefinitionId: string;
  status: 'created' | 'starting';
  replayed: boolean;
  trigger: InvocationTrigger;
  links: { app: string; api: string; stream: string };
  plan: InvocationPlan;
  warnings: InvocationIssue[];
}

/** A compact run state for waiters and agents (`digest`, the long-poll route, `waitFor`). */
export interface RunDigest {
  runId: string;
  workflowDefinitionId: string;
  name: string;
  status: string;
  statusReason: string | null;
  outcome: 'completed' | 'failed' | 'cancelled' | null;
  /** True once `workflow_run.finalized` fired: post-processing and release are done. */
  finalized: boolean;
  error: string | null;
  stages: Array<{
    instanceId: string;
    key: string;
    instancePath: string;
    name: string;
    status: string;
    statusReason: string | null;
    summary?: string | null;
    output?: unknown;
    error?: string | null;
  }>;
  /** Instances waiting for a person (a completion review or an in-turn gate). */
  /**
   * Decisions the run waits on: completion reviews, in-turn gates, parked
   * loops, approval and event waits — a sub-workflow child's too (`runId` is
   * then the child run that owns the instance; P05 §4.2).
   */
  pendingApprovals: Array<{ instanceId: string; key: string; name: string; kind?: string; runId?: string }>;
  /** Post-processing step results, once finalized. */
  postProcessing: Array<{ step: string; success: boolean; output?: string; error?: string }>;
  /** Why a waiter returned. */
  waited?: 'finalized' | 'approval' | 'timeout' | 'aborted';
}

// ── Run profiles (C-10) ───────────────────────────────────────────

/**
 * Saved run inputs: a CLI profile file (`--profile <path>`) or a profile a
 * workflow script exports. Stage overrides are by stage KEY. Upload paths
 * are local to the client that reads the profile.
 */
export const RunProfileSchema = z
  .object({
    version: z.literal(2).default(2).describe('Profile format version'),
    name: z.string().min(1).max(100).describe('Profile name'),
    description: z.string().max(2000).optional().describe('What the profile is for'),
    workflow: z.string().min(1).max(200).optional().describe('Workflow definition id or name the profile is for'),
    runName: z.string().max(200).optional().describe('Run name'),
    variables: UserVariablesSchema.default({}),
    projectId: z.string().uuid().optional().describe('Project whose codebases the run may mount'),
    codebases: z.array(CodebaseSelectionSchema).max(10).optional().describe('Codebases to mount'),
    stageOverrides: z.array(InvocationStageOverrideSchema).max(100).optional().describe('Per-stage overrides, by stage key'),
    overrides: RunOverridesSchema.optional(),
    budget: InvocationBudgetSchema.optional(),
    skillFiles: z.array(z.string().min(1).max(1000)).max(20).optional().describe('Skill files to upload (client-local paths)'),
    agentFiles: z.array(z.string().min(1).max(1000)).max(20).optional().describe('Agent files to upload (client-local paths)'),
    promptFiles: z.array(z.string().min(1).max(1000)).max(20).optional().describe('Prompt files to upload (client-local paths)'),
  })
  .strict()
  .describe('Saved run inputs');
export type RunProfile = z.infer<typeof RunProfileSchema>;
export type RunProfileInput = z.input<typeof RunProfileSchema>;
