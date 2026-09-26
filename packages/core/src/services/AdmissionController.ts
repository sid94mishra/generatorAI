// ────────────────────────────────────────────────────────────────
// AdmissionController — W18 / SEC-08 lane-based backpressure.
//
// Purpose
// -------
// Route incoming work into one of three priority lanes so a flood
// of background batch jobs cannot prevent interactive chat turns from
// being processed promptly. Each lane has its own concurrency cap and
// an unbounded FIFO queue; callers `await admit(lane, fn)` to run `fn`
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
// The `attended` predicate
// ------------------------
// §3.9 makes lane selection one predicate: is a human waiting on this
// right now? `laneFor({ attended })` is that predicate, kept trivially
// cheap so the interactive path pays nothing for it. Reserved interactive
// capacity is what stops unattended fan-out from starving a person.
//
// Parking across long waits
// -------------------------
// A stage that blocks on human approval can sit there for hours. Holding
// its lane permit for that whole time is indistinguishable, from the
// controller's point of view, from the stage doing work — so N stages on
// approval would consume the whole lane and unrelated runs would stop.
// That is exactly what W18's acceptance criterion forbids ("with 8 stages
// on approval, unrelated runs still progress"). `admit` therefore hands
// `fn` a ticket: `pause()` gives the permit back before an external wait,
// `resume()` re-queues for one afterwards. Parked work is counted
// separately from running work so the health endpoint can tell the two
// apart — "8 parked" is a healthy backlog, "8 running for an hour" is not.
//
// Depth reporting
// ---------------
// `snapshot()` returns `{cap, running, waiting, parked}` per lane, which
// `/api/health` publishes. §3.9: "Publish depth in the health endpoint —
// makes throttling visible instead of mysterious."
//
// Queue-don't-reject
// ------------------
// Callers are never rejected for queue length — they wait, subject to
// `queueWaitTimeoutMs`. §3.9: "A rejected turn loses the issue it was
// mid-way through, while a queued one only starts late." The wait has its
// own timeout (default 1800 s) rather than consuming the turn's own
// deadline, so a throttled start is not misattributed to a hung provider.
// ────────────────────────────────────────────────────────────────

import * as os from 'node:os';
import { Semaphore } from '../utils/Semaphore.js';

export type AdmissionLane = 'interactive' | 'ordinary' | 'bulk';

/** §3.9 — the single lane discriminator. */
export interface AdmissionClassification {
  /** True when a human is waiting on this work right now. */
  attended: boolean;
  /** True for background/batch work that may always yield. */
  bulk?: boolean;
}

/**
 * Choose a lane from the `attended` predicate. Attended work is never
 * queued behind unattended work; `bulk` opts into the lowest lane.
 */
export function laneFor(c: AdmissionClassification): AdmissionLane {
  if (c.attended) return 'interactive';
  return c.bulk ? 'bulk' : 'ordinary';
}

/**
 * Handle given to an admitted task so it can yield its lane permit across
 * an external wait (human approval, hook backoff) instead of holding it.
 */
export interface AdmissionTicket {
  /** Give the permit back. Idempotent; a no-op if already parked. */
  pause(): void;
  /** Re-acquire a permit, queueing if the lane is full. Idempotent. */
  resume(): Promise<void>;
}

export interface AdmissionControllerConfig {
  /** Max concurrent `interactive` tasks. Default: dynamically sized. */
  interactiveConcurrency?: number;
  /** Max concurrent `ordinary` tasks. Default: dynamically sized. */
  ordinaryConcurrency?: number;
  /** Max concurrent `bulk` tasks. Default: dynamically sized. */
  bulkConcurrency?: number;
  /**
   * How long a caller may wait for a slot before `admit` rejects.
   * §3.9 gives the queue wait its own timeout so a throttled start is not
   * charged against the turn's own ceiling. Default 1_800_000 ms (30 min).
   * `0` disables the timeout.
   */
  queueWaitTimeoutMs?: number;
  /**
   * Flow keys: gates separate from the provider lanes (P05 §1.2). A flow is
   * a named concurrency cap; `check:global` (default 2) bounds the
   * `check` stages of every run. P07 surfaces them in settings.
   */
  flowLimits?: Record<string, number>;
  /** Structured logger. INFO on queue, WARN on timeout. */
  logger?: {
    info?: (msg: string, meta?: Record<string, unknown>) => void;
    warn?: (msg: string, meta?: Record<string, unknown>) => void;
  };
}

interface LaneState {
  semaphore: Semaphore;
  queued: number;
  running: number;
  parked: number;
}

export interface LaneSnapshot {
  lane: AdmissionLane;
  running: number;
  /** Callers waiting for a slot. */
  queued: number;
  /** Callers that yielded their permit across an external wait. */
  parked: number;
  concurrencyLimit: number;
}

/** How the effective concurrency for a lane was arrived at. */
export interface SizingDecision {
  lane: AdmissionLane;
  limit: number;
  /** Which constraint produced `limit` — the "active bound" §3.9 wants logged. */
  boundBy: 'configured' | 'cpu' | 'memory' | 'floor' | 'hardCap';
  cpuBound: number;
  memoryBound: number;
}

/** Error thrown when a caller waited longer than `queueWaitTimeoutMs`. */
export class AdmissionTimeoutError extends Error {
  constructor(
    readonly lane: AdmissionLane,
    readonly waitedMs: number,
  ) {
    super(`Admission timed out after ${waitedMs}ms waiting for a '${lane}' slot`);
    this.name = 'AdmissionTimeoutError';
  }
}

/** Per-lane sizing envelope. Floors keep a starved box usable; hard caps stop
 *  a large box from fanning out past what a provider CLI tolerates. §3.9's
 *  "cap 4, ceiling 16" is the ordinary lane's envelope. */
const SIZING: Record<AdmissionLane, { floor: number; hardCap: number; memMbPerTask: number }> = {
  // Attended work is small and must never be starved, so its floor is
  // non-trivial; its ceiling is low because a human can only watch so much.
  interactive: { floor: 2, hardCap: 8, memMbPerTask: 256 },
  // §3.9's named envelope for unattended agent work.
  ordinary: { floor: 2, hardCap: 16, memMbPerTask: 512 },
  // Background work yields to everything else.
  bulk: { floor: 1, hardCap: 4, memMbPerTask: 512 },
};

/**
 * Size a lane from measured machine capacity, clamped into its envelope,
 * reporting which bound was active. §3.9: "Size from measured cost; log
 * which bound is active — an explainable startup line beats a hardcoded
 * number that is wrong on every machine."
 */
export function sizeLane(
  lane: AdmissionLane,
  configured: number | undefined,
  probe: { cpus: number; totalMemBytes: number } = {
    cpus: os.cpus().length || 1,
    totalMemBytes: os.totalmem(),
  },
): SizingDecision {
  const { floor, hardCap, memMbPerTask } = SIZING[lane];
  const cpuBound = Math.max(1, probe.cpus);
  const memoryBound = Math.max(
    1,
    Math.floor(probe.totalMemBytes / (memMbPerTask * 1024 * 1024)),
  );

  if (configured !== undefined) {
    // An explicit setting wins, but is still clamped — W18 requires config
    // clamps with audit, so an operator cannot set 10_000 and remove the bound.
    //
    // The clamp floor here is 1, not the lane's `floor`. `floor` exists to stop
    // *auto-sizing* from producing an unusably small lane on a starved box; an
    // operator who deliberately sets 1 (a tiny VPS, or debugging a concurrency
    // bug) means it, and silently raising them to 2 would be a surprise. The
    // hard cap is the bound that actually matters, and it still applies. 0 is
    // clamped up rather than passed through, because `Semaphore` reads 0 as
    // "unlimited" — the opposite of what someone typing 0 into a cap intends.
    const limit = Math.min(hardCap, Math.max(1, configured));
    return { lane, limit, boundBy: 'configured', cpuBound, memoryBound };
  }

  const measured = Math.min(cpuBound, memoryBound);
  const limit = Math.min(hardCap, Math.max(floor, measured));
  const boundBy: SizingDecision['boundBy'] =
    limit === hardCap && measured > hardCap
      ? 'hardCap'
      : limit === floor && measured < floor
        ? 'floor'
        : memoryBound < cpuBound
          ? 'memory'
          : 'cpu';
  return { lane, limit, boundBy, cpuBound, memoryBound };
}

/** The default caps of the flow keys (P05 §1.2: `check:global` = 2). */
export const DEFAULT_FLOW_LIMITS: Readonly<Record<string, number>> = { 'check:global': 2 };

export class AdmissionController {
  private readonly lanes: Record<AdmissionLane, LaneState>;
  private readonly limits: Record<AdmissionLane, number>;
  private readonly sizing: SizingDecision[];
  private readonly queueWaitTimeoutMs: number;
  private readonly logger: AdmissionControllerConfig['logger'];
  private readonly flows = new Map<string, { semaphore: Semaphore; limit: number; running: number; queued: number }>();
  private readonly flowLimits: Record<string, number>;

  constructor(cfg: AdmissionControllerConfig = {}) {
    this.logger = cfg.logger;
    this.queueWaitTimeoutMs = cfg.queueWaitTimeoutMs ?? 1_800_000;
    this.flowLimits = { ...DEFAULT_FLOW_LIMITS, ...(cfg.flowLimits ?? {}) };

    this.sizing = [
      sizeLane('interactive', cfg.interactiveConcurrency),
      sizeLane('ordinary', cfg.ordinaryConcurrency),
      sizeLane('bulk', cfg.bulkConcurrency),
    ];

    this.limits = {
      interactive: this.sizing[0]!.limit,
      ordinary: this.sizing[1]!.limit,
      bulk: this.sizing[2]!.limit,
    };

    this.lanes = {
      interactive: { semaphore: new Semaphore(this.limits.interactive), queued: 0, running: 0, parked: 0 },
      ordinary: { semaphore: new Semaphore(this.limits.ordinary), queued: 0, running: 0, parked: 0 },
      bulk: { semaphore: new Semaphore(this.limits.bulk), queued: 0, running: 0, parked: 0 },
    };

    for (const d of this.sizing) {
      this.logger?.info?.('[Admission] lane sized', {
        lane: d.lane,
        limit: d.limit,
        boundBy: d.boundBy,
        cpuBound: d.cpuBound,
        memoryBound: d.memoryBound,
      });
    }
  }

  /** The sizing decisions taken at construction, for startup logs and tests. */
  sizingReport(): SizingDecision[] {
    return [...this.sizing];
  }

  /**
   * Run `fn` in the given lane, blocking until a concurrency slot is free.
   * Callers are queued (FIFO) rather than rejected, up to
   * `queueWaitTimeoutMs`. `fn` receives a ticket it can use to yield the
   * permit across an external wait. Returns whatever `fn` resolves with;
   * re-throws if `fn` rejects.
   */
  async admit<T>(lane: AdmissionLane, fn: (ticket: AdmissionTicket) => Promise<T>): Promise<T> {
    const state = this.lanes[lane];
    await this.acquireSlot(lane, state);

    state.running += 1;
    let held = true;

    const ticket: AdmissionTicket = {
      pause: () => {
        if (!held) return;
        held = false;
        state.running -= 1;
        state.parked += 1;
        state.semaphore.release();
      },
      resume: async () => {
        if (held) return;
        state.parked -= 1;
        try {
          await this.acquireSlot(lane, state);
        } catch (err) {
          // Re-park so the `finally` below accounts correctly, then surface.
          state.parked += 1;
          throw err;
        }
        state.running += 1;
        held = true;
      },
    };

    try {
      return await fn(ticket);
    } finally {
      if (held) {
        state.running -= 1;
        state.semaphore.release();
      } else {
        state.parked -= 1;
      }
    }
  }

  /**
   * Acquire one permit, counting the wait and enforcing the queue timeout.
   * §3.9 wants an INFO line whenever work actually queues — "the difference
   * between 'the fleet is throttled' and 'a worker is hung'".
   */
  private async acquireSlot(lane: AdmissionLane, state: LaneState): Promise<void> {
    const wouldQueue = state.semaphore.availablePermits <= 0;
    const startedAt = Date.now();

    if (wouldQueue) {
      this.logger?.info?.('[Admission] queued', {
        lane,
        running: state.running,
        queued: state.queued + 1,
        limit: this.limits[lane],
      });
    }

    state.queued += 1;
    try {
      if (this.queueWaitTimeoutMs > 0 && wouldQueue) {
        await this.acquireWithTimeout(lane, state, startedAt);
      } else {
        await state.semaphore.acquire();
      }
    } finally {
      state.queued -= 1;
    }

    if (wouldQueue) {
      this.logger?.info?.('[Admission] admitted after wait', {
        lane,
        waitedMs: Date.now() - startedAt,
      });
    }
  }

  /**
   * Race the semaphore against the queue-wait deadline. On timeout the
   * permit may still be granted later, so the pending acquire is chased and
   * the permit released rather than leaked.
   */
  private async acquireWithTimeout(
    lane: AdmissionLane,
    state: LaneState,
    startedAt: number,
  ): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    let timedOut = false;

    const acquired = state.semaphore.acquire().then(() => {
      if (timedOut) {
        // The waiter won the permit after we gave up. Hand it straight back
        // so the slot is not lost for the process lifetime.
        state.semaphore.release();
      }
      return 'acquired' as const;
    });

    const deadline = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        resolve('timeout');
      }, this.queueWaitTimeoutMs);
      // Never hold the process open just to enforce a queue deadline.
      timer.unref?.();
    });

    try {
      const outcome = await Promise.race([acquired, deadline]);
      if (outcome === 'timeout') {
        const waitedMs = Date.now() - startedAt;
        this.logger?.warn?.('[Admission] queue wait timed out', { lane, waitedMs });
        throw new AdmissionTimeoutError(lane, waitedMs);
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Number of callers currently waiting for a slot in `lane` (not yet
   * executing). Published by the health endpoint (W21).
   */
  depth(lane: AdmissionLane): number {
    return this.lanes[lane].queued;
  }

  /** Number of callers actively executing in `lane`. */
  running(lane: AdmissionLane): number {
    return this.lanes[lane].running;
  }

  /** Number of callers in `lane` parked on an external wait. */
  parked(lane: AdmissionLane): number {
    return this.lanes[lane].parked;
  }

  /**
   * Run `fn` under a flow key's own concurrency cap (not a lane): FIFO,
   * queue-don't-reject, no timeout of its own (the caller's queue timer
   * decides). The ticket yields the permit across an external wait.
   */
  async admitFlow<T>(flowKey: string, fn: (ticket: AdmissionTicket) => Promise<T>): Promise<T> {
    let flow = this.flows.get(flowKey);
    if (!flow) {
      const limit = Math.max(1, this.flowLimits[flowKey] ?? 1);
      flow = { semaphore: new Semaphore(limit), limit, running: 0, queued: 0 };
      this.flows.set(flowKey, flow);
    }
    const f = flow;
    f.queued += 1;
    try {
      await f.semaphore.acquire();
    } finally {
      f.queued -= 1;
    }
    f.running += 1;
    let held = true;
    const ticket: AdmissionTicket = {
      pause: () => {
        if (!held) return;
        held = false;
        f.running -= 1;
        f.semaphore.release();
      },
      resume: async () => {
        if (held) return;
        await f.semaphore.acquire();
        f.running += 1;
        held = true;
      },
    };
    try {
      return await fn(ticket);
    } finally {
      if (held) {
        f.running -= 1;
        f.semaphore.release();
      }
    }
  }

  /** Flow gates in use: running and queued per key. */
  flowSnapshot(): Array<{ flowKey: string; running: number; queued: number; limit: number }> {
    return [...this.flows].map(([flowKey, f]) => ({ flowKey, running: f.running, queued: f.queued, limit: f.limit }));
  }

  /** Full snapshot for observability (health endpoint, metrics). */
  snapshot(): LaneSnapshot[] {
    return (Object.keys(this.lanes) as AdmissionLane[]).map((lane) => ({
      lane,
      running: this.lanes[lane].running,
      queued: this.lanes[lane].queued,
      parked: this.lanes[lane].parked,
      concurrencyLimit: this.limits[lane],
    }));
  }
}
