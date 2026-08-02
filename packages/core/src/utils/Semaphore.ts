// ────────────────────────────────────────────────────────────────
// Semaphore — a tiny FIFO async concurrency limiter.
//
// Used to bound how many stages execute (and therefore how many harness
// subprocesses spawn) at once. A self-hosted instance on a small VPS must
// not fan out 100 ready stages into 100 concurrent CLI subprocesses; this
// gives natural backpressure: `acquire()` resolves only when a slot is
// free, so a fire-and-forget launcher simply awaits its turn.
//
// Deliberately dependency-free and unbounded in queue length — callers are
// already bounded by the DAG size of in-flight runs, and waiters are cheap
// (one pending promise each). `permits <= 0` disables limiting entirely
// (every acquire resolves immediately), so it is safe to construct with a
// "0 = unlimited" config.
// ────────────────────────────────────────────────────────────────

export class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];
  private readonly unlimited: boolean;

  /** @param permits Max concurrent holders. `<= 0` means unlimited. */
  constructor(permits: number) {
    this.unlimited = permits <= 0;
    this.available = this.unlimited ? Number.POSITIVE_INFINITY : permits;
  }

  /** Acquire one permit, waiting (FIFO) until one is free. */
  async acquire(): Promise<void> {
    if (this.unlimited) return;
    if (this.available > 0) {
      this.available -= 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  /** Release one permit, handing it directly to the next waiter if any. */
  release(): void {
    if (this.unlimited) return;
    const next = this.waiters.shift();
    if (next) {
      // Hand the permit straight to the waiter — don't bump `available`,
      // otherwise the slot would be double-counted.
      next();
      return;
    }
    this.available += 1;
  }

  /**
   * Run `fn` while holding a permit, releasing on completion (even on
   * throw). Preferred over manual acquire/release so a permit can never
   * leak when the task errors.
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /** Permits currently free (Infinity when unlimited). For tests/metrics. */
  get availablePermits(): number {
    return this.available;
  }

  /** Number of callers currently waiting for a permit. For tests/metrics. */
  get pending(): number {
    return this.waiters.length;
  }
}
