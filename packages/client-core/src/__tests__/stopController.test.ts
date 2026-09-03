// ────────────────────────────────────────────────────────────────
// W30-b — two-phase Stop.
//
// Before this the whole feature was `cancelMutation.mutate(chatId)`: one POST,
// no arming window, no escalation, and no way out if the provider ignored the
// abort. Every assertion below fails against that, because none of the states
// it describes existed.
//
// The clock is injected, so the 400 ms and 15 s thresholds are asserted at
// their real values rather than approximated with a shortened test constant —
// a threshold a test had to change to observe is a threshold the test is not
// really checking.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';

import {
  resolveStopGraceMs,
  StopController,
  STOP_ARMING_MS,
  STOP_BUDGET_DEFAULT_SECONDS,
  STOP_FORCE_RESET_MS,
} from '../stream/stopController.js';

/** A controller on a clock the test drives. */
function makeController(budgetSeconds?: number) {
  let now = 1_000_000;
  const controller = new StopController({
    ...(budgetSeconds !== undefined ? { budgetSeconds } : {}),
    now: () => now,
  });
  return { controller, advance: (ms: number) => { now += ms; } };
}

describe('W30-b — the soft budget clamp', () => {
  it('defaults to 10 s', () => {
    expect(STOP_BUDGET_DEFAULT_SECONDS).toBe(10);
    expect(resolveStopGraceMs()).toBe(10_000);
  });

  it('clamps to [0.5, 60] seconds', () => {
    // Under half a second cannot be honoured by anything; over a minute is
    // indistinguishable from a hang.
    expect(resolveStopGraceMs(0.1)).toBe(500);
    expect(resolveStopGraceMs(-5)).toBe(500);
    expect(resolveStopGraceMs(600)).toBe(60_000);
  });

  it('takes max(floor, callerBudget), never the caller alone', () => {
    // A budget shorter than the arming window would offer escalation before
    // the first press is even armed.
    expect(resolveStopGraceMs(0.5, STOP_ARMING_MS)).toBe(500);
    expect(resolveStopGraceMs(0.5, 900)).toBe(900);
    expect(resolveStopGraceMs(30, 900)).toBe(30_000);
  });

  it('falls back to the default for a non-finite budget', () => {
    expect(resolveStopGraceMs(Number.NaN)).toBe(10_000);
  });
});

describe('W30-b — the 400 ms arming window', () => {
  it('does nothing at all when no turn is running', () => {
    const { controller } = makeController();
    expect(controller.press()).toEqual({ kind: 'noop', reason: 'no-turn' });
    expect(controller.view().enabled).toBe(false);
  });

  it('sends the graceful cancel on the first press', () => {
    const { controller } = makeController();
    controller.observe('live');
    expect(controller.view()).toMatchObject({ label: 'Stop', enabled: true });
    expect(controller.press()).toEqual({ kind: 'cancel', budgetSeconds: 10 });
  });

  it('swallows a double-tap inside the window', () => {
    const { controller, advance } = makeController();
    controller.observe('live');
    controller.press();
    advance(STOP_ARMING_MS - 1);
    // The destructive path must be unreachable by impatience. Stop is exactly
    // the button people press twice when nothing appears to happen.
    expect(controller.press()).toEqual({ kind: 'noop', reason: 'arming' });
    expect(controller.view()).toMatchObject({ enabled: false, label: 'Stopping…' });
  });

  it('accepts a second press once armed', () => {
    const { controller, advance } = makeController();
    controller.observe('live');
    controller.press();
    advance(STOP_ARMING_MS);
    expect(controller.press()).toEqual({ kind: 'cancel', budgetSeconds: 10 });
    expect(controller.view()).toMatchObject({ enabled: true, forceAvailable: false });
  });
});

describe('W30-b — the 15 s escape hatch', () => {
  it('relabels to "Force reset" once the graceful path has failed', () => {
    const { controller, advance } = makeController();
    controller.observe('live');
    controller.press();
    advance(STOP_FORCE_RESET_MS - 1);
    expect(controller.view().forceAvailable).toBe(false);

    advance(1);
    // Past this the graceful path demonstrably failed, and continuing to
    // render a plain Stop implies it might still work.
    expect(controller.view()).toMatchObject({ label: 'Force reset', forceAvailable: true });
    expect(controller.press()).toEqual({ kind: 'force', budgetSeconds: 10 });
  });

  it('never offers the escape hatch for a turn the backend already settled', () => {
    const { controller, advance } = makeController();
    controller.observe('live');
    controller.press();
    controller.observe('settled');
    advance(STOP_FORCE_RESET_MS * 2);
    expect(controller.view()).toMatchObject({ phase: 'idle', enabled: false });
  });
});

describe('W30-b — the backend is authoritative, not the click count', () => {
  it('returns to idle when the backend settles the turn', () => {
    const { controller } = makeController();
    controller.observe('live');
    controller.press();
    // The request may never have been answered. What settles the control is
    // the event stream saying the turn is over.
    controller.observe('settled');
    expect(controller.view()).toMatchObject({ phase: 'idle', enabled: false });
    expect(controller.press()).toEqual({ kind: 'noop', reason: 'no-turn' });
  });

  it('keeps offering escalation while the backend still says the turn is live', () => {
    const { controller, advance } = makeController();
    controller.observe('live');
    controller.press();
    // A client that trusted its own echo would go quiet here and leave a
    // spinner outliving its producer.
    advance(STOP_ARMING_MS);
    controller.observe('live');
    expect(controller.view().enabled).toBe(true);
    expect(controller.press().kind).toBe('cancel');
  });

  it('starts a fresh attempt for the NEXT turn rather than inheriting the last', () => {
    const { controller, advance } = makeController();
    controller.observe('live');
    controller.press();
    advance(STOP_FORCE_RESET_MS + 1);
    expect(controller.view().forceAvailable).toBe(true);

    controller.observe('settled');
    controller.observe('live');
    // A new turn must not open on "Force reset" because the previous one
    // ended badly.
    expect(controller.view()).toMatchObject({ label: 'Stop', enabled: true, forceAvailable: false });
  });

  it('honours a clamped custom budget end to end', () => {
    const { controller } = makeController(600);
    controller.observe('live');
    expect(controller.graceMs).toBe(60_000);
    expect(controller.press()).toEqual({ kind: 'cancel', budgetSeconds: 600 });
  });
});
