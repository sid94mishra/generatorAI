// ────────────────────────────────────────────────────────────────
// Automation — Types for automation definitions and executions
// ────────────────────────────────────────────────────────────────

/** How the automation is triggered */
export type AutomationTriggerType = 'manual' | 'schedule' | 'webhook';

/** How inputs are processed */
export type AutomationInputMode = 'single' | 'loop' | 'batch' | 'script';

/** Data format for batch input */
export type BatchDataFormat = 'json' | 'csv' | 'jsonl';

/** Parsed batch data — result of parsing raw batch input */
export interface ParsedBatchData {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

// ── Dynamic Data Source (E1) ──

/** Type of dynamic data source */
export type DataSourceType = 'static' | 'script' | 'http' | 'file' | 'workflow_script';

/** Output format expected from a data source script/file */
export type DataSourceOutputFormat = 'json_array' | 'csv' | 'jsonl';

/** Configuration for a script-based data source */
export interface ScriptDataSourceConfig {
  type: 'script';
  /** Shell command to execute (e.g. "python fetch_jira.py") */
  command: string;
  /** Working directory for the script (default: system temp) */
  workingDirectory?: string;
  /** Max execution time in ms (default: 60000) */
  timeout?: number;
  /** Expected output format on stdout (default: json_array) */
  outputFormat?: DataSourceOutputFormat;
  /** Environment variables to pass to the script */
  env?: Record<string, string>;
  /** Optional schema validation for the output */
  schema?: DataSourceSchema;
}

/** Configuration for an HTTP-based data source */
export interface HttpDataSourceConfig {
  type: 'http';
  /** URL to fetch (supports {{variable}} interpolation) */
  url: string;
  /** HTTP method (default: GET) */
  method?: 'GET' | 'POST';
  /** Request headers */
  headers?: Record<string, string>;
  /** Request body (for POST) */
  body?: string;
  /** JSONPath-like expression to extract array from response (e.g. ".issues" or ".data.items") */
  resultPath?: string;
  /** Max response time in ms (default: 30000) */
  timeout?: number;
  /** Optional schema validation */
  schema?: DataSourceSchema;
}

/** Configuration for a file-based data source */
export interface FileDataSourceConfig {
  type: 'file';
  /** Path to the file to read */
  filePath: string;
  /** File format (default: json_array) */
  format?: DataSourceOutputFormat;
  /** Optional schema validation */
  schema?: DataSourceSchema;
}

/** Static data source — existing behavior (no dynamic resolution) */
export interface StaticDataSourceConfig {
  type: 'static';
}

/** Workflow script data source — uses a .workflow.mjs script's profiles for iteration */
export interface WorkflowScriptDataSourceConfig {
  type: 'workflow_script';
  /** ID of the workflow script */
  scriptId: string;
  /** Profile name to use (optional — uses default if omitted) */
  profileName?: string;
  /** Key in the profile's variables to iterate over */
  iterationVariable?: string;
}

/** Schema validation for data source output */
export interface DataSourceSchema {
  /** Required field names that must exist in each row */
  requiredFields?: string[];
  /** Maximum number of items allowed */
  maxItems?: number;
}

/** Union of all data source configurations */
export type DataSourceConfig =
  | StaticDataSourceConfig
  | ScriptDataSourceConfig
  | HttpDataSourceConfig
  | FileDataSourceConfig
  | WorkflowScriptDataSourceConfig;

/** Result of testing a data source */
export interface DataSourceTestResult {
  success: boolean;
  /** Preview of first N rows */
  preview?: ParsedBatchData;
  /** Total row count */
  totalCount?: number;
  /** Execution time in ms */
  durationMs?: number;
  /** Error message if failed */
  error?: string;
}

/** What to do when a workflow run in the batch fails */
export type AutomationErrorPolicy = 'continue' | 'stop';

/** Automation execution status */
export type AutomationExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

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

  /** Unique token for webhook authentication */
  webhookToken?: string;

  /** Ordered list of workflow definition IDs to execute sequentially */
  workflowIds: string[];

  /** Whether to run once (single) or iterate over loopItems (loop) */
  inputMode: AutomationInputMode;

  /** Variable name to substitute in each loop iteration */
  loopVariable?: string;

  /** Array of values for loop iterations — each becomes the loopVariable value */
  loopItems?: unknown[];

  /** Base variables merged into every workflow run */
  variables: Record<string, unknown>;

  // ── Batch mode fields ──

  /** Format of the batch data source (json array of objects, csv, jsonl) */
  batchDataFormat?: BatchDataFormat;

  /** Raw batch data text — CSV text, JSON array, or JSONL lines */
  batchData?: string;

  /** Detected/configured column names from the batch data */
  batchColumns?: string[];

  /** Column-to-workflow-variable mapping overrides. Key = column name, Value = variable name.
   *  Unmapped columns pass through with their original names. */
  batchColumnMapping?: Record<string, string>;

  // ── Dynamic Data Source fields ──

  /** Dynamic data source configuration (E1) — overrides static batch/loop data at execution time */
  dataSourceConfig?: DataSourceConfig;

  /** Max concurrent workflow runs (for loop/batch mode) */
  maxConcurrency: number;

  /** Error policy for batch processing */
  onError: AutomationErrorPolicy;

  /** Project ID — scopes this automation to a project (null = global) */
  projectId?: string;

  /** Whether to create worktrees for project codebases during execution */
  useWorktree?: boolean;

  // ── Schema-driven fields (new; Track C) ──

  /**
   * Optional row schema. When present, the automation uses the new
   * schema-driven pipeline: dataset supplied at trigger time is
   * validated against `dataSchema` and expanded via `iterationMode`.
   * When null, legacy `inputMode`/`loopItems`/`batchData` are used
   * (compatibility shim in `AutomationService`).
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
   * Set when the automation ran with `dataSchema`; null for legacy
   * automations. Persisted so the UI can show "exactly what ran" and
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
  workflowIds: string[];
  /** Legacy — required when `dataSchema` is absent. Ignored otherwise. */
  inputMode: AutomationInputMode;
  loopVariable?: string;
  loopItems?: unknown[];
  batchDataFormat?: BatchDataFormat;
  batchData?: string;
  batchColumns?: string[];
  batchColumnMapping?: Record<string, string>;
  dataSourceConfig?: DataSourceConfig;
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
  workflowIds?: string[];
  inputMode?: AutomationInputMode;
  loopVariable?: string;
  loopItems?: unknown[];
  batchDataFormat?: BatchDataFormat;
  batchData?: string;
  batchColumns?: string[];
  batchColumnMapping?: Record<string, string>;
  dataSourceConfig?: DataSourceConfig;
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