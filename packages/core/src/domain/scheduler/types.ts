// ────────────────────────────────────────────────────────────────
// Scheduler v2 types (P03 WP-3.3, G5 §5.2–5.3).
//
// `decide(graph, state, msg, now)` reads a `RunState` snapshot and one
// `RunMessage`, and returns `Decision[]`. The actor (P03 WP-3.6) applies
// the decisions in ONE synchronous transaction through
// `RunStore.apply(runId, ownerEpoch, decisions)` and dispatches the effect
// decisions (`launch`, `abort`, `deliver_input`, `prepare`, `finalize`)
// after the commit. Nothing here reads a clock, draws a random number or
// touches I/O.
// ────────────────────────────────────────────────────────────────

import type {
  RunCommand,
  StageRunState,
  WorkflowRunState,
} from '@generatorai/workflow-spec';
import type { ClassifiedError } from '../errors/StageError.js';

export type AttemptMode = 'fresh' | 'resume' | 'restart';
export type AttemptStatus = 'running' | 'succeeded' | 'failed' | 'aborted' | 'interrupted';
export type Jitter = 'full' | 'equal' | 'none';
export type RunOutcome = 'completed' | 'failed' | 'cancelled';

/** Why an instance was skipped (G5 §4.2); the UI's "Why?" reads it with `skipCauseId`. */
export type SkipReason =
  | 'guard_false'
  | 'edge_inactive'
  | 'upstream_skipped'
  | 'join_unsatisfiable'
  | 'operator'
  | 'cancelled_loser'
  | 'scope_aborted';

export type TimerKind =
  | 'retry'
  | 'wait_timeout'
  | 'wait_timer'
  | 'loop_wall_clock'
  | 'pause_ttl'
  | 'queue_timeout'
  | 'run_budget_wall_clock';

/** Spend reported by the harness. Additive. */
export interface Usage {
  turns?: number;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  /** Tool calls the agent made (a loop signal, P05 §2.5). */
  toolCalls?: number;
}

/** A human verdict on an `awaiting_input` instance (the `approve` command). */
export interface ApprovalVerdict {
  outcome: 'approved' | 'rejected' | 'changes_requested';
  feedback?: string;
  data?: Record<string, unknown>;
}

/**
 * An operator message a stage sends as its next turn (P03b, the stage
 * conversation API). Attachments are artifact ids uploaded to the stage.
 */
export interface OperatorTurn {
  prompt: string;
  attachmentIds?: string[];
  agentMode?: 'auto' | 'plan';
}

// ── Loops (P05 §2) ────────────────────────────────────────────────

/**
 * Where a loop instance is in its cycle:
 *   starting    the tree hashes of the loop start are being captured
 *   running     iteration k's scope runs
 *   settling    scope k is terminal; `capture_iteration` is in flight
 *   wrapping_up the budget ran out; the wrap-up instance runs
 *   restoring   an accepted earlier iteration's checkpoint is being restored
 *   parked      awaiting an operator decision (the instance is awaiting_input)
 *   done        terminal
 */
export type LoopPhase = 'starting' | 'running' | 'settling' | 'wrapping_up' | 'restoring' | 'parked' | 'done';

/** How a loop exhausted (the `exhaust` action's reason is its rule's). */
export type LoopLimitReason = 'max_iterations' | 'budget' | string;

/** `stage_runs.loop_state` of a loop instance (P05 §2.6). */
export interface LoopState {
  k: number;
  phase: LoopPhase;
  /** maxIterations plus every grant. */
  effectiveMax: number;
  /** Budget raises, added to the loop budget. */
  budgetDelta: { maxTurns?: number; maxCostUsd?: number; maxTokens?: number; maxWallClockMs?: number };
  /** Streak per exit rule (by index). */
  streaks: number[];
  exitReason: string | null;
  exitAction: string | null;
  /** carry(-1): the carryInit values. */
  carryInit: Record<string, unknown>;
  /** A continue_with_input message and the iteration it is for. */
  operatorInput: { text: string; forIteration: number } | null;
  /** The loop's start (wall clock) and the time parked since, excluded from it. */
  startedAt: number;
  parkedMs: number;
  parkedSince: number | null;
  /** Tree hash per mount when the loop started (the baseline of workspaceChanged). */
  startHashes: Record<string, string | null> | null;
  /** The wrap-up ran (it runs once). */
  wrappedUp: boolean;
  /** What happens once the wrap-up or the restore settles. */
  pending: { kind: 'limit'; reason: string } | { kind: 'accept'; k: number; action: string; reason: string } | null;
}

/** One `loop_iterations` row. */
export interface LoopIterationRecord {
  stageRunId: string;
  k: number;
  carry: Record<string, unknown>;
  exitValues: Record<string, boolean | null>;
  streaks: number[];
  signals: LoopSignals | null;
  score: number | null;
  checkpointTurnId: string | null;
  usage: Usage;
  outcome: RunOutcome;
  startedAt: number | null;
  endedAt: number | null;
}

/** Per-iteration progress signals (P05 §2.5); a signal that cannot be computed is null. */
export interface LoopSignals {
  toolCalls: number | null;
  workspaceChanged: boolean | null;
  treeHashes: Record<string, string | null> | null;
  stages: Record<string, { toolCalls: number | null; outputHash: string | null; status: string | null }>;
}

// ── State ─────────────────────────────────────────────────────────

export interface InstanceState {
  id: string;
  stageKey: string;
  /** `triage`, `review_loop#2/fix`: the iteration order of the scheduler. */
  instancePath: string;
  /** Enclosing container instance; null at the top level. */
  scopeId: string | null;
  status: StageRunState;
  statusReason: string | null;
  version: number;
  /** Number of the latest attempt created (0: none yet). */
  currentAttempt: number;
  /** Status of that attempt (null: none). A `ready` instance whose attempt is `running` is admitted. */
  attemptStatus: AttemptStatus | null;
  /** Attempts that ended `failed` or `interrupted`: what `retry.maxAttempts` counts (a pause or cancel does not). */
  failedAttempts: number;
  skipReason: SkipReason | null;
  skipCauseId: string | null;
  gateAs: 'completed' | 'skipped' | null;
  /** `stages.<key>.output`: the structured output, else the output text. */
  output: unknown;
  summary: string | null;
  interruptData: unknown;
  errorCode: string | null;
  usage: Usage;
  leaseOwner: string | null;
  /** The error message of a failed instance (loop.last.failures). */
  error?: string | null;
  /** The iteration of the enclosing loop this instance belongs to (null at the top level and for a wrap-up). */
  iterationIndex: number | null;
  /** A loop instance's state. */
  loopState: LoopState | null;
  /** When the first attempt started (the `timeouts.totalMs` deadline runs from it). */
  startedAt: number | null;
  completedAt: number | null;
}

export interface CodebaseScopeState {
  path: string;
  branch: string | null;
  baseRef: string | null;
}

export interface RunRecord {
  id: string;
  name: string;
  status: WorkflowRunState;
  statusReason: string | null;
  outcome: RunOutcome | null;
  version: number;
  /** The run's user variables (`variables.*`). */
  variables: Record<string, unknown>;
  /** `run.codebases.<alias>`. */
  codebases: Record<string, CodebaseScopeState>;
  usage: Usage;
  /** The effective run budget (invocation override, else the workflow's). */
  budget: { maxTurns?: number; maxCostUsd?: number; maxWallClockMs?: number } | null;
  /** Started by something other than a person (automation, schedule, webhook, agent): pauses expire (PD-2). */
  unattended: boolean;
  startedAt: number | null;
  /** Stage keys an operator skipped for this run (`stage_overrides`); they skip instead of launching. */
  skipKeys?: readonly string[];
}

export interface RunState {
  run: RunRecord;
  /** Every instance of the run, any order (decide sorts by `instancePath`). */
  instances: InstanceState[];
  /** Every finished loop iteration of the run (`loop_iterations`). */
  iterations: LoopIterationRecord[];
}

// ── Messages ──────────────────────────────────────────────────────

export interface StageOutput {
  data?: unknown;
  text?: string;
  summary?: string;
  artifactManifest?: unknown[];
}

export type AttemptOutcome =
  | { kind: 'succeeded'; output: StageOutput; usage?: Usage }
  /** `safeReplay`: an interrupted in-flight turn may be re-sent (G5 §3.10). */
  | { kind: 'failed'; error: ClassifiedError; usage?: Usage; safeReplay?: boolean }
  | { kind: 'aborted'; reason: 'cancel' | 'pause' | 'budget' | 'superseded'; usage?: Usage };

export type RunMessage =
  /** created → starting; the effects layer runs the prepare phases, then posts `prepared`. */
  | { type: 'start' }
  /** starting → running; the root instances are created and scheduled. */
  | { type: 'prepared' }
  /** starting → failed (`setup:<phase>`). */
  | { type: 'prepare_failed'; phase: string; error: string }
  | { type: 'attempt_settled'; stageRunId: string; attemptNo: number; outcome: AttemptOutcome }
  | { type: 'usage_tick'; stageRunId: string; attemptNo: number; usage: Usage }
  /** A durable timer fired (its row is already marked fired by the TimerService CAS). */
  | { type: 'timer_fired'; timerId: string; kind: TimerKind; stageRunId: string | null }
  | { type: 'lease_expired'; stageRunId: string; owner: string; safeReplay?: boolean }
  /**
   * Recovery: the executor frame parked in `awaiting_input` died with the
   * process. A gate inside a turn (tool permission, question, plan review)
   * pauses the instance (`interrupted`); a completion review stays parked
   * and its approval starts a resume attempt (G5 §3.10 step 4).
   */
  | { type: 'frame_lost'; stageRunId: string; attemptNo: number }
  | { type: 'command'; command: RunCommand }
  /**
   * The `capture_iteration` effect is done: the tree hash of every mount
   * (null when it could not be computed) and the iteration checkpoint.
   */
  | { type: 'iteration_captured'; stageRunId: string; k: number; at: 'start' | 'end'; treeHashes: Record<string, string | null> | null; checkpointTurnId?: string | null }
  /** The `restore_iteration` effect is done (every mount restored, or rolled back). */
  | { type: 'iteration_restored'; stageRunId: string; k: number; ok: boolean; error?: string }
  /** The `finalize` effect is done (compensation, onExit/onFailure, post-processing). */
  | { type: 'finalized'; ok: boolean; error?: string }
  /** Backstop and recovery: re-derive what to do from the state alone. */
  | { type: 'tick' };

// ── Decisions ─────────────────────────────────────────────────────

/** Instance columns a transition may set; `null` clears. Timestamps are the store's. */
export interface InstancePatch {
  statusReason?: string | null;
  skipReason?: SkipReason | null;
  skipCauseId?: string | null;
  gateAs?: 'completed' | 'skipped' | null;
  outputData?: unknown;
  outputText?: string | null;
  summary?: string | null;
  artifactManifest?: unknown[] | null;
  interruptData?: unknown;
  error?: string | null;
  errorClass?: string | null;
  errorCode?: string | null;
  loopState?: LoopState | null;
}

export interface RunPatch {
  statusReason?: string | null;
  outcome?: RunOutcome | null;
  error?: string | null;
  errorCode?: string | null;
}

export interface NewInstance {
  id: string;
  stageKey: string;
  kind: string;
  name: string;
  instancePath: string;
  scopeId: string | null;
  iterationIndex?: number;
  itemIndex?: number;
  itemKey?: string;
}

export interface OutboxEvent {
  kind: string;
  data: Record<string, unknown>;
}

export type Decision =
  | { t: 'transition'; id: string; from: StageRunState[]; to: StageRunState; expectedVersion?: number; patch?: InstancePatch }
  /** Deterministic ids; the store inserts with ON CONFLICT DO NOTHING. */
  | { t: 'create_instances'; rows: NewInstance[] }
  /** Inserts the attempt row (`running`) and sets the instance's `current_attempt`. */
  | { t: 'create_attempt'; stageRunId: string; attemptNo: number; mode: AttemptMode; overrides?: unknown }
  | { t: 'settle_attempt'; stageRunId: string; attemptNo: number; status: Exclude<AttemptStatus, 'running'>; error?: ClassifiedError }
  /** Effect: admission, then `StageExecutor.start` (the executor's claim `ready → starting` makes a duplicate a no-op). */
  | { t: 'launch'; stageRunId: string; attemptNo: number }
  /** Effect: stop an executor or drop a queued launch; always after the desired state was written. */
  | { t: 'abort'; stageRunId: string; attemptNo: number; reason: 'cancel' | 'pause' | 'budget' | 'loser' | 'queue_timeout' }
  /** Effect: hand a verdict to a live executor frame parked in `awaiting_input`. */
  | { t: 'deliver_input'; stageRunId: string; attemptNo: number; verdict: ApprovalVerdict }
  /**
   * Arm a timer (replacing a live one of the same run, instance and kind).
   * The store draws the jitter and fixes `fire_at = now + max(minDelayMs, delay)`.
   */
  | { t: 'timer'; id: string; kind: TimerKind; stageRunId: string | null; baseDelayMs: number; jitter?: Jitter; minDelayMs?: number }
  /** Cancel live timers: of one kind (or every kind), of one instance (or the whole run when `stageRunId` is undefined). */
  | { t: 'cancel_timer'; kind?: TimerKind; stageRunId?: string | null }
  | { t: 'run_transition'; from: WorkflowRunState[]; to: WorkflowRunState; expectedVersion?: number; patch?: RunPatch }
  /** Run columns without a status change (the outcome of a cancelling run). */
  | { t: 'run_patch'; patch: RunPatch }
  /** Add usage to the instance and the run (`scopeOnly`: to an enclosing container, not the run again). */
  | { t: 'usage_rollup'; stageRunId: string; usage: Usage; scopeOnly?: boolean }
  /** Columns of an instance without a status change (a loop's state); a CAS on the status. */
  | { t: 'instance_patch'; id: string; status: StageRunState; patch: InstancePatch }
  /** Persist a finished loop iteration (same transaction as the next scope's instances). */
  | { t: 'record_iteration'; row: LoopIterationRecord }
  /** Effect: the tree hash of every mount (and, at an iteration's end, its checkpoint); posts `iteration_captured`. */
  | { t: 'capture_iteration'; stageRunId: string; k: number; at: 'start' | 'end'; checkpoint: boolean }
  /** Effect: restore every mount to an iteration's checkpoint, all or nothing; posts `iteration_restored`. */
  | { t: 'restore_iteration'; stageRunId: string; k: number; checkpointTurnId: string }
  /** Persisted in the same transaction, dispatched after commit. */
  | { t: 'emit'; event: OutboxEvent }
  /** Effect: the run's prepare phases (P04 lifecycle); posts `prepared` or `prepare_failed`. */
  | { t: 'prepare' }
  /** Effect: compensation (the listed instances, in this order), onExit/onFailure, post-processing; posts `finalized`. */
  | { t: 'finalize'; outcome: RunOutcome; compensate: string[] }
  /** A command was refused; nothing else is decided for the message. */
  | { t: 'reject'; code: 'not_found' | 'invalid_state' | 'version_conflict' | 'invalid_command'; message: string };

export type DecisionType = Decision['t'];

/** Effect decisions: dispatched after the commit, never written by the store. */
export const EFFECT_DECISIONS: ReadonlySet<DecisionType> = new Set<DecisionType>([
  'launch',
  'abort',
  'deliver_input',
  'prepare',
  'finalize',
  'reject',
  'capture_iteration',
  'restore_iteration',
]);
