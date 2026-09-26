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
  /** The node kind (`agent` until P05). */
  kind: string;
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

/** Compound type: WorkflowRun with all its StageRuns */
export interface WorkflowRunWithStages extends WorkflowRun {
  stageRuns: StageRun[];
}

/** Parameters for creating a WorkflowRun */

