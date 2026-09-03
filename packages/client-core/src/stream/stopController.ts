// ────────────────────────────────────────────────────────────────
// Two-phase Stop — W30-b.
//
// "Stop always stops; no spinner outlives its producer." What shipped before
// this was a single `cancelMutation.mutate(chatId)`: one POST, no arming, no
// escalation, and no way out if the provider ignored the abort. If the turn
// kept streaming the user's only recourse was to reload the page.
//
// Four rules, and each one exists because of a specific failure:
//
//  1. **A soft budget.** Aborting is a round trip and a well-behaved provider
//     needs a moment to unwind. 10 s by default, clamped to [0.5 s, 60 s] —
//     a budget under half a second cannot be honoured by anything and a
//     budget over a minute is indistinguishable from a hang.
//
//  2. **A 400 ms arming window.** The second press is the destructive one, and
//     Stop is the button people double-tap when nothing appears to happen. For
//     400 ms after the first press the control does not accept another press
//     at all, so a double-tap cannot skip straight to a hard kill.
//
//  3. **A 15 s escape hatch.** Past that the graceful path has demonstrably
//     failed, and the honest thing is to say so: the button relabels to
//     "Force reset" rather than continuing to look like it might work.
//
//  4. **The BACKEND decides whether a turn is still running.** Not the click
//     count, and not the client's own optimistic echo. `observe()` is fed the
//     stream's status, which comes from the event stream — so a turn the
//     server has settled returns the control to idle even if the client's
//     request never got a response, and a turn the server is still running
//     keeps offering escalation even if the client thinks it already stopped.
//     Counting presses locally is exactly how a Stop button ends up claiming
//     success while tokens keep arriving.
//
// Pure and clock-injected: no timers of its own, no React, no fetch. The host
// calls `press()`, feeds it `observe()` and `tick()`, and renders `view()`.
// That is what makes every threshold above testable rather than a comment.
// ────────────────────────────────────────────────────────────────

/** The soft budget's clamp, in seconds. See rule 1. */
export const STOP_BUDGET_MIN_SECONDS = 0.5;
export const STOP_BUDGET_MAX_SECONDS = 60;
/** The default budget when a caller supplies none. */
export const STOP_BUDGET_DEFAULT_SECONDS = 10;
/** Rule 2 — a press inside this window after the first is ignored. */
export const STOP_ARMING_MS = 400;
/** Rule 3 — past this the button says what is actually true. */
export const STOP_FORCE_RESET_MS = 15_000;

/**
 * The grace this client waits before offering escalation.
 *
 * `max(floor, callerBudget)` rather than the caller's number outright: a
 * caller that asks for a shorter budget than the arming window would make the
 * escalation offer appear before the first press is even armed, which reads as
 * the UI arguing with itself.
 */
export function resolveStopGraceMs(
  budgetSeconds: number = STOP_BUDGET_DEFAULT_SECONDS,
  floorMs: number = STOP_ARMING_MS,
): number {
  const clamped = Number.isFinite(budgetSeconds)
    ? Math.min(STOP_BUDGET_MAX_SECONDS, Math.max(STOP_BUDGET_MIN_SECONDS, budgetSeconds))
    : STOP_BUDGET_DEFAULT_SECONDS;
  return Math.max(floorMs, Math.round(clamped * 1000));
}

/** Whether the backend still considers the turn live. */
export type TurnLiveness = 'live' | 'settled';

export type StopPhase =
  /** No turn to stop, or the turn already settled. */
  | 'idle'
  /** A turn is running and Stop is available. */
  | 'ready'
  /** First press sent; too soon to accept another. */
  | 'arming'
  /** Armed, still within the soft budget. A second press escalates. */
  | 'stopping'
  /** Past the escape hatch. The graceful path has failed. */
  | 'force';

export interface StopView {
  phase: StopPhase;
  /** Render this on the control. */
  label: string;
  /** Whether a press would do anything at all. */
  enabled: boolean;
  /** True once the control is offering the escape hatch. */
  forceAvailable: boolean;
}

/** What a press should make the host do. */
export type StopAction =
  /** Nothing — no turn, or inside the arming window. */
  | { kind: 'noop'; reason: 'no-turn' | 'arming' }
  /** Send the graceful cancel. */
  | { kind: 'cancel'; budgetSeconds: number }
  /** Send the cancel again, and tell the user it is a forced reset. */
  | { kind: 'force'; budgetSeconds: number };

export interface StopControllerOptions {
  /** Soft budget in seconds. Clamped; see `resolveStopGraceMs`. */
  budgetSeconds?: number;
  /** Injected clock, so the thresholds are testable without real time. */
  now?: () => number;
}

/**
 * The state machine. One per turn-bearing surface (a chat page, a run page).
 *
 * Deliberately not a hook and not a store: every surface needs the same
 * timings, and a second copy of "how long before we offer Force reset" is a
 * second place for it to be 5 s in one place and 20 s in another.
 */
export class StopController {
  private phase: StopPhase = 'idle';
  private liveness: TurnLiveness = 'settled';
  /** Clock reading of the first press of the current stop attempt. */
  private pressedAt: number | null = null;
  private readonly budgetSeconds: number;
  private readonly now: () => number;

  constructor(options: StopControllerOptions = {}) {
    this.budgetSeconds = options.budgetSeconds ?? STOP_BUDGET_DEFAULT_SECONDS;
    this.now = options.now ?? (() => Date.now());
  }

  /** Grace before escalation is offered, in ms. */
  get graceMs(): number {
    return resolveStopGraceMs(this.budgetSeconds);
  }

  /**
   * Feed the backend's view of the turn.
   *
   * Rule 4. A settled turn resets the machine no matter what the client
   * thought it was doing; a turn that goes live again (the next prompt) starts
   * a fresh attempt rather than inheriting the last one's escalation state.
   */
  observe(liveness: TurnLiveness): void {
    if (liveness === this.liveness) {
      if (liveness === 'live' && this.phase === 'idle') this.phase = 'ready';
      return;
    }
    this.liveness = liveness;
    if (liveness === 'settled') {
      this.phase = 'idle';
      this.pressedAt = null;
    } else {
      this.phase = 'ready';
      this.pressedAt = null;
    }
  }

  /**
   * Advance time-derived state.
   *
   * Called on a timer by the host. Separate from `observe` because the phase
   * has to move from `arming` to `stopping` to `force` while nothing at all is
   * arriving from the server — which is precisely the case this exists for.
   */
  tick(): void {
    if (this.pressedAt === null || this.liveness !== 'live') return;
    const elapsed = this.now() - this.pressedAt;
    if (elapsed >= STOP_FORCE_RESET_MS) this.phase = 'force';
    else if (elapsed >= STOP_ARMING_MS) this.phase = 'stopping';
    else this.phase = 'arming';
  }

  /** Handle a press. Returns what the host should do about it. */
  press(): StopAction {
    if (this.liveness !== 'live') return { kind: 'noop', reason: 'no-turn' };

    if (this.pressedAt === null) {
      this.pressedAt = this.now();
      this.phase = 'arming';
      return { kind: 'cancel', budgetSeconds: this.budgetSeconds };
    }

    const elapsed = this.now() - this.pressedAt;
    if (elapsed < STOP_ARMING_MS) {
      // Rule 2 — a double-tap must not reach the destructive path.
      return { kind: 'noop', reason: 'arming' };
    }
    if (elapsed >= STOP_FORCE_RESET_MS) {
      this.phase = 'force';
      return { kind: 'force', budgetSeconds: this.budgetSeconds };
    }
    this.phase = 'stopping';
    return { kind: 'cancel', budgetSeconds: this.budgetSeconds };
  }

  /** What the control should render right now. */
  view(): StopView {
    this.tick();
    switch (this.phase) {
      case 'idle':
        return { phase: 'idle', label: 'Stop', enabled: false, forceAvailable: false };
      case 'ready':
        return { phase: 'ready', label: 'Stop', enabled: true, forceAvailable: false };
      case 'arming':
        // Visibly disabled for 400 ms. A control that looks pressable and
        // silently ignores the press teaches people to press harder.
        return { phase: 'arming', label: 'Stopping…', enabled: false, forceAvailable: false };
      case 'stopping':
        return { phase: 'stopping', label: 'Stopping…', enabled: true, forceAvailable: false };
      case 'force':
        return { phase: 'force', label: 'Force reset', enabled: true, forceAvailable: true };
      default:
        return { phase: 'idle', label: 'Stop', enabled: false, forceAvailable: false };
    }
  }
}
