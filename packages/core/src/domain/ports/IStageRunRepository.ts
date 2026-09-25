// ────────────────────────────────────────────────────────────────
// IStageRunRepository — Port for StageRun persistence
// ────────────────────────────────────────────────────────────────

import type { StageRun, StageRunStatus } from '@generatorai/shared';

export interface IStageRunRepository {
  create(stageRun: StageRun): Promise<StageRun>;
  getById(id: string): Promise<StageRun>;
  getByRunId(workflowRunId: string): Promise<StageRun[]>;
  getByStatus(workflowRunId: string, statuses: StageRunStatus[]): Promise<StageRun[]>;
  update(id: string, updates: Partial<StageRun>): Promise<StageRun>;
  /**
   * WS-D1 — every status write bumps `version`. Pass `expectedVersion` to
   * make the write conditional (optimistic lock): the returned boolean is
   * `false` when the row's version no longer matches, i.e. someone else
   * mutated the stage between your read and this write. Callers that do not
   * hold a version omit it and get an unconditional write (still bumped).
   */
  updateStatus(id: string, status: StageRunStatus, expectedVersion?: number): Promise<boolean>;
  /**
   * Increment the stage's retryCount.
   *
   * Phase 1, 1.25: callers can pass `expectedVersion` to opt into optimistic
   * locking — if the row's `version` column doesn't match, the update is a
   * no-op and the returned boolean is `false`. This prevents two concurrent
   * retry attempts from both "succeeding". Callers that don't care about
   * races (legacy) can omit the arg and get fire-and-forget semantics.
   */
  incrementRetryCount(id: string, expectedVersion?: number): Promise<boolean>;
  /**
   * Reset a stage to `pending` for a fresh attempt. WS-D1 — bumps `version`;
   * with `expectedVersion` the reset is conditional and returns `false` when
   * another writer got there first.
   */
  resetForRetry(id: string, expectedVersion?: number): Promise<boolean>;
  /** Bulk status write. WS-D1 — bumps `version` on every affected row. */
  batchUpdateStatus(ids: string[], status: StageRunStatus): Promise<void>;
  /**
   * WS-D1 — liveness beat. Writes `heartbeat_at = now` (and `lease_owner`
   * when given) ONLY while the row is `queued` or `running`, so a beat that
   * races a terminal write can never resurrect a finished stage. Returns
   * `true` iff a row was updated.
   */
  heartbeat(id: string, leaseOwner?: string): Promise<boolean>;
  delete(id: string): Promise<void>;
  deleteByRunId(workflowRunId: string): Promise<void>;

  // ── DUR-06: durable launch claim ──────────────────────────────
  /**
   * Atomically claim a `pending` stage for execution, transitioning it to
   * `queued` and bumping `version`. Returns `true` iff this call won the
   * claim (the row was actually `pending`); `false` means a concurrent
   * launch, or a crash-recovery re-drive, already took it.
   *
   * This is the launch-side idempotency boundary. Every `executeStage`
   * entry point gates on it, so duplicate launches — parallel fan-in (two
   * predecessors completing at once), the event path racing the polling
   * backstop, or `StartupRecoveryService` re-driving an interrupted run —
   * can never double-run a stage. The DB is the single source of truth for
   * "who owns this stage", replacing reliance on in-memory de-dup state
   * that does not survive a restart.
   */
  claimForExecution(id: string): Promise<boolean>;

  // ── HITL-01..05: human-in-the-loop ─────────────────────────────
  /**
   * Atomically transition a running stage to `awaiting_input` while
   * persisting the payload the approver will review. One SQL write; safe
   * under crash.
   */
  interrupt(id: string, interruptData: unknown): Promise<void>;
  /**
   * Atomically transition `awaiting_input → nextStatus` (default `running`),
   * clearing `interrupt_data` and bumping the optimistic-lock version.
   * Returns true iff the row was actually `awaiting_input` when this call
   * ran — a second concurrent approver sees `false` and bails.
   *
   * P0-a — callers pass `pending` when no in-process `interrupt()` awaiter
   * survives (i.e. the approval arrived after a restart), so the DAG
   * scheduler re-drives the stage instead of leaving it wedged in `running`
   * with nothing left to run it.
   */
  resumeFromInterrupt(id: string, nextStatus?: 'running' | 'pending'): Promise<boolean>;
  /** All stages in the run currently `awaiting_input`. */
  findAwaitingInputByRun(workflowRunId: string): Promise<StageRun[]>;
}
