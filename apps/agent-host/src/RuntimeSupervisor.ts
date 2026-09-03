/**
 * W12 — Runtime supervisor for provider processes.
 *
 * Manages the lifecycle of provider runtime instances inside the agent host:
 * registration, selection, and recycling by age and resident-set size.
 *
 * The demux does NOT live here. There is exactly one IPC channel back to the
 * gateway, so the resource that has to be shared fairly is that channel, not a
 * runtime — `AgentHostServer` owns the single demux that feeds it. Putting a
 * demux on each runtime would have produced two nested round-robins over one
 * writer with no added fairness.
 */

import type { ILogger } from '@generatorai/shared';
import type { IAgentHarness } from '@generatorai/core';

/* W12 — recycling budgets. */
export const MAX_RUNTIME_AGE_MS = 6 * 60 * 60 * 1000;
export const MAX_RUNTIME_RSS_BYTES = 500 * 1024 * 1024;
export const RSS_PROBE_MIN_AGE_MS = 5 * 60 * 1000;
/** Cold-start semaphore width — see AgentHostServer. */
export const MAX_CONCURRENT_SPAWN = 2;
/** Concurrent in-flight turns across all sessions — see AgentHostServer. */
export const MAX_CONCURRENT_EXECUTIONS = 16;
/** How often the recycle timer fires once started. */
export const RECYCLE_INTERVAL_MS = 60_000;

export interface RuntimeEntry {
  id: string;
  harness: IAgentHarness;
  startedAt: number;
  sessionCount: number;
  /** Last sampled RSS in bytes (undefined until the first probe). */
  lastRssBytes?: number;
  /** When RSS was last probed. */
  lastRssProbeAt?: number;
  /** Set while this runtime is being drained so it is never picked again. */
  draining?: boolean;
}

/** Why a runtime was selected for recycling. Kept a closed set for logging. */
export type RecycleReason = 'age' | 'rss';

export interface RuntimeSupervisorOptions {
  logger: ILogger;
  /**
   * Builds a replacement runtime during a recycle. Without it a recycle would
   * mean "kill the only runtime and serve nothing", so `runRecyclePass` refuses
   * to recycle at all when this is absent and says so once.
   */
  createHarness?: () => Promise<IAgentHarness>;
  /**
   * Moves live sessions off `from` and onto `to` before the old runtime is
   * stopped. Implemented by `AgentHostServer`, which is the only thing that
   * knows the sessionId → conversationId mapping. Must resolve only once every
   * session it intends to keep has been re-created on `to`.
   */
  drainSessions?: (from: RuntimeEntry, to: RuntimeEntry) => Promise<void>;
  /**
   * Asked before a runtime is recycled. Return a reason string to POSTPONE the
   * recycle, or undefined to allow it.
   *
   * A recycle is a drain-and-swap, and some work cannot be drained: an
   * in-flight turn is running on the old harness right now, and stopping that
   * harness destroys the turn with nothing to report to the gateway. Recycling
   * exists to bound age and memory, and both budgets tolerate waiting a minute;
   * a lost turn does not. The wait is bounded by whatever the caller uses to
   * decide "busy" — in the host, by the turn permit's own hard hold cap.
   */
  deferRecycle?: (entry: RuntimeEntry) => string | undefined;
  /**
   * Samples RSS for a runtime. Defaults to the HOST PROCESS RSS.
   *
   * That default is deliberately coarse and is the honest measurement
   * available: every harness registered here runs in-process (the provider's
   * own child CLIs are its private business and are not addressable from
   * here), so there is no per-runtime RSS to read. With one runtime — the only
   * shape the host ships today — process RSS *is* that runtime's RSS. When a
   * future host holds several, the budget degrades to a whole-host budget that
   * recycles the oldest offender first, which is why `runRecyclePass` sorts by
   * age. Injectable so a real per-runtime probe can replace it without
   * touching the policy.
   */
  probeRss?: (runtime: RuntimeEntry) => Promise<number | undefined>;
  maxRuntimeAgeMs?: number;
  maxRuntimeRssBytes?: number;
  rssProbeMinAgeMs?: number;
}

export class RuntimeSupervisor {
  /* W12 */
  private readonly runtimes = new Map<string, RuntimeEntry>();
  private readonly logger: ILogger;
  /** N12-fix: record construction time so stats().uptimeMs is elapsed, not epoch. */
  private readonly startedAt = Date.now();

  private readonly createHarness: (() => Promise<IAgentHarness>) | undefined;
  private readonly drainSessions: ((from: RuntimeEntry, to: RuntimeEntry) => Promise<void>) | undefined;
  private readonly deferRecycle: ((entry: RuntimeEntry) => string | undefined) | undefined;
  private readonly probeRss: (runtime: RuntimeEntry) => Promise<number | undefined>;
  private readonly maxRuntimeAgeMs: number;
  private readonly maxRuntimeRssBytes: number;
  private readonly rssProbeMinAgeMs: number;

  private recycleTimer: ReturnType<typeof setInterval> | undefined;
  /** Guards against a slow pass overlapping the next timer tick. */
  private recyclePassInFlight = false;
  /** So the "no factory, cannot recycle" warning is logged once, not per tick. */
  private warnedNoFactory = false;
  private recycleCount = 0;
  /** How many times a recycle was postponed because the runtime was busy. */
  private deferredRecycleCount = 0;

  constructor(loggerOrOptions: ILogger | RuntimeSupervisorOptions) {
    const opts: RuntimeSupervisorOptions =
      'logger' in loggerOrOptions
        ? (loggerOrOptions as RuntimeSupervisorOptions)
        : { logger: loggerOrOptions as ILogger };

    this.logger = opts.logger;
    this.createHarness = opts.createHarness;
    this.drainSessions = opts.drainSessions;
    this.deferRecycle = opts.deferRecycle;
    this.probeRss = opts.probeRss ?? (async () => process.memoryUsage().rss);
    this.maxRuntimeAgeMs = opts.maxRuntimeAgeMs ?? MAX_RUNTIME_AGE_MS;
    this.maxRuntimeRssBytes = opts.maxRuntimeRssBytes ?? MAX_RUNTIME_RSS_BYTES;
    this.rssProbeMinAgeMs = opts.rssProbeMinAgeMs ?? RSS_PROBE_MIN_AGE_MS;
  }

  /** Register a provider harness runtime. Returns an opaque runtime id. */
  register(harness: IAgentHarness): string {
    const id = `runtime-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const entry: RuntimeEntry = {
      id,
      harness,
      startedAt: Date.now(),
      sessionCount: 0,
    };
    this.runtimes.set(id, entry);
    this.logger.info(`[RuntimeSupervisor] Registered runtime ${id}`);
    return id;
  }

  /** Pick a suitable runtime for a new session: least-loaded, never draining. */
  pickRuntime(): RuntimeEntry | undefined {
    let best: RuntimeEntry | undefined;
    for (const entry of this.runtimes.values()) {
      // A draining runtime is on its way out; handing it a new session would
      // race the drain and strand that session on a stopped harness.
      if (entry.draining) continue;
      if (!best || entry.sessionCount < best.sessionCount) best = entry;
    }
    return best;
  }

  /** Get a runtime by id. */
  get(runtimeId: string): RuntimeEntry | undefined {
    return this.runtimes.get(runtimeId);
  }

  /** All registered runtimes, in registration order. */
  all(): RuntimeEntry[] {
    return [...this.runtimes.values()];
  }

  /** Remove a runtime from the registry. */
  remove(runtimeId: string): boolean {
    const entry = this.runtimes.get(runtimeId);
    if (!entry) return false;
    this.runtimes.delete(runtimeId);
    this.logger.info(`[RuntimeSupervisor] Removed runtime ${runtimeId}`);
    return true;
  }

  // ── Recycling ────────────────────────────────────────────────────────────

  /**
   * Start the periodic recycle timer. Idempotent. The timer is unref'd so it
   * never holds the host process open on its own.
   */
  startRecycleTimer(intervalMs: number = RECYCLE_INTERVAL_MS): void {
    if (this.recycleTimer) return;
    this.recycleTimer = setInterval(() => {
      void this.runRecyclePass().catch((err: unknown) =>
        this.logger.warn(`[RuntimeSupervisor] recycle pass failed: ${String(err)}`),
      );
    }, intervalMs);
    if (typeof this.recycleTimer.unref === 'function') this.recycleTimer.unref();
    this.logger.info(`[RuntimeSupervisor] Recycle timer started (every ${intervalMs}ms)`);
  }

  stopRecycleTimer(): void {
    if (this.recycleTimer) {
      clearInterval(this.recycleTimer);
      this.recycleTimer = undefined;
    }
  }

  /**
   * Probe every runtime and recycle the ones over budget.
   *
   * Policy (W12): recycle above `maxRuntimeAgeMs` (6 h) unconditionally, and
   * above `maxRuntimeRssBytes` (500 MB) — but only probe RSS once a runtime is
   * older than `rssProbeMinAgeMs` (5 min), because a freshly booted provider's
   * RSS is dominated by module loading and would recycle itself in a loop.
   *
   * Runtimes are considered oldest-first so that when the RSS reading is a
   * whole-host figure (the default probe — see `probeRss`) the oldest runtime
   * absorbs the recycle rather than whichever one happened to be iterated
   * first.
   */
  async runRecyclePass(): Promise<void> {
    if (this.recyclePassInFlight) return;
    this.recyclePassInFlight = true;
    try {
      const now = Date.now();
      const candidates: Array<{ entry: RuntimeEntry; reason: RecycleReason }> = [];

      const byAgeDesc = [...this.runtimes.values()].sort((a, b) => a.startedAt - b.startedAt);
      for (const entry of byAgeDesc) {
        if (entry.draining) continue;
        const age = now - entry.startedAt;

        if (age > this.maxRuntimeAgeMs) {
          candidates.push({ entry, reason: 'age' });
          continue;
        }

        if (age < this.rssProbeMinAgeMs) continue;

        const rss = await this.probeRss(entry);
        if (rss === undefined) continue;
        entry.lastRssBytes = rss;
        entry.lastRssProbeAt = now;
        if (rss > this.maxRuntimeRssBytes) {
          candidates.push({ entry, reason: 'rss' });
          // Only the oldest over-budget runtime is recycled per pass when the
          // probe is whole-host: recycling all of them would be reacting to
          // one number N times.
          break;
        }
      }

      if (candidates.length === 0) return;

      if (!this.createHarness) {
        if (!this.warnedNoFactory) {
          this.warnedNoFactory = true;
          this.logger.warn(
            '[RuntimeSupervisor] Runtimes are over budget but no createHarness factory was supplied — ' +
              'recycling is disabled. Sessions are safer on an oversized runtime than on none.',
          );
        }
        return;
      }

      for (const { entry, reason } of candidates) {
        // A recycle is never urgent enough to destroy work that cannot be
        // drained. Ask first; the next pass will ask again.
        const defer = this.deferRecycle?.(entry);
        if (defer) {
          this.deferredRecycleCount++;
          this.logger.info(
            `[RuntimeSupervisor] Postponing recycle of ${entry.id} (reason=${reason}): ${defer}`,
          );
          continue;
        }
        await this.recycleRuntime(entry, reason);
      }
    } finally {
      this.recyclePassInFlight = false;
    }
  }

  /**
   * Drain-and-swap: stand up a replacement runtime, move the sessions onto it,
   * then stop the old one. The old runtime is marked `draining` first so no new
   * session lands on it mid-swap, and it is only removed from the registry
   * AFTER the drain resolves — a session that is still mid-migration must still
   * be routable.
   */
  private async recycleRuntime(entry: RuntimeEntry, reason: RecycleReason): Promise<void> {
    const ageMs = Date.now() - entry.startedAt;
    this.logger.info(
      `[RuntimeSupervisor] Recycling runtime ${entry.id} (reason=${reason} ageMs=${ageMs} ` +
        `rssBytes=${entry.lastRssBytes ?? 'unprobed'} sessions=${entry.sessionCount})`,
    );

    entry.draining = true;
    let replacement: RuntimeEntry | undefined;
    try {
      const harness = await this.createHarness!();
      const id = this.register(harness);
      replacement = this.runtimes.get(id);
      if (!replacement) throw new Error('replacement runtime vanished immediately after registration');

      if (this.drainSessions) {
        await this.drainSessions(entry, replacement);
      }
    } catch (err: unknown) {
      // The swap failed. Un-drain the old runtime and keep serving from it —
      // a runtime over its memory budget still answers prompts; a host with no
      // runtime answers nothing. Tear the half-built replacement back down so
      // the next pass does not accumulate orphans.
      entry.draining = false;
      if (replacement) {
        this.runtimes.delete(replacement.id);
        await replacement.harness.stop().catch(() => {
          /* best effort — the replacement never took traffic */
        });
      }
      this.logger.error(
        `[RuntimeSupervisor] Recycle of ${entry.id} failed; keeping the old runtime: ${String(err)}`,
      );
      return;
    }

    this.runtimes.delete(entry.id);
    await entry.harness.stop().catch((err: unknown) =>
      this.logger.warn(`[RuntimeSupervisor] stop error while recycling ${entry.id}: ${String(err)}`),
    );
    this.recycleCount++;
    this.logger.info(`[RuntimeSupervisor] Runtime ${entry.id} recycled → ${replacement.id}`);
  }

  stats() {
    let totalSessions = 0;
    for (const e of this.runtimes.values()) totalSessions += e.sessionCount;
    return {
      runtimeCount: this.runtimes.size,
      totalSessions,
      rssBytes: process.memoryUsage().rss,
      // N12-fix: uptimeMs should be elapsed time since supervisor started,
      // not the raw Unix timestamp (Date.now()).
      uptimeMs: Date.now() - this.startedAt,
      recycleCount: this.recycleCount,
      deferredRecycleCount: this.deferredRecycleCount,
    };
  }

  async shutdown(): Promise<void> {
    this.stopRecycleTimer();
    const stops = [...this.runtimes.values()].map((e) =>
      e.harness.stop().catch((err: unknown) =>
        this.logger.warn(`[RuntimeSupervisor] stop error for ${e.id}: ${String(err)}`),
      ),
    );
    await Promise.allSettled(stops);
    this.runtimes.clear();
  }
}
