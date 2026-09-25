// ────────────────────────────────────────────────────────────────
// IRunStore — the v2 engine's persistence port (P03 WP-3.1, G5 §5.4–5.5).
//
// Every status write of the v2 engine is a synchronous compare-and-set
// against the state tables of `@generatorai/workflow-spec` (R-4):
//   - the executor calls `transition` for the in-attempt moves it owns
//     (claim `ready → starting`, `starting → running`, `running →
//     validating`, repairs, input requests) plus `renewLease` /
//     `markProgress`;
//   - the actor applies a whole `decide()` batch with `apply`, in ONE
//     synchronous transaction fenced by the run's `owner_epoch` (RV-27).
// The methods are synchronous (better-sqlite3), so they compose inside a
// transaction and never interleave with anything else.
// ────────────────────────────────────────────────────────────────

import type { StageRunState, WorkflowRunState } from '@generatorai/workflow-spec';
import type { Decision, InstancePatch, RunMessage, RunPatch, RunState, TimerKind } from '../scheduler/types.js';

/** A `stage_runs` row as the v2 engine reads it. Timestamps are epoch ms. */
export interface StageInstanceRow {
  id: string;
  workflowRunId: string;
  stageKey: string;
  kind: string;
  name: string;
  instancePath: string;
  scopeId: string | null;
  status: StageRunState;
  statusReason: string | null;
  version: number;
  currentAttempt: number;
  epoch: number;
  sessionKey: string | null;
  sessionId: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: number | null;
  heartbeatAt: number | null;
  lastProgressAt: number | null;
  startedAt: number | null;
  completedAt: number | null;
  updatedAt: number;
}

/** Columns an executor-owned transition may also set. */
export interface StageRunCasPatch extends InstancePatch {
  sessionId?: string | null;
  sessionKey?: string | null;
  amendedAt?: number | null;
}

export type LeaseOption = { owner: string; ttlMs: number } | 'clear' | 'none';

export interface StageTransitionOptions {
  expectedVersion?: number;
  patch?: StageRunCasPatch;
  /**
   * Entering `starting` or `running` REQUIRES a lease object (it stamps the
   * lease, heartbeat and progress in the same statement, B-2); `'none'` is
   * for container instances, which have no executor. Leaving the attempt
   * states always clears the lease.
   */
  lease?: LeaseOption;
  /** Only an instance of this run (RunStore passes it). */
  runId?: string;
  now?: number;
}

export type TransitionResult<Row> = { ok: true; row: Row } | { ok: false; current: Row | null };

/** The v2 CAS surface of `stage_runs`. */
export interface IStageRunCas {
  transition(id: string, from: readonly StageRunState[], to: StageRunState, opts?: StageTransitionOptions): TransitionResult<StageInstanceRow>;
  /** Extend the lease while `owner` holds it and the instance is in an attempt state. */
  renewLease(id: string, owner: string, ttlMs: number, now?: number): boolean;
  /** Record harness progress (callers throttle to one write per 10 s). */
  markProgress(id: string, owner: string, at: number): boolean;
  getInstance(id: string): StageInstanceRow | null;
}

/** A `workflow_runs` row as the v2 engine reads it. */
export interface WorkflowRunRow {
  id: string;
  status: WorkflowRunState;
  statusReason: string | null;
  outcome: 'completed' | 'failed' | 'cancelled' | null;
  version: number;
  ownerId: string | null;
  ownerEpoch: number;
  ownerExpiresAt: number | null;
  runSeq: number;
  startedAt: number | null;
  completedAt: number | null;
  updatedAt: number;
}

export interface RunTransitionOptions {
  expectedVersion?: number;
  /** Fence: only while the run's `owner_epoch` is this value (RV-27). */
  ownerEpoch?: number;
  patch?: RunPatch;
  now?: number;
}

export interface IWorkflowRunCas {
  transition(id: string, from: readonly WorkflowRunState[], to: WorkflowRunState, opts?: RunTransitionOptions): TransitionResult<WorkflowRunRow>;
  /**
   * Take the run for this process: `owner_id = ownerId`, `owner_epoch + 1`.
   * Succeeds when the run is unowned, owned by `ownerId`, or its ownership
   * expired. Returns the new epoch, or null.
   */
  claimOwnership(id: string, ownerId: string, ttlMs: number, now?: number): number | null;
  getRunRow(id: string): WorkflowRunRow | null;
}

/** A timer the store armed (for the in-memory TimerService). */
export interface ArmedTimer {
  id: string;
  workflowRunId: string;
  stageRunId: string | null;
  kind: TimerKind;
  fireAt: number;
}

/** What `apply` returns after its commit. */
export type ApplyResult =
  | {
      ok: true;
      /** Effect decisions (launch, abort, deliver_input, prepare, finalize, reject), in order. */
      effects: Decision[];
      /** Timers armed by the batch. */
      timers: ArmedTimer[];
      /** Outbox rows written (`run_seq`), for the dispatcher. */
      outbox: number[];
      /** The journal row's sequence, when a message was journalled. */
      journalSeq: number | null;
    }
  /** `fenced`: another owner took the run. `conflict`: a CAS lost; re-read and re-decide. */
  | { ok: false; reason: 'fenced' | 'conflict'; detail: string };

export interface ApplyContext {
  now: number;
  /** Jitter source in [0, 1); the only randomness of the engine (G5 §3.2). */
  random?: () => number;
  /** Journalled with the batch (G5 §5.5 step 9). */
  message?: RunMessage;
  stateHash?: string;
}

export interface IRunStore {
  /** The state `decide()` reads, in one read. Null when the run does not exist. */
  loadRunState(runId: string): RunState | null;
  /** Apply a decision batch in one fenced synchronous transaction. */
  apply(runId: string, ownerEpoch: number, decisions: readonly Decision[], ctx: ApplyContext): ApplyResult;
}
