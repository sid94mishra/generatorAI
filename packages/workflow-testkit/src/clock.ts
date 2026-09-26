// ────────────────────────────────────────────────────────────────
// Test clocks for the workflow testkit.
//
// The testkit owns two kinds of time:
//   - its OWN waits (a scripted turn's `delayMs`), which go through a
//     `TestClock` so a test can make them virtual and step them explicitly;
//   - the services' waits (reconciler tick, heartbeat, retry backoff, stage
//     timeout), which today read `Date.now()` / `setTimeout` directly and
//     accept no clock. Those run on real time, scaled down through the
//     setters the services do expose (see `TestEngineTiming`). The list of
//     services that read the wall clock directly is kept in
//     `docs/workflow-overhaul/STATUS.md` — PHASE-03 removes them, after
//     which `VirtualClock` drives the whole engine.
// ────────────────────────────────────────────────────────────────

export interface TestClock {
  now(): number;
  /** Resolve after `ms`, or immediately when `signal` aborts. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

/** Wall-clock time. The default. */
export class RealClock implements TestClock {
  now(): number {
    return Date.now();
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal?.aborted) return resolve();
      const timer = setTimeout(done, ms);
      function done(): void {
        clearTimeout(timer);
        signal?.removeEventListener('abort', done);
        resolve();
      }
      signal?.addEventListener('abort', done, { once: true });
    });
  }
}

interface PendingSleep {
  at: number;
  seq: number;
  resolve: () => void;
}

/**
 * Manually stepped time. `sleep()` resolves only when `advance()` moves the
 * clock past its deadline, in deadline order (ties in call order).
 */
export class VirtualClock implements TestClock {
  private current: number;
  private seq = 0;
  private pending: PendingSleep[] = [];

  constructor(start = Date.UTC(2026, 0, 1)) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal?.aborted) return resolve();
      const entry: PendingSleep = { at: this.current + Math.max(0, ms), seq: this.seq++, resolve };
      const onAbort = (): void => {
        this.pending = this.pending.filter((p) => p !== entry);
        resolve();
      };
      entry.resolve = () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.push(entry);
    });
  }

  /** Number of sleeps waiting on this clock. */
  get pendingCount(): number {
    return this.pending.length;
  }

  /**
   * Move time forward by `ms`, releasing every sleep whose deadline is
   * reached. Yields to the microtask queue between releases so a woken turn
   * can schedule its follow-up before the next one wakes.
   */
  async advance(ms: number): Promise<void> {
    const target = this.current + ms;
    for (;;) {
      this.pending.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const next = this.pending[0];
      if (!next || next.at > target) break;
      this.pending.shift();
      this.current = next.at;
      next.resolve();
      await new Promise<void>((r) => setImmediate(r));
    }
    this.current = target;
  }
}
