// ────────────────────────────────────────────────────────────────
// DurableSleepService — DUR-05 background sleep + wake sweeper.
//
// What it does
// -------------
// - `sleep(stageRunId, durationMs)`: persist `status='sleeping'` + `wake_at`
//   on the stage row, emit `stage_run.sleeping`. The caller (usually a
//   stage body / tool) then releases its SDK session and returns — the
//   run loop picks up the transition on next tick and proceeds with
//   other stages.
// - Background sweeper: every `sweepIntervalMs`, fetch up to
//   `maxWakesPerSweep` stages whose `wake_at <= now`, claim each via the
//   atomic `wake()` (sleeping → queued) and invoke `onWake(stageRun)`.
//   Whoever wires the service (composition root) supplies `onWake` to
//   actually resume execution — this class doesn't know how to run a
//   stage, only how to flip the row and notify.
//
// Cross-process safety
// ---------------------
// `wake()` is a conditional UPDATE that only matches rows still in
// `status='sleeping'`. Two sweepers racing on the same row both attempt
// the UPDATE; SQLite serialises writes, one returns a row, the other
// gets 0 changes and skips. The version counter (`+ 1`) means any
// stale-read lookups in the winning caller's `onWake` still see the
// row as "re-queued" after their own read.
//
// Survivability
// -------------
// The whole point of durable sleep is that a crashed/restarted server
// picks back up. Because `status='sleeping'` + `wake_at` is persisted on
// every sleep call, a restart just means the sweeper finds the rows the
// next time it ticks. Nothing in the sweep loop relies on in-memory
// timers — we poll, we don't schedule.
// ────────────────────────────────────────────────────────────────

import type { StageRun } from '@generatorai/shared';
import type { IStageRunRepository } from '../domain/ports/IStageRunRepository.js';
import type { EventBus } from '../events/EventBus.js';

export interface DurableSleepConfig {
  /** How often (ms) the sweeper polls for wake-ready rows. */
  sweepIntervalMs: number;
  /** Cap per sweep to keep SQLite write windows bounded. */
  maxWakesPerSweep: number;
  /** Disable the sweeper entirely (tests / maintenance mode). */
  enabled: boolean;
}

export interface SleepLogger {
  info?: (msg: string, meta?: Record<string, unknown>) => void;
  warn?: (msg: string, meta?: Record<string, unknown>) => void;
  error?: (msg: string, meta?: Record<string, unknown>) => void;
}

/**
 * Callback invoked for each stage the sweeper wakes. Takes the woken
 * stage row (already in `status='queued'` by the time the callback
 * runs) and is responsible for scheduling its actual execution —
 * typically `stageExecutionService.executeStage(...)`.
 *
 * Errors thrown from `onWake` are logged but do NOT re-sleep the row;
 * the row stays in `queued` and the run's normal scheduler picks it up
 * on its next tick. This mirrors the semantics of a crash immediately
 * after wake — persisted state is the source of truth.
 */
export type OnWakeHandler = (stageRun: StageRun) => Promise<void> | void;

export class DurableSleepService {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  /**
   * W18 / P2-c — demand-gated sweeper. The timer only runs while at least one
   * stage is in the `sleeping` state so the sweeper doesn't burn CPU cycles
   * polling an empty table every `sweepIntervalMs` on an otherwise idle server.
   * Incremented by `sleep()`, decremented once per successful `wake()` claim.
   */
  private activeSleepCount = 0;

  constructor(
    private readonly stageRunRepo: IStageRunRepository,
    private readonly eventBus: EventBus,
    private readonly onWake: OnWakeHandler,
    private readonly config: DurableSleepConfig,
    private readonly logger?: SleepLogger,
  ) {}

  /**
   * Request that a running stage sleep until `Date.now() + durationMs`.
   * The caller is responsible for returning from its stage body
   * immediately after this call resolves — this method only records
   * the intent; it does not abort the SDK session or unwind stack
   * frames. Negative / zero durations are clamped to 1ms so the
   * sweeper picks the row up on its next tick.
   */
  async sleep(stageRunId: string, workflowRunId: string, durationMs: number, reason?: string): Promise<Date> {
    const safeDuration = durationMs > 0 ? durationMs : 1;
    const wakeAt = new Date(Date.now() + safeDuration);
    await this.stageRunRepo.sleep(stageRunId, wakeAt);
    await this.eventBus.emitGlobal({
      kind: 'stage_run.sleeping',
      data: {
        stageRunId,
        workflowRunId,
        wakeAt: wakeAt.getTime(),
        reason,
      },
    });
    this.logger?.info?.('[DurableSleep] stage entered sleeping', {
      stageRunId,
      wakeAt: wakeAt.toISOString(),
      durationMs: safeDuration,
    });
    // W18 — demand-gate: start the sweeper the moment a stage goes to sleep so
    // we don't poll when there is nothing to wake up.
    this.activeSleepCount += 1;
    this._ensureSweeperRunning();
    return wakeAt;
  }

  /**
   * Start the sweeper if it isn't already running and the service is enabled.
   * Called internally whenever a new sleep is registered.
   */
  private _ensureSweeperRunning(): void {
    if (!this.config.enabled) return;
    if (this.timer) return;
    void this.sweep();
    this.timer = setInterval(() => void this.sweep(), this.config.sweepIntervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    this.logger?.info?.('[DurableSleep] sweeper auto-started (active sleeps > 0)', {
      activeSleepCount: this.activeSleepCount,
    });
  }

  /**
   * Decrement the active-sleep count. Stops the sweeper when it reaches zero
   * so the timer doesn't burn CPU cycles on an idle server.
   */
  private _onWakeComplete(): void {
    this.activeSleepCount = Math.max(0, this.activeSleepCount - 1);
    if (this.activeSleepCount === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
      this.logger?.info?.('[DurableSleep] sweeper auto-stopped (no active sleeps)');
    }
  }

  /**
   * Start the background sweeper. No-op when `enabled=false`. Idempotent
   * — calling start() twice does not stack timers.
   *
   * W18 / P2-c — this is now a no-op by default; the sweeper starts on
   * demand when the first `sleep()` call arrives and stops automatically
   * when all sleeping stages have been woken. Call `start()` explicitly at
   * boot ONLY on a restarting server that may have pre-existing sleeping
   * rows in the DB (StartupRecoveryService does this). If you have nothing
   * sleeping, starting the sweeper wastes CPU burning SQL reads every
   * `sweepIntervalMs`.
   */
  start(): void {
    if (!this.config.enabled) {
      this.logger?.info?.('[DurableSleep] sweeper disabled by config');
      return;
    }
    if (this.timer) return;
    // Kick one sweep immediately so a stage whose wakeAt is already past
    // (server restart scenario) doesn't sit around for a full interval.
    // After a restart we don't know the exact count from memory, so treat
    // the count as at-least-1 to prevent an immediate auto-stop.
    if (this.activeSleepCount === 0) this.activeSleepCount = 1;
    void this.sweep();
    this.timer = setInterval(() => void this.sweep(), this.config.sweepIntervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    this.logger?.info?.('[DurableSleep] sweeper started', {
      intervalMs: this.config.sweepIntervalMs,
      maxWakesPerSweep: this.config.maxWakesPerSweep,
    });
  }

  /** Stop the background sweeper. Safe to call multiple times. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * Run a single sweep. Exposed for tests + manual wake-up.
   * Returns the number of stages actually woken (can be less than the
   * candidate pool if another sweeper raced and claimed some first).
   */
  async sweep(): Promise<{ woken: number; candidates: number }> {
    if (this.running) {
      // Reentrance guard — avoids stacking sweeps when the previous tick
      // is still running (rare, but happens if onWake handlers are slow).
      return { woken: 0, candidates: 0 };
    }
    this.running = true;
    try {
      const now = new Date();
      const candidates = await this.stageRunRepo.findSleepersReadyToWake(
        now,
        this.config.maxWakesPerSweep,
      );
      let woken = 0;
      for (const stage of candidates) {
        const claimed = await this.stageRunRepo.wake(stage.id);
        if (!claimed) {
          // Another sweeper got here first, or the row was cancelled.
          continue;
        }
        woken++;
        // W18 — decrement active count and auto-stop sweeper when drained.
        this._onWakeComplete();
        const overdueMs = stage.wakeAt ? Date.now() - stage.wakeAt.getTime() : 0;
        try {
          await this.eventBus.emitGlobal({
            kind: 'stage_run.woken',
            data: {
              stageRunId: stage.id,
              workflowRunId: stage.workflowRunId,
              overdueMs,
            },
          });
        } catch {
          // EventBus failure shouldn't stop the wake — row is already
          // queued. The normal scheduler will pick it up.
        }
        try {
          // Refetch the row so `onWake` sees the post-wake status/version.
          const queued = await this.stageRunRepo.getById(stage.id);
          await this.onWake(queued);
        } catch (err) {
          this.logger?.error?.('[DurableSleep] onWake handler threw', {
            stageRunId: stage.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      if (candidates.length > 0) {
        this.logger?.info?.('[DurableSleep] sweep complete', {
          candidates: candidates.length,
          woken,
        });
      }
      return { woken, candidates: candidates.length };
    } catch (err) {
      this.logger?.error?.('[DurableSleep] sweep failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return { woken: 0, candidates: 0 };
    } finally {
      this.running = false;
    }
  }
}
