// ────────────────────────────────────────────────────────────────
// Automation — Types for automation definitions and executions
// ────────────────────────────────────────────────────────────────

/** How the automation is triggered */
export type AutomationTriggerType = 'manual' | 'schedule' | 'webhook';

/** Raw dataset format understood by `parseBatchData` */
export type BatchDataFormat = 'json' | 'csv' | 'jsonl';

/** Parsed dataset — result of parsing a raw CSV / JSON / JSONL dataset */
export interface ParsedBatchData {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

/** What to do when a workflow run in the batch fails */
export type AutomationErrorPolicy = 'continue' | 'stop';

/**
 * Automation execution status. `partial` = the run finished with BOTH
 * successes and failures; it is alerted through the same channel as
 * `failed` so unattended operation never reports a mostly-failed batch
 * as a success.
 */
export type AutomationExecutionStatus = 'pending' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';

/** What the scheduler does with slots that elapsed while nobody could run them. */
export type AutomationMissedRunPolicy = 'skip' | 'run_once';

/** What the scheduler does when a slot is due while a previous execution is still running. */
export type AutomationOverlapPolicy = 'skip' | 'queue';

/** Individual run status within an execution */
export type AutomationRunItemStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Retry policy applied to a single iteration (per workflow-run within
 * an iteration). When `maxAttempts <= 1`, retries are disabled — this
 * is the default. Retries only fire for errors matching `retryOn`.
 */
export interface AutomationRetryPolicy {
  /** 1 = no retry. Applied per (iteration × workflow). Default: 1. */
  maxAttempts: number;
  /** Delay before first retry, in ms. Default: 1000. */
  initialBackoffMs: number;
  /** Backoff multiplier between successive retries. Default: 2. */
  backoffMultiplier: number;
  /** Ceiling for the backoff delay. Default: 60_000. */
  maxBackoffMs: number;
  /** Which error classes should trigger a retry. Errors not on this
   *  list fail the iteration immediately even if attempts remain. */
  retryOn: Array<'timeout' | 'network' | 'workflow_failed'>;
}

// Re-export new schema types so consumers can import from a single module.
export type {
  DataFieldType,
  DataFieldDef,
  DataSchema,
  IterationMode,
  AutomationDataset,
  PlannedIterations,
  IterationPreview,
} from './DataSchema.js';
import type {
  DataSchema,
  IterationMode,
  AutomationDataset,
} from './DataSchema.js';

/** Automation domain entity — a reusable automation configuration */
export interface Automation {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;

  /** How the automation is triggered */
  triggerType: AutomationTriggerType;

  /** Cron expression for schedule triggers (e.g. "0 9 * * *") */
  cronExpression?: string;

  /** IANA timezone the cron expression is evaluated in. Default: server zone. */
  timezone?: string;

  /** Catch-up policy for slots missed while the server was down. Default `skip`. */
  missedRunPolicy?: AutomationMissedRunPolicy;

  /** Overlap policy when a slot is due mid-execution. Default `skip`. */
  overlapPolicy?: AutomationOverlapPolicy;

  /**
   * Raw webhook token. ONLY populated on the response to create /
   * rotate-webhook-token — it is never persisted (only its sha256 is)
   * and never returned by list/get.
   */
  webhookToken?: string;

  /**
   * Raw webhook signing secret (HMAC key for `X-Signature-256`). Same
   * one-time semantics as `webhookToken`; the value lives in the vault.
   */
  webhookSecret?: string;

  /** sha256(webhookToken), the persisted lookup key. Stripped from API responses. */
  webhookTokenHash?: string;

  /** Ordered list of workflow definition IDs to execute sequentially */
  workflowIds: string[];

  /** Base variables merged into every workflow run */
  variables: Record<string, unknown>;

  /** Max concurrent iterations */
  maxConcurrency: number;

  /** Error policy for batch processing */
  onError: AutomationErrorPolicy;

  /** Project ID — scopes this automation to a project (null = global) */
  projectId?: string;

  /** Whether to create worktrees for project codebases during execution */
  useWorktree?: boolean;

  // ── Schema-driven fields (new; Track C) ──

  /**
   * Optional row schema. When present, the dataset supplied at trigger
   * time (or `defaultDataset`) is validated against `dataSchema` and
   * expanded via `iterationMode`. When null, each trigger runs the
   * workflows once with the base `variables`.
   */
  dataSchema?: DataSchema;

  /** How rows should be grouped into iterations. Only meaningful when
   *  `dataSchema` is set. */
  iterationMode?: IterationMode;

  /** Dataset used for schedule triggers and as fallback for manual
   *  triggers that don't supply data. Snapshot updated when the user
   *  clicks "Save as default" from the manual-trigger modal. */
  defaultDataset?: AutomationDataset;

  /** Per-iteration retry policy. Null means "no retry" (default). */
  retryPolicy?: AutomationRetryPolicy;

  lastRunAt?: Date;
  /**
   * Next scheduled firing, written on create / update / enable / fire by
   * the scheduler and read by the due-row poller. Null for non-schedule
   * or disabled automations.
   */
  nextRunAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** Automation execution — one trigger invocation of an automation */
export interface AutomationExecution {
  id: string;
  automationId: string;
  status: AutomationExecutionStatus;
  triggeredBy: AutomationTriggerType;
  webhookPayload?: string;
  /** Workspace ID — links to the execution workspace for this automation execution */
  workspaceId?: string;
  totalIterations: number;
  completedIterations: number;
  failedIterations: number;
  error?: string;
  /**
   * Audit snapshot of the dataset used for this run (Track C).
   * Set when the automation ran with `dataSchema`; null for an
   * automation without one. Persisted so the UI can show "exactly what ran" and
   * users can re-run with the same input.
   */
  datasetSnapshot?: AutomationDataset;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
}

/** Link between an execution and individual workflow runs */
export interface AutomationExecutionRun {
  id: string;
  executionId: string;
  workflowRunId: string;
  workflowDefinitionId: string;
  iterationIndex: number;
  /** Snapshot of variables used for this specific iteration (for debugging/auditing) */
  iterationVariables?: Record<string, unknown>;
  /** Human-readable label for this iteration (e.g. column value or row summary) */
  iterationLabel?: string;
  status: AutomationRunItemStatus;
  /**
   * How many attempts this iteration/workflow pair has consumed. 1 =
   * first attempt succeeded or failed non-retryably; N > 1 means we
   * retried (N-1) times. Tracked so UI can show "attempt 3 of 5".
   */
  attemptCount?: number;
  createdAt: Date;
}

/** Execution with its linked runs */
export interface AutomationExecutionWithRuns extends AutomationExecution {
  runs: AutomationExecutionRun[];
}

/** Automation with recent executions */
export interface AutomationWithExecutions extends Automation {
  executions: AutomationExecution[];
}

/** Params for creating an automation */
export interface CreateAutomationParams {
  name: string;
  description?: string;
  triggerType: AutomationTriggerType;
  cronExpression?: string;
  timezone?: string;
  missedRunPolicy?: AutomationMissedRunPolicy;
  overlapPolicy?: AutomationOverlapPolicy;
  workflowIds: string[];
  variables?: Record<string, unknown>;
  maxConcurrency?: number;
  onError?: AutomationErrorPolicy;
  /** Project ID — scopes this automation to a project */
  projectId?: string;
  /** Whether to create worktrees for project codebases during execution */
  useWorktree?: boolean;
  // ── Track C — schema-driven pipeline ──
  dataSchema?: DataSchema;
  iterationMode?: IterationMode;
  defaultDataset?: AutomationDataset;
  retryPolicy?: AutomationRetryPolicy;
}
/** Params for updating an automation */
export interface UpdateAutomationParams {
  name?: string;
  description?: string;
  triggerType?: AutomationTriggerType;
  cronExpression?: string;
  timezone?: string | null;
  missedRunPolicy?: AutomationMissedRunPolicy;
  overlapPolicy?: AutomationOverlapPolicy;
  workflowIds?: string[];
  variables?: Record<string, unknown>;
  maxConcurrency?: number;
  onError?: AutomationErrorPolicy;
  projectId?: string;
  useWorktree?: boolean;
  // ── Track C ──
  dataSchema?: DataSchema | null;
  iterationMode?: IterationMode | null;
  defaultDataset?: AutomationDataset | null;
  retryPolicy?: AutomationRetryPolicy | null;
}

/** Body of `POST /api/automations/:id/trigger`. Optional dataset
 *  overrides `defaultDataset` for this one run. */
export interface TriggerAutomationBody {
  dataset?: AutomationDataset;
  /** When true, `dataset` is also persisted as `defaultDataset` on the
   *  automation so subsequent cron / manual runs pick it up. */
  saveAsDefault?: boolean;
}