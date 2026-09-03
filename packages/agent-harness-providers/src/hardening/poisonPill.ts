// ────────────────────────────────────────────────────────────────
// PoisonPillRegistry — W13, poison-pill downgrade.
//
// ── WHY this exists (the failure it prevents) ──────────────────────
//
// A fan-out is bounded by two budgets at once: `concurrency` permits and an
// `overallTimeoutMs` wall clock (see `fanout.ts`). An item that fails by
// WEDGING — a tool whose child never answers, an MCP server that stopped
// reading its pipe — burns one permit for the FULL per-item timeout before it
// is reaped. With 8 permits and a model that emits the same broken tool nine
// times (models retry; that is the normal shape of a runaway), every permit is
// held by a wedged copy, and the HEALTHY calls in the same batch never get to
// run before the overall deadline fires. One bad item fails the whole batch:
// the poison pill.
//
// Retrying it harder makes it worse, so the response is to give the failing
// item strictly LESS of the shared budget, in two steps:
//
//   healthy    → runs in parallel like everything else.
//   downgraded → after DOWNGRADE_AFTER consecutive failures, the key is
//                confined to a per-key mutex: at most ONE call for that tool
//                may be in flight at a time, no matter how many the model
//                emitted. Seven permits stay available to healthy work.
//   quarantined→ after QUARANTINE_AFTER consecutive failures, the key stops
//                executing at all for the rest of the batch and fails FAST
//                with a legible reason, so the model is told the tool is
//                broken instead of waiting out a timeout per call.
//
// ── Why "consecutive", and why a success fully resets ──────────────
//
// The trigger is CONSECUTIVE failures, not a failure RATE. A rate needs a
// window, and a window needs a clock, which makes the trigger untestable
// without fake timers and — worse — makes it fire on a tool that is merely
// unreliable rather than broken. A tool that answers even once has proved it
// can still answer, so the counter resets to zero: the mechanism targets
// "this is currently wedged", not "this has ever misbehaved".
//
// State is per-registry, and a registry is per-provider-instance, so a
// quarantine never leaks across sessions of different users.
// ────────────────────────────────────────────────────────────────

/** Health of one fan-out key. */
export type PoisonStatus = 'healthy' | 'downgraded' | 'quarantined';

export interface PoisonPillOptions {
  /** Consecutive failures before the key is confined to serial execution. */
  downgradeAfter?: number;
  /** Consecutive failures before the key is excluded from the batch entirely. */
  quarantineAfter?: number;
  /** Observability hook — fired once per transition, never per failure. */
  onTransition?: (key: string, from: PoisonStatus, to: PoisonStatus) => void;
}

const DOWNGRADE_AFTER = 3;
const QUARANTINE_AFTER = 5;

interface KeyState {
  consecutiveFailures: number;
  status: PoisonStatus;
  /** Tail of the serial chain while `status === 'downgraded'`. */
  serialTail: Promise<unknown>;
}

export class PoisonPillRegistry {
  private readonly keys = new Map<string, KeyState>();
  private readonly downgradeAfter: number;
  private readonly quarantineAfter: number;
  private readonly onTransition: PoisonPillOptions['onTransition'];

  constructor(options: PoisonPillOptions = {}) {
    this.downgradeAfter = options.downgradeAfter ?? DOWNGRADE_AFTER;
    this.quarantineAfter = options.quarantineAfter ?? QUARANTINE_AFTER;
    this.onTransition = options.onTransition;
    if (this.quarantineAfter < this.downgradeAfter) {
      throw new Error(
        'PoisonPillRegistry: quarantineAfter must be >= downgradeAfter — ' +
        'quarantine is the escalation of a downgrade, not an alternative to it',
      );
    }
  }

  private stateOf(key: string): KeyState {
    let s = this.keys.get(key);
    if (!s) {
      s = { consecutiveFailures: 0, status: 'healthy', serialTail: Promise.resolve() };
      this.keys.set(key, s);
    }
    return s;
  }

  statusOf(key: string): PoisonStatus {
    return this.keys.get(key)?.status ?? 'healthy';
  }

  isQuarantined(key: string): boolean {
    return this.statusOf(key) === 'quarantined';
  }

  isDowngraded(key: string): boolean {
    return this.statusOf(key) === 'downgraded';
  }

  consecutiveFailures(key: string): number {
    return this.keys.get(key)?.consecutiveFailures ?? 0;
  }

  /**
   * A key answered. It has proved it can still answer, so the escalation
   * ladder resets completely — including out of quarantine, which matters when
   * a registry outlives one turn.
   */
  recordSuccess(key: string): void {
    const s = this.keys.get(key);
    if (!s) return;
    s.consecutiveFailures = 0;
    this.transition(key, s, 'healthy');
  }

  /** A key failed, timed out, or was aborted while it held a permit. */
  recordFailure(key: string): PoisonStatus {
    const s = this.stateOf(key);
    s.consecutiveFailures += 1;
    if (s.consecutiveFailures >= this.quarantineAfter) {
      this.transition(key, s, 'quarantined');
    } else if (s.consecutiveFailures >= this.downgradeAfter) {
      this.transition(key, s, 'downgraded');
    }
    return s.status;
  }

  private transition(key: string, s: KeyState, to: PoisonStatus): void {
    if (s.status === to) return;
    const from = s.status;
    s.status = to;
    this.onTransition?.(key, from, to);
  }

  /**
   * Human/model-legible reason attached to a quarantined item's failure, so
   * the model learns the tool is broken instead of inferring it from silence.
   */
  quarantineReason(key: string): string {
    return (
      `Tool "${key}" failed ${this.consecutiveFailures(key)} times in a row and has been ` +
      `disabled for the rest of this batch to stop it starving the other tool calls. ` +
      `Do not call it again in this turn; use a different approach or ask the user.`
    );
  }

  /**
   * Run `fn` under the escalation ladder for `key`.
   *
   * A downgraded key is chained onto its own serial tail so only one call for
   * that key is ever in flight — the caller's concurrency permit is still held,
   * which is deliberate: the permit is what stops the OTHER seven copies of the
   * same broken tool from starting at all.
   */
  async runFor<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const s = this.stateOf(key);
    if (s.status !== 'downgraded') return fn();
    const run = s.serialTail.then(fn, fn);
    // Swallow on the TAIL only: the caller still sees the real rejection via
    // `run`. Without this an earlier failure would surface as an unhandled
    // rejection when the next call chains onto it.
    s.serialTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Forget everything. Called when a turn ends so state never leaks forward. */
  reset(): void {
    this.keys.clear();
  }
}
