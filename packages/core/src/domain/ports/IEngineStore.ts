// ────────────────────────────────────────────────────────────────
// Engine v2 stores beyond the RunStore (P03 WP-3.5/3.6, G5 §5–§6).
//
// The executor, the actor, the supervisor, the timer service, the lease
// reaper and the outbox dispatcher read and write the v57 run tables through
// these ports. Every method is synchronous (better-sqlite3), so a caller can
// combine several writes in one transaction where the contract asks for it
// (a turn's settlement and its assistant message, G5 §5.5 / RV-10).
// `@generatorai/db` implements them; `createEngineStores(db)` builds the set.
// ────────────────────────────────────────────────────────────────

import type { AttemptMode, AttemptStatus, TimerKind, Usage } from '../scheduler/types.js';
import type { IRunStore, IStageRunCas, IWorkflowRunCas } from './IRunStore.js';

// ── stage_attempts ───────────────────────────────────────────────

export interface StageAttemptRecord {
  id: string;
  stageRunId: string;
  attemptNo: number;
  mode: AttemptMode;
  epoch: number;
  status: AttemptStatus;
  sessionId: string | null;
  repairCount: number;
  structuredOutput: unknown;
  agentSnapshot: unknown;
  judge: unknown;
  error: string | null;
  errorClass: string | null;
  errorCode: string | null;
  errorDetails: unknown;
  overrides: unknown;
  checkpointBeforeId: string | null;
  usage: Usage;
  startedAt: number;
  endedAt: number | null;
}

export interface StageAttemptPatch {
  sessionId?: string | null;
  structuredOutput?: unknown;
  agentSnapshot?: unknown;
  judge?: unknown;
  checkpointBeforeId?: string | null;
}

/** What the executor reads and records on attempt rows (the actor creates and settles them). */
export interface IStageAttemptStore {
  get(stageRunId: string, attemptNo: number): StageAttemptRecord | null;
  listByStageRun(stageRunId: string): StageAttemptRecord[];
  listLiveByRun(workflowRunId: string): StageAttemptRecord[];
  update(stageRunId: string, attemptNo: number, patch: StageAttemptPatch): boolean;
  /** Count one repair turn of a live attempt; the new count, or null when not live. */
  incrementRepair(stageRunId: string, attemptNo: number): number | null;
}

// ── run_sessions ─────────────────────────────────────────────────

export interface RunSessionRecord {
  id: string;
  workflowRunId: string;
  sessionKey: string;
  sessionId: string;
  ownerScopeId: string | null;
  configHash: string;
  status: 'active' | 'released';
  createdAt: number;
  releasedAt: number | null;
}

export interface IRunSessionStore {
  upsert(s: { id: string; workflowRunId: string; sessionKey: string; sessionId: string; ownerScopeId?: string | null; configHash: string; now: number }): RunSessionRecord;
  get(workflowRunId: string, sessionKey: string): RunSessionRecord | null;
  release(workflowRunId: string, sessionKey: string, now: number): boolean;
  listActive(workflowRunId: string): RunSessionRecord[];
}

// ── workflow_timers ──────────────────────────────────────────────

export interface WorkflowTimerRecord {
  id: string;
  workflowRunId: string;
  stageRunId: string | null;
  kind: TimerKind;
  fireAt: number;
  firedAt: number | null;
  cancelledAt: number | null;
  payload: unknown;
}

export interface IWorkflowTimerStore {
  /** CAS: mark fired once; only the caller that gets true posts `timer_fired`. */
  fire(id: string, now: number): boolean;
  cancel(f: { workflowRunId: string; kind?: TimerKind; stageRunId?: string | null }, now: number): number;
  get(id: string): WorkflowTimerRecord | null;
  listLive(workflowRunId?: string): WorkflowTimerRecord[];
}

// ── workflow_outbox / scheduler_journal ──────────────────────────

export interface OutboxRecord {
  workflowRunId: string;
  runSeq: number;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: number;
  dispatchedAt: number | null;
}

export interface IWorkflowOutboxStore {
  /** Undispatched rows in `(run, run_seq)` order. */
  listPending(limit?: number, workflowRunId?: string): OutboxRecord[];
  /** Idempotent by `(run, run_seq)`. */
  markDispatched(workflowRunId: string, runSeq: number, now: number): boolean;
}

export interface SchedulerJournalRecord {
  workflowRunId: string;
  seq: number;
  message: unknown;
  decisions: unknown[];
  stateHash: string;
  at: number;
}

export interface ISchedulerJournalStore {
  list(workflowRunId: string): SchedulerJournalRecord[];
}

// ── The executor's turn journal (RV-10) ──────────────────────────

/** `chat_messages.turn_role` of an engine-written message (v57, no CHECK). */
export type TurnRole =
  | 'context'
  | 'feedback'
  | 'prompt'
  | 'repair'
  | 'summary'
  | 'approval_feedback'
  | 'operator'
  | 'iteration_input'
  | 'wrap_up'
  | 'digest';

/** Whether an interrupted turn may be re-sent after a crash (derived from the stage's tool groups). */
export type TurnReplayPolicy = 'safe' | 'never';

/** What a settled turn left behind: what a replay restores instead of asking the model again. */
export interface SettledTurn {
  role: TurnRole;
  /** The assistant text of the turn. */
  content: string;
  /** Native structured output returned with the turn. */
  structuredOutput?: unknown;
  /** A `submit_output` call accepted during the turn. */
  submitted?: unknown;
  thinkingText?: string;
  toolCalls?: unknown[];
}

export type TurnJournalEntry =
  | { state: 'intent'; role: TurnRole; policy: TurnReplayPolicy; at: number }
  | { state: 'settled'; turn: SettledTurn; at: number };

/** A message the journal writes in the same transaction as the turn's intent or settlement. */
export interface JournalMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  turnRole: TurnRole;
  metadata: Record<string, unknown>;
  /** Assistant rows: true on settlement, false for a turn cut short. */
  complete: boolean;
  /** Files an operator attached to a user message (the stage conversation API). */
  attachments?: Array<{ name: string; path: string; mimeType: string; artifactId?: string }>;
}

/**
 * One journal per stage run, keyed by operation id (`a{epoch}/prompt/0`).
 * A turn is SETTLED only when its settlement row exists: a turn with an
 * intent and no settlement is interrupted, whatever messages it left (RV-10).
 */
export interface ITurnJournal {
  get(stageRunId: string, opId: string): TurnJournalEntry | null;
  /** Record the intent and (when given) the user message, in one transaction. */
  intent(stageRunId: string, opId: string, e: { role: TurnRole; policy: TurnReplayPolicy; now: number; message?: JournalMessage }): void;
  /** Settle the turn and write its assistant message (`complete = 1`) in ONE transaction. */
  settle(stageRunId: string, opId: string, turn: SettledTurn, e: { now: number; message?: JournalMessage }): void;
  /** Write a turn cut short (`complete = 0`) without settling it. */
  recordPartial(message: JournalMessage, now: number): void;
  /** Retract an operation (its intent and any settlement): the next attempt re-runs it. */
  discard(stageRunId: string, opId: string): void;
  /** Turns with an intent and no settlement whose op id starts with `prefix`. */
  inFlight(stageRunId: string, prefix: string): Array<{ opId: string; role: TurnRole; policy: TurnReplayPolicy }>;
  /** Drop the stage run's journal (its run is terminal). */
  release(stageRunId: string): void;
}

// ── engine_lock ──────────────────────────────────────────────────

export interface EngineLockRecord {
  ownerId: string | null;
  bootId: string | null;
  heartbeatAt: number | null;
}

/** The single-engine lock (RV-27): one process drives the runs of a database. */
export interface IEngineLockStore {
  /** Take the lock when it is free, stale (heartbeat older than `staleMs`) or already this boot's. */
  acquire(ownerId: string, bootId: string, now: number, staleMs: number): boolean;
  /** Extend the heartbeat while this boot holds the lock. */
  renew(bootId: string, now: number): boolean;
  release(bootId: string): void;
  get(): EngineLockRecord | null;
}

// ── Read models the supervisor and the reaper scan ───────────────

export interface ExpiredLease {
  stageRunId: string;
  workflowRunId: string;
  leaseOwner: string | null;
}

export interface IEngineQueries {
  /** Runs that are started and not terminal (created runs wait for `start`). */
  listLiveRunIds(): string[];
  /** Instances in an attempt state whose lease expired, of runs this owner holds. */
  listExpiredLeases(ownerId: string, now: number): ExpiredLease[];
}

/** Every store the v2 engine uses, over one database. */
export interface EngineStores {
  runStore: IRunStore;
  stages: IStageRunCas;
  runs: IWorkflowRunCas;
  attempts: IStageAttemptStore;
  runSessions: IRunSessionStore;
  timers: IWorkflowTimerStore;
  outbox: IWorkflowOutboxStore;
  journal: ISchedulerJournalStore;
  turns: ITurnJournal;
  lock: IEngineLockStore;
  queries: IEngineQueries;
}
