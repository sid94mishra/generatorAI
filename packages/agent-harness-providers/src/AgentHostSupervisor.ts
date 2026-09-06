// ────────────────────────────────────────────────────────────────
// AgentHostSupervisor — W12 (Phase 3)
//
// Supervised host owning provider runtimes. In Phase 3, the supervisor
// runs IN-PROCESS (behind the `GENERATORAI_AGENT_HOST_PROCESS` flag,
// which defaults to false). The same interface will be used for the
// out-of-process Agent Host in a later phase without changing callers.
//
// Responsibilities:
//   - Bounded spawn concurrency via two semaphores:
//       executionSemaphore — caps concurrent turns across ALL sessions
//       coldStartSemaphore — caps concurrent new provider startups
//   - Instance lifecycle: start, health-check, recycle by age/RSS
//   - Single-reader demux: each session is assigned to one instance;
//     two sessions on the same instance never interleave (in-process
//     today; enforced by IPC protocol in the out-of-process host)
//
// P0-13 / P0-14 fixes:
//   P0-13 — one Copilot CLI for the entire server → W36 assigns one
//     instance per workspace using this supervisor
//   P0-14 — Claude spawns one CLI per turn, uncapped → execution
//     semaphore limits concurrent turns; cold-start semaphore limits
//     concurrent new-process launches
// ────────────────────────────────────────────────────────────────

// No logger import needed here — status is logged via the passed-in logger
// option or directly by callers. The supervisor itself only logs at debug level
// via `logStatus()`, which uses the logger injected through options (if any).

// ── Semaphore ──────────────────────────────────────────────────────

/**
 * W12 — minimal FIFO counting semaphore shared across supervisor operations.
 * Re-declared here (vs. importing from tool-factory) so AgentHostSupervisor
 * remains independent of any provider-specific code.
 */
class BoundedSemaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];
  readonly permits: number;

  constructor(permits: number) {
    this.permits = permits;
    this.available = permits > 0 ? permits : Number.POSITIVE_INFINITY;
  }

  async acquire(): Promise<void> {
    if (this.tryAcquire()) return;
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  /** Take a permit only if one is free right now. Never waits. */
  tryAcquire(): boolean {
    if (this.available > 0) {
      this.available--;
      return true;
    }
    return false;
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
    } else {
      this.available++;
    }
  }

  /** Run `fn` with one permit held, releasing on completion or error. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /** Current number of waiters (useful for health metrics). */
  get queueDepth(): number {
    return this.waiters.length;
  }
}

/**
 * Default cap on concurrent agent turns. See `maxConcurrentExecutions`.
 * Exported so the docs (`.github/docs/operations.md`) and the out-of-process
 * agent host can quote the same number.
 */
export const DEFAULT_MAX_CONCURRENT_AGENT_TURNS = 4;

// ── Options ────────────────────────────────────────────────────────

export interface AgentHostSupervisorOptions {
  /**
   * Maximum concurrent agent turns across all sessions (default: 4).
   * When this limit is reached, new turns queue rather than reject — the
   * admission controller (W18) decides whether to reject upstream — and the
   * provider announces the wait (`harness.session_info` / `queued`).
   * Set via `GENERATORAI_MAX_CONCURRENT_AGENT_TURNS`.
   *
   * Why 4: each Claude turn is a CLI process of ~250 MB RSS. The previous
   * default of 16 meant a worst case around 4 GB for what is, by default, a
   * single-user desktop application (APPLICATION-REVIEW-2026-09 §4.1).
   */
  maxConcurrentExecutions?: number;

  /**
   * Maximum concurrent provider cold-starts (new process launches) at
   * once (default: 4). A cold-start holds this permit only until the
   * provider is initialized (connected + authenticated), not for the
   * full turn duration. Set via `GENERATORAI_MAX_CONCURRENT_COLD_STARTS`.
   */
  maxConcurrentColdStarts?: number;

  /**
   * Recycle an instance after it has been alive for this many ms (default: 6h).
   * Probed only when the instance is idle and has been alive > rssProbeMinAgeMs.
   */
  instanceMaxAgeMs?: number;

  /**
   * Recycle an instance whose RSS exceeds this many bytes (default: 500 MB).
   * Only checked when the instance is idle and age > rssProbeMinAgeMs.
   */
  instanceMaxRssBytes?: number;

  /**
   * Do not probe RSS until an instance has been alive for at least this
   * many ms (default: 5 min). Fresh instances always have elevated RSS
   * due to module loading; probing too early causes unnecessary churn.
   */
  rssProbeMinAgeMs?: number;
}

// ── Public interface ───────────────────────────────────────────────

/**
 * Snapshot of current supervisor load — published by the health endpoint (W18).
 */
export interface AgentHostSnapshot {
  /** Max concurrent agent turns. */
  maxConcurrentExecutions: number;
  /** Active turns (execution semaphore permits in use). */
  activeExecutions: number;
  /** Turns waiting for an execution slot. */
  executionQueueDepth: number;
  /** Max concurrent cold-starts. */
  maxConcurrentColdStarts: number;
  /** Cold-starts in progress. */
  activeColdStarts: number;
  /** Number of managed instances. */
  instanceCount: number;
}

// ── Internal instance metadata ─────────────────────────────────────

interface InstanceRecord {
  /** Monotonic creation time (ms since epoch). */
  createdAt: number;
  /** True while a turn is executing on this instance. */
  inUse: boolean;
  /** Logical session ids assigned to this instance. */
  sessionIds: Set<string>;
}

// ── AgentHostSupervisor ────────────────────────────────────────────

/**
 * W12 — manages bounded concurrency for all provider runtimes.
 *
 * Usage pattern:
 * ```ts
 * const supervisor = new AgentHostSupervisor();
 *
 * // In ClaudeAgentProvider.sendPromptAndWait():
 * const release = await supervisor.acquireExecution();
 * try {
 *   return await this.runQuery(conversationId, prompt, ...);
 * } finally {
 *   release();
 * }
 *
 * // In composition-root during provider initialization:
 * const releaseCold = await supervisor.acquireColdStart();
 * try {
 *   await provider.initialize();
 * } finally {
 *   releaseCold();
 * }
 * ```
 */
export class AgentHostSupervisor {
  // ── Concurrency semaphores ─────────────────────────────────────

  private readonly executionSemaphore: BoundedSemaphore;
  private readonly coldStartSemaphore: BoundedSemaphore;

  // ── Instance tracking ──────────────────────────────────────────

  /**
   * Known instances keyed by an opaque instance id. The id is assigned by
   * the caller (typically the provider's session/conversation id) when an
   * instance is registered. In the out-of-process design this becomes the
   * pid of the host child process.
   */
  private readonly instances = new Map<string, InstanceRecord>();

  // ── Lifecycle ──────────────────────────────────────────────────

  readonly maxAgeMs: number;
  readonly maxRssBytes: number;
  readonly rssProbeMinAgeMs: number;

  constructor(opts?: AgentHostSupervisorOptions) {
    const maxExec = opts?.maxConcurrentExecutions
      ?? Number(process.env['GENERATORAI_MAX_CONCURRENT_AGENT_TURNS'] ?? DEFAULT_MAX_CONCURRENT_AGENT_TURNS);
    const maxCold = opts?.maxConcurrentColdStarts
      ?? Number(process.env['GENERATORAI_MAX_CONCURRENT_COLD_STARTS'] ?? 4);

    this.executionSemaphore = new BoundedSemaphore(maxExec);
    this.coldStartSemaphore = new BoundedSemaphore(maxCold);

    this.maxAgeMs        = opts?.instanceMaxAgeMs     ?? 6 * 60 * 60_000;   // 6 h
    this.maxRssBytes     = opts?.instanceMaxRssBytes   ?? 500 * 1024 * 1024; // 500 MB
    this.rssProbeMinAgeMs = opts?.rssProbeMinAgeMs    ?? 5 * 60_000;         // 5 min
  }

  // ── Semaphore API (W12) ────────────────────────────────────────

  /**
   * Acquire one execution slot. The returned function releases it.
   * Call this BEFORE spawning a new agent turn (before `query()`).
   *
   * Callers must always call the release function — typically via
   * `try { return await fn(); } finally { release(); }`.
   */
  async acquireExecution(): Promise<() => void> {
    await this.executionSemaphore.acquire();
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.executionSemaphore.release();
      }
    };
  }

  /**
   * Take an execution slot ONLY if one is free right now; `undefined` when
   * the caller would have to wait. Lets a provider tell the user it is queued
   * (and how many turns are ahead — `snapshot().executionQueueDepth`) before
   * falling back to `acquireExecution()`.
   */
  tryAcquireExecution(): (() => void) | undefined {
    if (!this.executionSemaphore.tryAcquire()) return undefined;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.executionSemaphore.release();
      }
    };
  }

  /**
   * Acquire one cold-start slot. The returned function releases it.
   * Hold only for the duration of `initialize()`, not the full turn.
   */
  async acquireColdStart(): Promise<() => void> {
    await this.coldStartSemaphore.acquire();
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.coldStartSemaphore.release();
      }
    };
  }

  // ── Instance lifecycle (W12) ───────────────────────────────────

  /**
   * Register a new provider instance. Call when a provider is started.
   * The instanceId is typically the conversationId or a provider process pid.
   */
  registerInstance(instanceId: string, sessionId?: string): void {
    const existing = this.instances.get(instanceId);
    if (existing) {
      if (sessionId) existing.sessionIds.add(sessionId);
      return;
    }
    this.instances.set(instanceId, {
      createdAt: Date.now(),
      inUse: false,
      sessionIds: new Set(sessionId ? [sessionId] : []),
    });
  }

  /** Mark an instance as currently executing a turn. */
  markInUse(instanceId: string): void {
    const record = this.instances.get(instanceId);
    if (record) record.inUse = true;
  }

  /** Mark an instance as idle (turn completed). */
  markIdle(instanceId: string): void {
    const record = this.instances.get(instanceId);
    if (record) record.inUse = false;
  }

  /** Unregister an instance (process exited or conversation deleted). */
  unregisterInstance(instanceId: string): void {
    this.instances.delete(instanceId);
  }

  /**
   * Returns true if the instance should be recycled based on age/RSS.
   * Age is always checked; RSS is only checked after `rssProbeMinAgeMs`.
   * Only idle instances are candidates for recycling.
   */
  shouldRecycle(instanceId: string, rssBytes?: number): boolean {
    const record = this.instances.get(instanceId);
    if (!record || record.inUse) return false;

    const ageMs = Date.now() - record.createdAt;
    if (ageMs >= this.maxAgeMs) return true;
    if (rssBytes !== undefined && ageMs >= this.rssProbeMinAgeMs) {
      if (rssBytes >= this.maxRssBytes) return true;
    }
    return false;
  }

  // ── Health / metrics ───────────────────────────────────────────

  /**
   * W12 / W18 — synchronous snapshot for the health endpoint.
   * Never triggers a refresh — safe to call on the hot path.
   */
  snapshot(): AgentHostSnapshot {
    const exec = this.executionSemaphore;
    const cold = this.coldStartSemaphore;
    return {
      maxConcurrentExecutions:  exec.permits,
      activeExecutions:         exec.permits - (exec as unknown as { available: number }).available > 0
                                  ? exec.permits - (exec as unknown as { available: number }).available
                                  : 0,
      executionQueueDepth:      exec.queueDepth,
      maxConcurrentColdStarts:  cold.permits,
      // M7-fix: mirror the same formula used for activeExecutions — derive from
      // available count rather than queue depth (queue depth counts waiters,
      // not holders, so it's always wrong when ≤ permits are in use).
      activeColdStarts:         Math.max(0, cold.permits - (cold as unknown as { available: number }).available),
      instanceCount:            this.instances.size,
    };
  }

  /**
   * Log current load. Callers may subscribe to `snapshot()` for structured
   * metrics; this method emits a one-line console summary at process startup
   * and can be wired to any logger by the caller.
   *
   * W18 health route uses `snapshot()` directly for structured output.
   */
  logStatus(): void {
    const s = this.snapshot();
    // Lightweight console log; no external logger dependency in this package.
    // The server composition root owns the structured logger; if it wants to
    // log supervisor state it should call `snapshot()` and log the result.
    // eslint-disable-next-line no-console
    console.debug(
      `[AgentHostSupervisor] exec=${s.activeExecutions}/${s.maxConcurrentExecutions}` +
      ` q=${s.executionQueueDepth} cold=${s.activeColdStarts}/${s.maxConcurrentColdStarts}` +
      ` instances=${s.instanceCount}`,
    );
  }
}

// ── Default singleton (in-process mode) ───────────────────────────

/**
 * Process-wide AgentHostSupervisor for in-process operation.
 * In the out-of-process design this is replaced by an IPC client.
 *
 * Initialised with env-configurable defaults; the composition root
 * may provide a custom instance for testing or alternate limits.
 */
export const defaultAgentHostSupervisor = new AgentHostSupervisor();
