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
  updateStatus(id: string, status: StageRunStatus): Promise<void>;
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
  resetForRetry(id: string): Promise<void>;
  batchUpdateStatus(ids: string[], status: StageRunStatus): Promise<void>;
  delete(id: string): Promise<void>;
  deleteByRunId(workflowRunId: string): Promise<void>;

  // ── DUR-05: durable step.sleep ────────────────────────────────
  /**
   * Atomically transition a `running` stage to `sleeping` with a
   * `wake_at` deadline. Caller releases the SDK session BEFORE calling
   * sleep() — this method only touches the row.
   */
  sleep(id: string, wakeAt: Date): Promise<void>;
  /**
   * Atomically transition `sleeping → queued`, clearing `wake_at` /
   * `slept_since`. Returns `true` iff the row was actually sleeping when
   * this call ran; `false` means another sweeper already woke it or the
   * parent run cancelled. Used by the sweeper to claim a row before
   * firing the wake handler.
   */
  wake(id: string): Promise<boolean>;

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
  /**
   * Return every stage whose `wake_at <= now` and `status = 'sleeping'`,
   * ordered by oldest deadline first. Capped at `limit` rows per sweep so
   * a single tick can't hold the write lock indefinitely.
   */
  findSleepersReadyToWake(now: Date, limit: number): Promise<StageRun[]>;

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
