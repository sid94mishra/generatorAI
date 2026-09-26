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
  AgentStage,
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
  /**
   * A verdict a resume attempt carries (given while no frame was alive): the
   * completion-review round it answered and the digest of the output shown.
   * The attempt honours it only at that round with that output.
   */
  reviewRound?: number;
  outputHash?: string;
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

// ── Maps and sub-workflows (P05 §4.1, §4.2) ──────────────────────

/**
 * Where one map item is:
 *   pending      not started (the map's concurrency holds it back)
 *   preparing    mount_per_item: its worktrees are being cut from the snapshot and set up
 *   running      its scope `<map>#<index>` runs
 *   merge_queued its body completed; its merge waits for the one in flight
 *   merging      its merge (sequential or pr_per_item) is in flight
 *   done         settled (`status`)
 */
export type MapItemPhase = 'pending' | 'preparing' | 'running' | 'merge_queued' | 'merging' | 'done';

export interface MapItemState {
  index: number;
  /** The stable key (`itemKey`, else the index). */
  key: string;
  /** The element of the map's list. */
  item: unknown;
  phase: MapItemPhase;
  status: 'completed' | 'failed' | 'cancelled' | null;
  errorCode: string | null;
  error: string | null;
  /** mount_per_item: the item's own workspace, its mounts (alias → directory), primary directory and branch. */
  workspaceId: string | null;
  mounts: Record<string, string> | null;
  primaryDir: string | null;
  branch: string | null;
  /** pr_per_item: the pushed branch and the pull request (when one was opened). */
  pr: { url: string | null; branch: string } | null;
}

/**
 * A winner merge after the map completed (P08 §7):
 *   waiting  the stages the key reads (the judge) have not settled
 *   merging  the winner's merge (`map_merge_item`, sequential) is in flight
 *   done     settled: `outcome` merged, none (no winner picked) or failed
 */
export interface MapWinnerState {
  phase: 'waiting' | 'merging' | 'done';
  index: number | null;
  key: string | null;
  outcome: 'merged' | 'none' | 'failed' | null;
  error: string | null;
}

/** A map instance's state (`stage_runs.loop_state`, the container-state column). */
export interface MapState {
  kind: 'map';
  /** snapshotting: mount_per_item captures the run mounts before any item starts. */
  phase: 'snapshotting' | 'running' | 'done';
  count: number;
  /** mount_per_item: the snapshot commit of every run mount (alias → sha). */
  snapshot: Record<string, string> | null;
  items: MapItemState[];
  /** A winner merge's progress once the map completed (merge `{mode: winner}` only). */
  winner?: MapWinnerState | null;
}

/** A sub-workflow instance's state. */
export interface SubworkflowState {
  kind: 'subworkflow';
  /** starting: the child run is being invoked (an effect); running: it runs; done: settled. */
  phase: 'starting' | 'running' | 'done';
  childRunId: string | null;
  /** The evaluated inputs (the child's variables). */
  inputs: Record<string, unknown>;
}

/**
 * An expansion node's state (P08 §8, `<planner>~x`): the planner's plan as
 * validated and compiled when the node started, in the same transaction as
 * the planner's completion. Recovery and replay read it; the planner is never
 * asked again.
 */
export interface ExpansionState {
  kind: 'expansion';
  /** running: the planned stages run in the node's scope; done: settled. */
  phase: 'running' | 'done';
  /** The planner instance whose output is the plan. */
  plannerId: string;
  /** The planned stages as full agent stages (clamped), and their edges. */
  stages: AgentStage[];
  edges: Array<{ from: string; to: string }>;
  join: 'all' | 'tolerate';
}

export type ContainerState = MapState | SubworkflowState | ExpansionState;

/** An event delivered to a run and not consumed yet (`workflow_run_events`, P05 §4.3). */
export interface RunEventRecord {
  id: string;
  eventKey: string;
  idempotencyKey: string;
  data: unknown;
  receivedAt: number;
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
  /** The map item this instance belongs to (null outside a map body; P05 §4.1). */
  itemIndex?: number | null;
  itemKey?: string | null;
  /** A map's or a sub-workflow's state. */
  containerState?: ContainerState | null;
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
  budget: { maxTurns?: number; maxCostUsd?: number; maxTokens?: number; maxWallClockMs?: number } | null;
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
  /** Events delivered and not consumed yet, oldest first (what event waits take). */
  events?: RunEventRecord[];
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
  /** `actor`: who sent it (a wait's `output.by`), set by the server from the principal. */
  | { type: 'command'; command: RunCommand; actor?: string }
  /**
   * The `capture_iteration` effect is done: the tree hash of every mount
   * (null when it could not be computed) and the iteration checkpoint.
   */
  | { type: 'iteration_captured'; stageRunId: string; k: number; at: 'start' | 'end'; treeHashes: Record<string, string | null> | null; checkpointTurnId?: string | null }
  /** The `restore_iteration` effect is done (every mount restored, or rolled back). */
  | { type: 'iteration_restored'; stageRunId: string; k: number; ok: boolean; error?: string }
  /** The `map_snapshot` effect is done: the snapshot commit per run mount, or why it could not be taken. */
  | { type: 'map_snapshot_taken'; stageRunId: string; snapshot: Record<string, string> | null; error?: string }
  /** The `map_prepare_item` effect is done: the item's worktrees are cut and set up, or why not. */
  | {
      type: 'map_item_prepared';
      stageRunId: string;
      index: number;
      ok: boolean;
      workspaceId?: string;
      mounts?: Record<string, string>;
      primaryDir?: string;
      branch?: string | null;
      code?: string;
      error?: string;
    }
  /** The `map_merge_item` effect is done. */
  | { type: 'map_item_merged'; stageRunId: string; index: number; ok: boolean; code?: string; error?: string; pr?: { url: string | null; branch: string } | null }
  /** The `start_child` effect invoked the child run (or failed to). */
  | { type: 'child_started'; stageRunId: string; childRunId: string }
  | { type: 'child_start_failed'; stageRunId: string; code: string; error: string }
  /** A sub-workflow's child run finalized: its declared outputs and its usage. */
  | {
      type: 'child_settled';
      stageRunId: string;
      childRunId: string;
      status: RunOutcome;
      outputs: Record<string, unknown>;
      usage: Usage;
      error?: string;
    }
  /** The `finalize` effect is done (compensation, onExit/onFailure, post-processing). */
  | { type: 'finalized'; ok: boolean; error?: string }
  /** The `summarize` effect is done: an `llm` summary (or its deterministic fallback), and what the summary turn spent. */
  | { type: 'summary_ready'; stageRunId: string; summary: string; usage?: Usage }
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
  containerState?: ContainerState | null;
}

export interface RunPatch {
  statusReason?: string | null;
  outcome?: RunOutcome | null;
  error?: string | null;
  errorCode?: string | null;
  /** The run budget after a run-level `raise_budget` (P07 WP-7.3). */
  budget?: RunRecord['budget'];
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
  /** An event wait took a delivered event (a CAS on `consumed_by_stage_run_id`). */
  | { t: 'consume_event'; eventId: string; stageRunId: string }
  /** Effect: snapshot every run mount for a mount_per_item map (and take its shared worktree leases); posts `map_snapshot_taken`. */
  | { t: 'map_snapshot'; stageRunId: string }
  /** Effect: cut an item's worktrees from the snapshot (all or nothing) and run its itemSetup; posts `map_item_prepared`. */
  | { t: 'map_prepare_item'; stageRunId: string; index: number }
  /** Effect: bring an item's mount back (a sequential merge or a branch and PR); posts `map_item_merged`. */
  | { t: 'map_merge_item'; stageRunId: string; index: number; strategy: 'sequential' | 'pr_per_item' }
  /** Effect: the map settled; its worktree leases are released. */
  | { t: 'map_release'; stageRunId: string }
  /** Effect: invoke a sub-workflow's child run; posts `child_started` or `child_start_failed`. */
  | { t: 'start_child'; stageRunId: string; inputs: Record<string, unknown> }
  /** Effect: write a completed stage's `llm` summary (P07 WP-7.1); posts `summary_ready`. */
  | { t: 'summarize'; stageRunId: string }
  /** Effect: propagate a cancel, pause or resume to a child run. */
  | { t: 'child_command'; stageRunId: string; childRunId: string; command: 'cancel' | 'pause' | 'resume' }
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
  'map_snapshot',
  'map_prepare_item',
  'map_merge_item',
  'map_release',
  'start_child',
  'child_command',
  'summarize',
]);
