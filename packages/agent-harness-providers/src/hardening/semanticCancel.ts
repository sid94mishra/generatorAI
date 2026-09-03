// ────────────────────────────────────────────────────────────────
// cancelSemantically — W13 / X-4, the whole Stop sequence in one place.
//
// The plan states it as an ORDER, and every clause exists because reordering
// it produced a bug somewhere:
//
//   1. settle pending approvals and user-input requests   (t3code)
//   2. interrupt locally
//   3. fire the protocol cancel IN THE BACKGROUND
//   4. return `{stopReason: 'cancelled'}` as a SUCCESS   (X-4)
//   5. grace budget → synthesised terminal event          (KiroCrew)
//
// ── 1 before 2 ────────────────────────────────────────────────────
// See `approvalGate.ts`. Interrupting first tears down the stream that would
// have delivered the approval answer, so the parked handler can never settle.
//
// ── 3 in the background ───────────────────────────────────────────
// The protocol cancel is a request to a runtime that may be exactly as wedged
// as the thing we are cancelling. Awaiting it makes Stop as slow as the
// failure Stop exists to escape. It is fired and monitored, never awaited.
//
// ── 4 as a success ────────────────────────────────────────────────
// A user pressing Stop is not an error. Rejecting turns every deliberate stop
// into a red toast and, downstream, records the run as `failed` — which is why
// X-4 pins cancellation as a success-valued outcome.
//
// ── 5, and why there is deliberately NO kill hook ─────────────────
// KiroCrew `session_handle.py:1477-1516`: when a cancel is not acknowledged,
// the tempting fix is to kill the runtime process. On a SHARED runtime — which
// is the whole point of `RuntimeConnection.forTcp()`/`forUri()` and of the
// workspace-scoped Copilot pool — that process is also serving other people's
// sessions. Killing it turns "one user pressed Stop" into "every co-tenant
// session died".
//
// So the escape hatch is a SYNTHESISED terminal event instead: after the grace
// budget, this module tells the caller to emit the terminal event the runtime
// failed to send, so the local state machine reaches a terminal state while
// the runtime is left alone. `CancelDeps` has no `kill` field, and that
// absence is the mechanism — an implementer cannot reach for the wrong tool
// because it is not on the interface.
// ────────────────────────────────────────────────────────────────

/** Default window to wait for the runtime's own terminal event. */
export const DEFAULT_CANCEL_GRACE_MS = 2_000;

export type TerminalOrigin = 'runtime' | 'synthesised';

export interface CancelOutcome {
  /** Always `'cancelled'`. X-4: cancellation is a success-valued outcome. */
  readonly stopReason: 'cancelled';
  /** How many approvals/user-input requests step 1 had to settle. */
  readonly settledApprovals: number;
  /** Whether the runtime acknowledged, or we had to synthesise. */
  readonly terminal: TerminalOrigin;
  /** Milliseconds spent waiting for the acknowledgement. */
  readonly graceElapsedMs: number;
  /** A protocol-cancel failure, surfaced but never thrown. */
  readonly protocolCancelError?: Error;
}

export interface CancelDeps {
  /**
   * Step 1. Settle every pending approval and user-input request. Returns how
   * many were settled. Usually `gate.settleAll()`.
   */
  settlePending: () => number;
  /**
   * Step 2. The LOCAL interrupt — abort the turn's controller, close the
   * stream handle. Must not await anything remote.
   */
  interrupt: () => void;
  /**
   * Step 3. The protocol-level cancel (`session/cancel`, `turn/interrupt`,
   * `query.interrupt()`). Fired, never awaited.
   */
  protocolCancel?: () => Promise<void>;
  /**
   * Step 5. Emit the terminal event the runtime did not send. Called ONLY when
   * the grace budget expires without `acknowledgeTerminal()`.
   */
  synthesiseTerminal: () => void;
}

export interface CancelOptions {
  graceMs?: number;
  /**
   * Injectable clock so the grace budget is testable without fake timers
   * leaking into the module. Defaults to `Date.now`.
   */
  now?: () => number;
}

/**
 * A cancellation in progress. `cancelSemantically` returns one of these only
 * after the grace budget has resolved one way or the other; the caller wires
 * `acknowledgeTerminal()` to whatever event the runtime sends on a real cancel.
 */
export class CancellationInFlight {
  private acked = false;
  private onAck: (() => void) | undefined;

  /** Call when the runtime's own terminal event arrives. Idempotent. */
  acknowledgeTerminal(): void {
    if (this.acked) return;
    this.acked = true;
    this.onAck?.();
  }

  get acknowledged(): boolean {
    return this.acked;
  }

  /** @internal */
  _await(graceMs: number): Promise<boolean> {
    if (this.acked) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      // Cleared on BOTH paths — an uncleared grace timer per cancelled turn is
      // a handle leak in a long-lived provider, and keeps the process alive.
      const timer = setTimeout(() => {
        this.onAck = undefined;
        resolve(false);
      }, graceMs);
      this.onAck = () => {
        clearTimeout(timer);
        this.onAck = undefined;
        resolve(true);
      };
    });
  }
}

/**
 * Run the full W13 cancellation sequence.
 *
 * Never throws: a failure inside any step is captured and reported on the
 * outcome, because a Stop that throws is a Stop that did not happen.
 */
export async function cancelSemantically(
  deps: CancelDeps,
  inFlight: CancellationInFlight = new CancellationInFlight(),
  options: CancelOptions = {},
): Promise<CancelOutcome> {
  const graceMs = options.graceMs ?? DEFAULT_CANCEL_GRACE_MS;
  const now = options.now ?? Date.now;

  // 1 — settle first. Everything else can fail; this must not be skipped.
  let settledApprovals = 0;
  try {
    settledApprovals = deps.settlePending();
  } catch {
    settledApprovals = 0;
  }

  // 2 — local interrupt.
  try {
    deps.interrupt();
  } catch {
    // A local interrupt that throws must not stop us reaching the terminal
    // event: the caller is still owed a terminal state.
  }

  // 3 — protocol cancel, in the background.
  let protocolCancelError: Error | undefined;
  if (deps.protocolCancel) {
    void deps.protocolCancel().catch((err: unknown) => {
      protocolCancelError = err instanceof Error ? err : new Error(String(err));
    });
  }

  // 5 — grace budget, then synthesise rather than kill.
  const started = now();
  const acked = await inFlight._await(graceMs);
  const graceElapsedMs = now() - started;
  if (!acked) {
    try {
      deps.synthesiseTerminal();
    } catch {
      // Nothing left to escalate to. The outcome below still reports
      // 'synthesised' so the caller can see the runtime went unacknowledged.
    }
  }

  // 4 — success-valued.
  return {
    stopReason: 'cancelled',
    settledApprovals,
    terminal: acked ? 'runtime' : 'synthesised',
    graceElapsedMs,
    ...(protocolCancelError ? { protocolCancelError } : {}),
  };
}
