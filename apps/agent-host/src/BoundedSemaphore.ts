/**
 * W12 — minimal FIFO counting semaphore.
 *
 * Deliberately a local copy rather than an import from
 * `@generatorai/agent-harness-providers`' AgentHostSupervisor: that class is
 * the IN-PROCESS bound, and the whole point of this one is that it applies
 * inside the host process, where the in-process supervisor is not in the call
 * path at all. Turning the agent host on used to REMOVE the bound the
 * in-process path had; this restores it on the far side of the IPC boundary.
 *
 * FIFO because a LIFO semaphore starves the oldest waiter under sustained
 * load — the session that has already waited longest is exactly the one a
 * user is staring at.
 */
export class BoundedSemaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];
  readonly permits: number;

  constructor(permits: number) {
    // A non-positive permit count means "unbounded" rather than "deadlock":
    // an operator who sets the env var to 0 should get the old behaviour, not
    // a server where no turn can ever start.
    this.permits = permits;
    this.available = permits > 0 ? permits : Number.POSITIVE_INFINITY;
  }

  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available--;
      return;
    }
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
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

  /** Number of callers currently blocked in `acquire()`. */
  get queueDepth(): number {
    return this.waiters.length;
  }

  /** Permits not currently held. `Infinity` when constructed unbounded. */
  get availablePermits(): number {
    return this.available;
  }
}
