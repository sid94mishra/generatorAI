// ────────────────────────────────────────────────────────────────
// WorkflowRun + StageRun — Runtime execution instances (v2)
// ────────────────────────────────────────────────────────────────

/**
 * How the v1 engine allocates sessions across a run's stages. A run starts
 * `auto` and resolves it from the graph shape (linear → `single`, any
 * parallelism → `per-stage`); stage session groups replace this in the
 * engine upgrade.
 */
export type WorkflowSessionMode = 'single' | 'per-stage' | 'auto';

/** Artifact manifest entry — a file a stage created or modified. */
export interface ArtifactManifestEntry {
  path: string;
  language: string;
  action: 'created' | 'modified';
  sizeBytes: number;
}

/** WorkflowRun lifecycle statuses */
export type WorkflowRunStatus =
  | 'created'
  | 'starting'
  | 'running'
  | 'paused'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** StageRun lifecycle statuses */
export type StageRunStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'skipped'
  /**
   * HITL-01 — the stage is paused waiting for a human approver to supply
   * a value via `POST /api/workflow-runs/:runId/stages/:stageId/resume`.
   * The payload needed for the approval (tool args, free-form prompt,
   * permission request, etc.) is persisted in `stage_runs.interrupt_data`
   * so a restart shows the same queue. Transitions back to `running` via
   * `sys:input_received`.
   */
  | 'awaiting_input';

/**
 * HITL + TOL-04 — permission mode for tool + interrupt prompts.
 *
 * Default is `bypassPermissions`: GeneratorAI runs fully autonomous and
 * silently approves every tool call, matching the "it just works" UX
 * the product is opinionated about. Users opt in to human-in-the-loop
 * by flipping the mode (via UI dropdown, CLI flag, or runtime API).
 *
 * - `bypassPermissions` — all requests auto-allow (DEFAULT).
 * - `default`           — rules decide; unmatched requests surface via `awaiting_input`.
 * - `acceptEdits`       — auto-allow file writes; prompt for everything else.
 * - `plan`              — every tool call becomes `awaiting_input` so the
 *                         agent surfaces its plan before executing anything.
 */
export type WorkflowRunPermissionMode =
  | 'bypassPermissions'
  | 'default'
  | 'acceptEdits'
  | 'plan';

export const DEFAULT_WORKFLOW_RUN_PERMISSION_MODE: WorkflowRunPermissionMode = 'bypassPermissions';

/** WorkflowRun domain entity — one execution instance of a WorkflowDefinition */
export interface WorkflowRun {
  id: string;
  workflowDefinitionId: string;
  /**
   * The immutable definition version this run executes (W-13). The engine
   * reads the version's `WorkflowGraph`; nothing it does reads the live
   * definition, so editing a definition never changes a run in flight.
   */
  definitionVersionId: string;
  name: string;
  status: WorkflowRunStatus;
  sessionMode: WorkflowSessionMode;
  variables: Record<string, unknown>;
  error?: string;
  /**
   * HITL + TOL-04 — per-run permission mode. Persisted so (a) a restarted
   * server restores the user's choice, (b) the UI/CLI can query current
   * mode without racing config state, (c) an audit trail shows what mode
   * was active during execution.
   *
   * `undefined` on runs created before this column landed is treated as
   * `bypassPermissions` (the default) by the evaluator.
   */
  permissionMode?: WorkflowRunPermissionMode;
  /** Workspace ID — links to the execution workspace for this run */
  workspaceId?: string;
  /**
   * W23 — Run identity model (X-24 fix).
   *
   * When the user retries a failed run, a NEW run is created rather than
   * mutating the terminal record. `ancestorRunId` points to the run this
   * was created from (the failed one, or an earlier ancestor in a retry
   * chain). This establishes an immutable audit chain so:
   *
   *   - A terminal run (failed/cancelled/completed) is never mutated.
   *   - "Retry" is always additive — the original run stays permanently
   *     queryable as the lineage root.
   *   - Parallel follow-ups are possible (two retry runs branching from
   *     the same ancestor).
   *
   * Absent on first-attempt runs (undefined).
   */
  ancestorRunId?: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

/** StageRun domain entity — one execution instance of a stage within a workflow run */
export interface StageRun {
  id: string;
  workflowRunId: string;
  /** Key of the stage in the run's pinned definition version. */
  stageKey: string;
  sessionId?: string;
  name: string;
  status: StageRunStatus;
  currentStep: number;
  totalSteps: number;
  retryCount: number;
  /**
   * Phase 1, 1.25 — optimistic-lock version. Bumped on every mutation;
   * callers pass the last-seen value to conditional updates (e.g.
   * `incrementRetryCount(id, version)`) to avoid racing another process.
   */
  version: number;
  error?: string;
  /** Auto-generated summary of the work done in this stage, used to pass context to successor stages */
  summary?: string;
  /**
   * Full raw output text produced by the stage's main prompt(s), captured before
   * the summary turn. Persisted so a successor stage with `context.mode: 'output'`
   * can receive the predecessor's complete output (not just the condensed
   * summary). May be large; only injected when a downstream stage opts into it.
   */
  outputText?: string;
  /** Validated structured output JSON matching the stage's outputSchema */
  outputData?: Record<string, unknown>;
  /** Manifest of files created/modified by this stage */
  artifactManifest?: Array<{ path: string; language: string; action: string; sizeBytes: number }>;
  /**
   * HITL-02 — opaque payload the stage asked an approver for. Set when
   * the stage enters `awaiting_input`; cleared on resume. Shape is
   * stage-defined (tool-call args for approval prompts, free-form data
   * for user-input requests, etc.). Persisted so reconnecting web/CLI
   * clients can re-render the pending request.
   */
  interruptData?: unknown;
  /**
   * WS-D1 — last liveness beat written by the executor while the stage is
   * `queued`/`running`. The run reconciler fails a stage whose beat is older
   * than the configured stale window, which is the only reaper that still
   * works when the process that was running the stage is gone.
   */
  heartbeatAt?: Date;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

/** Compound type: WorkflowRun with all its StageRuns */
export interface WorkflowRunWithStages extends WorkflowRun {
  stageRuns: StageRun[];
}

/** Parameters for creating a WorkflowRun */
export interface CreateWorkflowRunParams {
  workflowDefinitionId: string;
  variables?: Record<string, unknown>;
  projectId?: string;
  /**
   * W23: When this run was created by retrying a terminal run, supply the
   * id of the failed/cancelled ancestor. Absent on first-attempt runs.
   */
  ancestorRunId?: string;
  /**
   * The version to run. Omitted: the definition's current published version
   * (or, with `testRun`, a test version of its working graph). A retry
   * passes its ancestor's version so copied stage results line up.
   */
  definitionVersionId?: string;
  /** Run the working graph as a `test` version (the only way to run a draft). */
  testRun?: boolean;
  /** Per-stage overrides for this run, by stage key. */
  stageOverrides?: Array<{ stageKey: string; skip?: boolean; variables?: Record<string, unknown> }>;
  /** What started the run (an automation trigger); a scheduled run never inherits an execution context. */
  triggeredBy?: string;
}

// ────────────────────────────────────────────────────────────────
// RunScratchpad — Aggregate output file for a workflow run
// Written to disk as JSON at: {executionDir}/scratchpad.json
// ────────────────────────────────────────────────────────────────

/** A single stage's output entry in the scratchpad */
export interface RunScratchpadEntry {
  stageName: string;
  stageKey: string;
  stageRunId: string;
  status: 'pending' | 'completed' | 'failed' | 'skipped';
  outputFormat: 'text' | 'json';
  /** The stage output: text summary or structured JSON object */
  output: string | Record<string, unknown> | null;
  completedAt?: string;
}

/** Per-run scratchpad tracking all stages' outputs in a single file */
export interface RunScratchpad {
  workflowRunId: string;
  workflowName: string;
  entries: RunScratchpadEntry[];
  lastUpdated: string;
}
