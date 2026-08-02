// ────────────────────────────────────────────────────────────────
// Backoff policy.
//
// Split out because it is the single easiest thing to get subtly wrong, and
// the consequences are invisible in development (one client, fast LAN) and
// severe in production (every phone on a flaky train wifi retrying in
// lockstep against one home server).
// ────────────────────────────────────────────────────────────────

export interface BackoffOptions {
  /** Delay before the FIRST retry. */
  baseMs?: number;
  /** Ceiling, so a long outage does not push retries hours out. */
  maxMs?: number;
  /** Growth per attempt. */
  factor?: number;
  /**
   * Proportion of the delay that is randomised, 0..1.
   *
   * Without jitter every client that dropped during the same server restart
   * retries at the same instant, and the thundering herd knocks the server
   * over again. 0.3 spreads a 10s retry across 7–10s.
   */
  jitter?: number;
  /** Injected for tests; must return 0..1. */
  random?: () => number;
}

const DEFAULTS = {
  baseMs: 500,
  maxMs: 30_000,
  factor: 2,
  jitter: 0.3,
} as const;

export class Backoff {
  private attempt = 0;
  private readonly opts: Required<Omit<BackoffOptions, 'random'>> & { random: () => number };

  constructor(options: BackoffOptions = {}) {
    this.opts = {
      baseMs: options.baseMs ?? DEFAULTS.baseMs,
      maxMs: options.maxMs ?? DEFAULTS.maxMs,
      factor: options.factor ?? DEFAULTS.factor,
      jitter: options.jitter ?? DEFAULTS.jitter,
      random: options.random ?? Math.random,
    };
  }

  /** Attempts recorded since the last reset. */
  get attempts(): number {
    return this.attempt;
  }

  /** Delay for the next retry, advancing the attempt counter. */
  next(): number {
    const raw = this.opts.baseMs * this.opts.factor ** this.attempt;
    this.attempt += 1;
    const capped = Math.min(raw, this.opts.maxMs);
    // Jitter subtracts only, so the cap is a true upper bound.
    const spread = capped * this.opts.jitter;
    return Math.round(capped - spread * this.opts.random());
  }

  /** Call on a successful connection. */
  reset(): void {
    this.attempt = 0;
  }
}
