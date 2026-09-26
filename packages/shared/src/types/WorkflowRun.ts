// ────────────────────────────────────────────────────────────────
// WorkflowRun + StageRun — Runtime execution instances (v2)
// ────────────────────────────────────────────────────────────────

import type { StageRunState, WorkflowRunState } from '@generatorai/workflow-spec';
import type { RunSystemVars } from './RunLifecycle.js';

/** Artifact manifest entry — a file a stage created or modified. */
export interface ArtifactManifestEntry {
  path: string;
  language: string;
  action: 'created' | 'modified';
  sizeBytes: number;
}

/**
 * WorkflowRun lifecycle statuses: the v2 engine's run states (G5 §5.10).
 * `waiting` means nothing is launchable or in flight but something awaits
 * input, a timer or an operator; `finalizing` runs compensation and exit
 * actions once the outcome is fixed.
 */
export type WorkflowRunStatus = WorkflowRunState;

/**
 * StageRun (instance) statuses: the v2 engine's instance states (G5 §5.9).
 * `ready` is admitted-and-waiting-for-a-slot, `starting`/`running`/
 * `validating` are the live attempt, `retry_wait` a retry backoff,
 * `awaiting_input` a human gate (the payload is `interruptData`).
 */
export type StageRunStatus = StageRunState;

/**
 * HITL + TOL-04 — the permission policy a run's tool calls are judged by.
 *
 * A run with no explicit mode does NOT default to `bypassPermissions` (W-07,
 * PD-18): the mode resolves through the layers — the run row, the stage's
 * `session.permissionMode`, the workflow's, the trigger's (an automation's
 * declared mode), then the deployment posture — and is re-read every turn.
 *
 * - `bypassPermissions` — all requests auto-allow.
 * - `default`           — every gated request parks the stage (`awaiting_input`).
 * - `acceptEdits`       — auto-allow file reads and writes; ask for the rest.
 * - `plan`              — read-only; the agent plans and submits the plan.
 */
export type WorkflowRunPermissionMode =
  | 'bypassPermissions'
  | 'default'
  | 'acceptEdits'
  | 'plan';

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
  /** Why the run is in its status (`budget_exhausted`, `setup:<phase>`, …). */
  statusReason?: string;
  /** Fixed when the run enters `finalizing`. */
  outcome?: 'completed' | 'failed' | 'cancelled';
  /** CAS version, bumped by every run transition (`expectedVersion` on commands). */
  version?: number;
  variables: Record<string, unknown>;
  error?: string;
  /**
   * The operator's explicit run-level permission mode (the run row, the most
   * specific layer; stored in `run_overrides`). Undefined lets the stage,
   * workflow and trigger layers and then the deployment posture decide.
   */
  permissionMode?: WorkflowRunPermissionMode;
  /** The project the run belongs to. */
  projectId?: string;
  /** What started the run (`{kind: 'user' | 'automation' | 'fork' | …}`); non-user kinds are unattended (PD-2). */
  trigger?: { kind: string; [key: string]: unknown };
  /** The resolved run-level mode when the run was created or last changed (display; the layers decide per turn). */
  effectivePermissionMode?: WorkflowRunPermissionMode;
  /** A fork's request (`rerunFrom`, `definition`, `workspace`, …). */
  forkSpec?: Record<string, unknown>;
  /** A repeated key returns the run it created. */
  idempotencyKey?: string;
  /** The codebases the run was started with (`InvocationRequest.codebases`, resolved). */
  codebaseSelection?: Array<{ alias: string; baseRef?: string; mode: 'worktree' | 'in_place' }>;
  /** Per-stage overrides of this run, by stage key: skip it, extra variables for it, its model. */
  stageOverrides?: Array<{ stageKey: string; skip?: boolean; variables?: Record<string, unknown>; model?: string }>;
  /** Run-wide session overrides (model, provider, effort) under every stage's own session. */
  runOverrides?: { model?: string; harnessType?: string; reasoningEffort?: string };
  /** Engine-owned values (workspace paths, codebases, uploads, the lifecycle journal); never caller input. */
  systemVars?: RunSystemVars;
  /** The invocation that created the run. */
  invocationId?: string;
  /** Lineage: the run whose stage invoked this one, the root of the tree, and the depth (root = 0). */
  parentRunId?: string;
  parentStageRunId?: string;
  rootRunId?: string;
  depth?: number;
  /** The invocation budget (`maxDurationMs`, `maxChildRuns`, …). */
  budget?: Record<string, unknown>;
  /** Workspace ID — links to the execution workspace for this run */
  workspaceId?: string;
  /**
   * The run this one was forked from (G5 §3.8). A terminal run is never
   * mutated: re-running it is a fork, a NEW run whose memoized instances
   * are copied from the ancestor. Absent on runs that are not forks.
   */
  ancestorRunId?: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

/**
 * StageRun domain entity — one INSTANCE of a stage within a workflow run
 * (the v2 engine's `stage_runs` row). Attempts are separate rows
 * (`stage_attempts`); `currentAttempt` is the latest one.
 */
export interface StageRun {
  id: string;
  workflowRunId: string;
  /** Key of the stage in the run's pinned definition version. */
  stageKey: string;
  /** `triage`, `review_loop#2/fix`: unique per run; the stage key at the top level. */
  instancePath: string;
  /** The node kind: agent, check, loop, map, subworkflow, wait (P05). */
  kind: string;
  /** The enclosing container instance (a loop or map body stage); absent at the top level. */
  scopeId?: string;
  /** The iteration of the enclosing loop this instance belongs to (absent for a wrap-up). */
  iterationIndex?: number;
  /** The item of the enclosing map this instance belongs to (P05 §4.1), and its stable key. */
  itemIndex?: number;
  itemKey?: string;
  /** A loop instance's state (P05 §2.6). */
  loopState?: LoopStateView;
  /** A map instance's state: its items (P05 §4.1). */
  mapState?: MapStateView;
  /** A sub-workflow instance's state: its child run (P05 §4.2). */
  subworkflowState?: SubworkflowStateView;
  /** A waiting event wait's callback (P05 §4.3): external systems POST the event here without a credential. */
  callback?: { url: string; token: string };
  /** The conversation of the current attempt. */
  sessionId?: string;
  name: string;
  status: StageRunStatus;
  /** Why the instance is in its status (`retry:resume`, `aborted:pause`, `interrupted`, …). */
  statusReason?: string;
  /** The latest attempt number (0 before the first attempt). */
  currentAttempt: number;
  /** CAS version, bumped by every transition and patch. */
  version: number;
  error?: string;
  errorClass?: string;
  errorCode?: string;
  /** Why a skipped instance was skipped (`guard`, `operator`, `unreachable`, …). */
  skipReason?: string;
  /** Auto-generated summary of the work done in this stage, used to pass context to successor stages */
  summary?: string;
  /** The stage's output text (the latest prompt, repair or revision answer). */
  outputText?: string;
  /** Validated structured output JSON matching the stage's output schema */
  outputData?: Record<string, unknown>;
  /** Manifest of files created/modified by this stage */
  artifactManifest?: Array<{ path: string; language: string; action: string; sizeBytes: number }>;
  /**
   * What an `awaiting_input` instance asks an approver for (`kind`:
   * `stage_completion_review`, `tool_permission`, `question`, `plan_review`).
   * Answered with the `approve` run command.
   */
  interruptData?: unknown;
  /** Rolled-up usage of the instance's attempts. */
  usage?: Record<string, unknown>;
  createdAt: Date;
  updatedAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  /** When an operator follow-up last amended this completed stage's output (PD-4). */
  amendedAt?: Date;
}

/**
 * A loop instance's state as the clients read it (`stage_runs.loop_state`).
 * `phase`: starting, running, settling, wrapping_up, restoring, parked, done.
 */
export interface LoopStateView {
  k: number;
  phase: string;
  effectiveMax: number;
  budgetDelta: { maxTurns?: number; maxCostUsd?: number; maxTokens?: number; maxWallClockMs?: number };
  /** Streak per exit rule, by rule index. */
  streaks: number[];
  exitReason: string | null;
  exitAction: string | null;
  operatorInput: { text: string; forIteration: number } | null;
  startedAt: number;
  parkedMs: number;
  parkedSince: number | null;
  wrappedUp: boolean;
}

/** One map item as the clients read it (P05 §4.1). `phase`: pending, preparing, running, merge_queued, merging, done. */
export interface MapItemView {
  index: number;
  key: string;
  item: unknown;
  phase: string;
  status: 'completed' | 'failed' | 'cancelled' | null;
  errorCode: string | null;
  error: string | null;
  workspaceId: string | null;
  mounts: Record<string, string> | null;
  primaryDir: string | null;
  branch: string | null;
  pr: { url: string | null; branch: string } | null;
}

/** A winner merge after a map completed (P08): `phase` waiting, merging, done; `outcome` merged, none, failed. */
export interface MapWinnerView {
  phase: string;
  index: number | null;
  key: string | null;
  outcome: string | null;
  error: string | null;
}

/** A map instance's state (`stage_runs.loop_state` of a map). `phase`: snapshotting, running, done. */
export interface MapStateView {
  kind: 'map';
  phase: string;
  count: number;
  snapshot: Record<string, string> | null;
  items: MapItemView[];
  winner?: MapWinnerView | null;
}

/** A sub-workflow instance's state. `phase`: starting, running, done. */
export interface SubworkflowStateView {
  kind: 'subworkflow';
  phase: string;
  childRunId: string | null;
  inputs: Record<string, unknown>;
}

/**
 * A decision a run waits on (`GET /workflow-runs/:id/pending-decisions`,
 * P05): a completion review, an in-turn gate, a parked loop, an approval or
 * event wait — a sub-workflow child's too (`runId` is then the child run that
 * owns the instance and `via` the sub-workflow instances it came through).
 */
export interface PendingDecisionView {
  runId: string;
  instanceId: string;
  stageKey: string;
  instancePath: string;
  name: string;
  /** `wait`, or the interrupt kind (stage_completion_review, tool_permission, question, plan_review, loop_decision). */
  kind: string;
  waitType?: 'approval' | 'event';
  interruptData: unknown;
  version: number;
  callback?: { url: string; token: string };
  via: Array<{ runId: string; instanceId: string; stageKey: string; name: string }>;
}

/** One finished loop iteration (`loop_iterations`, P05 §2.6). */
export interface LoopIteration {
  k: number;
  carry: Record<string, unknown>;
  /** Each exit rule's value, by reason. */
  exitValues: Record<string, boolean | null>;
  streaks: number[];
  signals: {
    toolCalls: number | null;
    workspaceChanged: boolean | null;
    stages: Record<string, { toolCalls: number | null; outputHash: string | null; status: string | null }>;
  } | null;
  score: number | null;
  /** Set when the iteration's workspace was checkpointed (accept_iteration can restore it). */
  checkpointTurnId: string | null;
  usage: Record<string, unknown>;
  outcome: string;
  startedAt: number | null;
  endedAt: number | null;
}

/** Compound type: WorkflowRun with all its StageRuns */
export interface WorkflowRunWithStages extends WorkflowRun {
  stageRuns: StageRun[];
}

/** Parameters for creating a WorkflowRun */

