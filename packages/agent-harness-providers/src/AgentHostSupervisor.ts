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
//       execution gate     — caps concurrent turns across ALL sessions
//                            (the server's provider:claude-agent flow key)
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

/** The rejection of a permit wait withdrawn by its abort signal. */
function abortError(): Error {
  const err = new Error('The permit wait was aborted');
  err.name = 'AbortError';
  return err;
}

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

  /**
   * Wait for a permit. An abort of `signal` while waiting removes the waiter
   * (so no permit is ever handed to it) and rejects with an `AbortError`.
   */
  async acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw abortError();
    if (this.tryAcquire()) return;
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        const i = this.waiters.indexOf(grant);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(abortError());
      };
      const grant = () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      this.waiters.push(grant);
      signal?.addEventListener('abort', onAbort, { once: true });
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
 * Default cap on concurrent agent turns when no execution gate is set (the
 * SDK, tests). The server sets the gate to its `provider:claude-agent` flow
 * key (P07 WP-7.2), whose default is the same 4.
 */
export const DEFAULT_MAX_CONCURRENT_AGENT_TURNS = 4;

/**
 * Where turn permits come from (P07 WP-7.2): by default a semaphore of the
 * supervisor's own; the server hands it the admission controller's
 * `provider:<id>` flow gate, so chat turns and workflow stages count
 * against the one configurable limit (no hidden cap).
 */
export interface ExecutionGate {
  /** A permit only if one is free right now (never waits). */
  tryAcquire(): (() => void) | undefined;
  /** Wait for a permit; an abort of `signal` withdraws the wait and rejects (`AbortError`). */
  acquire(signal?: AbortSignal): Promise<() => void>;
  state(): { running: number; queued: number; limit: number | undefined };
}

function semaphoreGate(sem: BoundedSemaphore): ExecutionGate {
  const permit = (): (() => void) => {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      sem.release();
    };
  };
  return {
    tryAcquire: () => (sem.tryAcquire() ? permit() : undefined),
    acquire: async (signal) => {
      await sem.acquire(signal);
      return permit();
    },
    state: () => ({
      running: Math.max(0, sem.permits - (sem as unknown as { available: number }).available),
      queued: sem.queueDepth,
      limit: sem.permits,
    }),
  };
}

// ── Options ────────────────────────────────────────────────────────

export interface AgentHostSupervisorOptions {
  /**
   * Maximum concurrent agent turns across all sessions when no execution
   * gate is set (default: 4). The server replaces it with its
   * `provider:claude-agent` flow key (`useExecutionGate`), configured in
   * Settings → Workflow engine.
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

  private executionGate: ExecutionGate;
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
    const maxExec = opts?.maxConcurrentExecutions ?? DEFAULT_MAX_CONCURRENT_AGENT_TURNS;
    const maxCold = opts?.maxConcurrentColdStarts
      ?? Number(process.env['GENERATORAI_MAX_CONCURRENT_COLD_STARTS'] ?? 4);

    this.executionGate = semaphoreGate(new BoundedSemaphore(maxExec));
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
   * `try { return await fn(); } finally { release(); }`. An abort of `signal`
   * before the permit arrives withdraws the wait: it rejects (`AbortError`)
   * and no permit is held.
   */
  async acquireExecution(signal?: AbortSignal): Promise<() => void> {
    return this.executionGate.acquire(signal);
  }

  /**
   * Take turn permits from `gate` from now on (P07 WP-7.2: the server's
   * `provider:claude-agent` flow key). Permits already handed out are
   * released to the gate that issued them.
   */
  useExecutionGate(gate: ExecutionGate): void {
    this.executionGate = gate;
  }

  /**
   * Take an execution slot ONLY if one is free right now; `undefined` when
   * the caller would have to wait. Lets a provider tell the user it is queued
   * (and how many turns are ahead — `snapshot().executionQueueDepth`) before
   * falling back to `acquireExecution()`.
   */
  tryAcquireExecution(): (() => void) | undefined {
    return this.executionGate.tryAcquire();
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
    const exec = this.executionGate.state();
    const cold = this.coldStartSemaphore;
    return {
      maxConcurrentExecutions:  exec.limit ?? 0,
      activeExecutions:         exec.running,
      executionQueueDepth:      exec.queued,
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
