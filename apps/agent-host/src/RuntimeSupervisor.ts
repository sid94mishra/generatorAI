/**
 * W12 — Runtime supervisor for provider processes.
 *
 * Manages the lifecycle of provider runtime instances inside the agent host.
 * For Phase A this is a simple registry; Phase B adds recycling by age/RSS.
 *
 * Phase B TODOs (see W12 spec):
 *  - MAX_RUNTIME_AGE_MS = 6 * 60 * 60 * 1000 (6h) — recycle if older
 *  - MAX_RUNTIME_RSS_BYTES = 500 * 1024 * 1024 (500MB) — recycle if heavier
 *  - RSS_PROBE_MIN_AGE_MS = 5 * 60 * 1000 (5min) — don't probe young runtimes
 *  - MAX_CONCURRENT_SPAWN = 2 — cold-start semaphore
 *  - Single-reader demux: one runtime handles N sessions via sessionId routing
 */

import type { ILogger } from '@generatorai/shared';
import type { IAgentHarness } from '@generatorai/core';
import { SessionDemux } from './SessionDemux.js';

/* W12 / Phase B constants — not enforced in Phase A */
export const MAX_RUNTIME_AGE_MS = 6 * 60 * 60 * 1000;
export const MAX_RUNTIME_RSS_BYTES = 500 * 1024 * 1024;
export const RSS_PROBE_MIN_AGE_MS = 5 * 60 * 1000;
export const MAX_CONCURRENT_SPAWN = 2;

export interface RuntimeEntry {
  id: string;
  harness: IAgentHarness;
  demux: SessionDemux;
  startedAt: number;
  sessionCount: number;
  /** Phase B: last sampled RSS in bytes. */
  lastRssBytes?: number;
  /** Phase B: when RSS was last probed. */
  lastRssProbeAt?: number;
}

export class RuntimeSupervisor {
  /* W12 */
  private readonly runtimes = new Map<string, RuntimeEntry>();
  private readonly logger: ILogger;
  /** N12-fix: record construction time so stats().uptimeMs is elapsed, not epoch. */
  private readonly startedAt = Date.now();

  constructor(logger: ILogger) {
    this.logger = logger;
  }

  /** Register a provider harness runtime. Returns an opaque runtime id. */
  register(harness: IAgentHarness): string {
    const id = `runtime-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const entry: RuntimeEntry = {
      id,
      harness,
      demux: new SessionDemux(),
      startedAt: Date.now(),
      sessionCount: 0,
    };
    this.runtimes.set(id, entry);
    this.logger.info(`[RuntimeSupervisor] Registered runtime ${id}`);
    return id;
  }

  /** Pick a suitable runtime for a new session (Phase A: round-robin / first). */
  pickRuntime(): RuntimeEntry | undefined {
    // Phase A: pick the first healthy runtime
    // Phase B: pick by load, age, and RSS budget
    for (const entry of this.runtimes.values()) {
      return entry;
    }
    return undefined;
  }

  /** Get a runtime by id. */
  get(runtimeId: string): RuntimeEntry | undefined {
    return this.runtimes.get(runtimeId);
  }

  /** Remove a runtime from the registry. */
  remove(runtimeId: string): boolean {
    const entry = this.runtimes.get(runtimeId);
    if (!entry) return false;
    this.runtimes.delete(runtimeId);
    this.logger.info(`[RuntimeSupervisor] Removed runtime ${runtimeId}`);
    return true;
  }

  /** Phase B stub: probe RSS and recycle stale/heavy runtimes. */
  async runRecyclePass(): Promise<void> {
    // TODO (Phase B / W12): iterate runtimes, check age and RSS,
    // drain sessions to a fresh runtime, shut down old one.
    this.logger.info('[RuntimeSupervisor] recycle pass (Phase B not implemented)');
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
    };
  }

  async shutdown(): Promise<void> {
    const stops = [...this.runtimes.values()].map((e) =>
      e.harness.stop().catch((err: unknown) =>
        this.logger.warn(`[RuntimeSupervisor] stop error for ${e.id}: ${String(err)}`),
      ),
    );
    await Promise.allSettled(stops);
    this.runtimes.clear();
  }
}
