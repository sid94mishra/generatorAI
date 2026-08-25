// ────────────────────────────────────────────────────────────────
// AdmissionController — W18 / SEC-08 lane-based backpressure.
//
// Purpose
// -------
// Route incoming work into one of three priority lanes so a flood
// of background batch jobs cannot prevent interactive chat turns from
// being processed promptly. Each lane has its own concurrency cap and
// a bounded FIFO queue; callers `await admit(lane, fn)` to run `fn`
// when a slot opens.
//
// Lanes
// -----
//   interactive — UI-initiated chat turns, inline completions.
//                 Highest priority; small concurrency cap so the event
//                 loop is never saturated by a burst of simultaneous
//                 open tabs (cap is intentionally tighter than `ordinary`).
//   ordinary    — Normal workflow stage launches. Medium cap; backpressure
//                 is applied via queue depth (queue-don't-reject) so a
//                 wide DAG fan-out waits rather than erroring.
//   bulk        — Background tasks: embeddings, large artifact exports,
//                 batch re-runs. Lowest cap; operators can raise it via
//                 env vars without touching code.
//
// Depth reporting
// ---------------
// `depth(lane)` returns the number of callers currently queued (waiting
// for a slot, not yet executing). Published to the `/internal/health`
// endpoint so dashboards can detect backlog build-up before SLOs are
// breached.
//
// Queue-don't-reject
// ------------------
// Callers are NEVER rejected due to queue length — they wait. This
// matches the semantic requirement for workflow engine work: a stage
// that has just been launched must eventually run; dropping it would
// strand the run. Rate-limiting at the API layer (SEC-07) should be
// the first line of defence against excessive submission rates.
// ────────────────────────────────────────────────────────────────

import { Semaphore } from '../utils/Semaphore.js';

export type AdmissionLane = 'interactive' | 'ordinary' | 'bulk';

export interface AdmissionControllerConfig {
  /** Max concurrent `interactive` tasks (default 4). */
  interactiveConcurrency?: number;
  /** Max concurrent `ordinary` tasks (default 8). */
  ordinaryConcurrency?: number;
  /** Max concurrent `bulk` tasks (default 2). */
  bulkConcurrency?: number;
}

interface LaneState {
  semaphore: Semaphore;
  queued: number;
  running: number;
}

export interface LaneSnapshot {
  lane: AdmissionLane;
  running: number;
  queued: number;
  concurrencyLimit: number;
}

export class AdmissionController {
  private readonly lanes: Record<AdmissionLane, LaneState>;
  private readonly limits: Record<AdmissionLane, number>;

  constructor(cfg: AdmissionControllerConfig = {}) {
    const interactiveLimit = cfg.interactiveConcurrency ?? 4;
    const ordinaryLimit = cfg.ordinaryConcurrency ?? 8;
    const bulkLimit = cfg.bulkConcurrency ?? 2;

    this.limits = {
      interactive: interactiveLimit,
      ordinary: ordinaryLimit,
      bulk: bulkLimit,
    };

    this.lanes = {
      interactive: { semaphore: new Semaphore(interactiveLimit), queued: 0, running: 0 },
      ordinary: { semaphore: new Semaphore(ordinaryLimit), queued: 0, running: 0 },
      bulk: { semaphore: new Semaphore(bulkLimit), queued: 0, running: 0 },
    };
  }

  /**
   * Run `fn` in the given lane, blocking until a concurrency slot is free.
   * Callers are queued (FIFO) rather than rejected. Returns whatever `fn`
   * resolves with; re-throws if `fn` rejects.
   */
  async admit<T>(lane: AdmissionLane, fn: () => Promise<T>): Promise<T> {
    const state = this.lanes[lane];
    state.queued += 1;
    try {
      await state.semaphore.acquire();
    } finally {
      state.queued -= 1;
    }
    state.running += 1;
    try {
      return await fn();
    } finally {
      state.running -= 1;
      state.semaphore.release();
    }
  }

  /**
   * Number of callers currently waiting for a slot in `lane` (not yet
   * executing). Published by the health endpoint (W21).
   */
  depth(lane: AdmissionLane): number {
    return this.lanes[lane].queued;
  }

  /**
   * Number of callers actively executing in `lane`.
   */
  running(lane: AdmissionLane): number {
    return this.lanes[lane].running;
  }

  /**
   * Full snapshot for observability (health endpoint, metrics).
   */
  snapshot(): LaneSnapshot[] {
    return (Object.keys(this.lanes) as AdmissionLane[]).map((lane) => ({
      lane,
      running: this.lanes[lane].running,
      queued: this.lanes[lane].queued,
      concurrencyLimit: this.limits[lane],
    }));
  }
}
