// ────────────────────────────────────────────────────────────────
// ToolSemaphore — W13 / X-1, bounding parallel tool execution.
//
// Declared here (not imported from @generatorai/core) because
// agent-harness-providers must not import from the services layer, only from
// the domain ports layer, and Semaphore lives in core/utils (services layer).
//
// Shared by every provider's tool factory. Originally lived only in
// claude-agent/tool-factory.ts; moved here during end-to-end review because
// CopilotProvider's own custom-tool handlers (copilot/tool-factory.ts) had no
// concurrency bound at all — X-1's "a model emitting 30 tool calls spawns 30
// concurrent effects" applied to Copilot exactly as much as Claude, just
// unfixed.
// ────────────────────────────────────────────────────────────────

import { PoisonPillRegistry } from './hardening/poisonPill.js';
import { ByteCapper } from './hardening/byteCap.js';
import { TurnExecutionLatch, TruncatedTurnError } from './hardening/truncation.js';
import { FanOutAbortError } from './hardening/errors.js';
// Type-only: erased at compile time, so this does NOT pull `fanout.js` into
// the module graph — the implementation still arrives via the `await import`
// below. Named here rather than inline because `consistent-type-imports`
// forbids the `import('…').T` annotation form.
import type { FanOutOutcome } from './hardening/fanout.js';

/**
 * W13 — `MAX_PARALLEL_TOOLS = 8`.
 *
 * Declared here rather than twice in the two providers, which each had their
 * own `const MAX_PARALLEL_TOOLS = Number(process.env[...] ?? 8)`. Two copies of
 * a bound is two bounds: the moment one provider's default drifts, "8" stops
 * being a provider-wide guarantee and becomes a coincidence.
 *
 * Set `GENERATORAI_MAX_PARALLEL_TOOLS=0` to disable limiting.
 */
export const MAX_PARALLEL_TOOLS = ((): number => {
  const raw = Number(process.env['GENERATORAI_MAX_PARALLEL_TOOLS'] ?? 8);
  // A non-numeric env var must not silently become "unlimited" (NaN > 0 is
  // false, so the semaphore would read it as <= 0 and stop bounding anything).
  return Number.isFinite(raw) ? raw : 8;
})();

/**
 * W13 — per-item budget applied by `runGuarded`.
 *
 * Deliberately generous: real tools legitimately take minutes (a build, a test
 * run, a large read). The bound exists to reap a WEDGED handler, not to
 * second-guess a slow one.
 */
export const DEFAULT_TOOL_TIMEOUT_MS = ((): number => {
  const raw = Number(process.env['GENERATORAI_TOOL_TIMEOUT_MS'] ?? 120_000);
  return Number.isFinite(raw) && raw >= 0 ? raw : 120_000;
})();

/** W13 — hardening attached to one semaphore, i.e. to one provider instance. */
export interface ToolSemaphoreHardening {
  /** Poison-pill ladder, shared across every tool call on this instance. */
  poison?: PoisonPillRegistry;
  /** Per-record byte cap. Tool factories apply it to the rendered result. */
  byteCap?: ByteCapper;
  /** Truncation latch — a truncated turn's handlers refuse to run. */
  latch?: TurnExecutionLatch;
  /** Per-item timeout in ms. `<= 0` disables. */
  perItemTimeoutMs?: number;
}

export class ToolSemaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  /**
   * W13 — the hardening every tool call on this instance passes through.
   * Constructed eagerly with working defaults, so a provider that does nothing
   * but `new ToolSemaphore(MAX_PARALLEL_TOOLS)` still gets the poison-pill
   * ladder, the per-item timeout and the byte cap. "Built but never wired" is
   * the failure mode this package's audit names eleven times; defaults are how
   * a mechanism stays wired when a call site forgets it.
   */
  readonly poison: PoisonPillRegistry;
  readonly byteCap: ByteCapper;
  readonly latch: TurnExecutionLatch;
  readonly perItemTimeoutMs: number;

  /** @param permits Max concurrent tool calls. <= 0 means unlimited. */
  constructor(readonly permits: number, hardening: ToolSemaphoreHardening = {}) {
    this.available = permits > 0 ? permits : Number.POSITIVE_INFINITY;
    this.poison = hardening.poison ?? new PoisonPillRegistry();
    this.byteCap = hardening.byteCap ?? new ByteCapper();
    this.latch = hardening.latch ?? new TurnExecutionLatch();
    this.perItemTimeoutMs = hardening.perItemTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
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

  /** Run `fn` with one permit held, releasing it on completion or error. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  // ─────────────────────────────────────────────────────────────
  // W13 — hardened execution
  // ─────────────────────────────────────────────────────────────

  /**
   * Run one tool handler under the full W13 ladder:
   *
   *   1. refuse outright if the turn was truncated (B1 — a truncated response
   *      never executes a tool, checked BEFORE a permit is taken because
   *      refusing costs nothing and must not queue behind live work);
   *   2. refuse outright if `key` is quarantined by the poison-pill ladder;
   *   3. take one of the `permits` (X-1 — bound the fan-out);
   *   4. serialise the call if `key` is merely downgraded;
   *   5. bound it with the per-item timeout, clearing the timer either way;
   *   6. feed the outcome back into the ladder.
   *
   * `key` is the tool NAME, not the call id: the poison-pill ladder is about
   * "this tool is broken", and a per-call key would reset on every retry and
   * therefore never trigger.
   *
   * @param conversationId Enables the truncation latch. Omitted callers still
   *   get steps 2-6; the latch is simply not consulted, because a latch keyed
   *   globally would let a truncation in one conversation block another's tools.
   */
  async runGuarded<T>(
    key: string,
    fn: () => Promise<T>,
    opts: { conversationId?: string; timeoutMs?: number } = {},
  ): Promise<T> {
    if (opts.conversationId !== undefined) {
      this.latch.assertExecutable(opts.conversationId, key);
    }
    if (this.poison.isQuarantined(key)) {
      throw new FanOutAbortError('poisoned', this.poison.quarantineReason(key));
    }

    const timeoutMs = opts.timeoutMs ?? this.perItemTimeoutMs;

    return this.run(async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const run = this.poison.runFor(key, fn);
        let value: T;
        if (timeoutMs > 0) {
          const deadline = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new FanOutAbortError(
                'per-item-timeout',
                `Tool "${key}" exceeded its ${timeoutMs}ms budget and was abandoned. ` +
                `Nothing was returned; the tool may still be running in the background.`,
              )),
              timeoutMs,
            );
          });
          // The loser of the race is never awaited again. Swallow it so a
          // late rejection from a reaped handler is not an unhandled rejection.
          void run.catch(() => undefined);
          value = await Promise.race([run, deadline]);
        } else {
          value = await run;
        }
        this.poison.recordSuccess(key);
        return value;
      } catch (err) {
        // A truncation refusal is not the TOOL's fault — counting it would
        // quarantine a healthy tool after three truncated turns.
        if (!(err instanceof TruncatedTurnError)) this.poison.recordFailure(key);
        throw err;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    });
  }

  /**
   * W13 — order-preserving fan-out over this semaphore's permits.
   *
   * The entry point for any provider that batches tool calls itself. Results
   * come back in the order the items were given (i.e. the order the model
   * emitted the calls), never in completion order. See `hardening/fanout.ts`
   * for why both timeouts are required.
   *
   * Imported lazily so `toolSemaphore.ts` → `fanout.ts` → `toolSemaphore.ts`
   * is not a module-evaluation cycle.
   */
  async runAll<I, T>(
    items: readonly I[],
    worker: (item: I, ctx: { index: number; signal: AbortSignal }) => Promise<T>,
    opts: {
      keyOf?: (item: I, index: number) => string;
      perItemTimeoutMs?: number;
      overallTimeoutMs?: number;
      signal?: AbortSignal;
    } = {},
  ): Promise<Array<FanOutOutcome<T>>> {
    const { boundedFanOut } = await import('./hardening/fanout.js');
    return boundedFanOut(items, worker, {
      semaphore: this,
      poison: this.poison,
      perItemTimeoutMs: opts.perItemTimeoutMs ?? this.perItemTimeoutMs,
      ...(opts.keyOf ? { keyOf: opts.keyOf } : {}),
      ...(opts.overallTimeoutMs !== undefined ? { overallTimeoutMs: opts.overallTimeoutMs } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  }

  /**
   * W13 — a new turn begins on `conversationId`. Clears the truncation latch
   * and resets the poison-pill ladder, because "this tool failed three times"
   * is a statement about ONE turn's runaway, not a permanent verdict.
   */
  beginTurn(conversationId: string): void {
    this.latch.beginTurn(conversationId);
    this.poison.reset();
  }

  /** W13 / B1 — the response for this conversation stopped on `length`. */
  markTruncated(conversationId: string, stopReason: string): void {
    this.latch.markTruncated(conversationId, stopReason);
  }
}
