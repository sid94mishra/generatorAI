// ────────────────────────────────────────────────────────────────
// useTwoPhaseStop — the React binding for W30-b's stop machine.
//
// The machine itself is pure and lives in client-core (`StopController`), so
// the timings are shared with every other surface and tested without a clock.
// This hook is only the wiring: it feeds the controller the BACKEND's view of
// the turn, ticks it while a stop is in flight, and hands the caller a label
// and a press handler.
//
// What it deliberately does not do is track "have I pressed already" itself.
// The whole point of W30-b's fourth rule is that the second press is decided
// by whether the server still says the turn is running, not by the client's
// own echo — a Stop button that goes quiet because it remembers being pressed
// is exactly the one that leaves a spinner outliving its producer.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StopController, type StopView } from '@generatorai/client-core';

export interface UseTwoPhaseStopOptions {
  /**
   * Whether the BACKEND still considers the turn live.
   *
   * Derived from the stream's status, which comes from the event stream — not
   * from an optimistic local flag.
   */
  isLive: boolean;
  /** Sends the cancel. Called for both the graceful and the forced press. */
  onCancel: (options: { budgetSeconds: number; force: boolean }) => void;
  /** Soft budget in seconds; clamped to [0.5, 60] by the controller. */
  budgetSeconds?: number;
}

export interface TwoPhaseStop extends StopView {
  /** Wire this to the control's click handler. */
  press: () => void;
}

/**
 * How often the view is recomputed while a stop is in flight.
 *
 * Only two thresholds move (400 ms and 15 s) and neither is animated, so this
 * is deliberately coarse — a spinner that re-renders the composer 60 times a
 * second to change a label twice is a worse trade than a 200 ms lag on the
 * "Force reset" relabel.
 */
const TICK_MS = 200;

export function useTwoPhaseStop({
  isLive,
  onCancel,
  budgetSeconds,
}: UseTwoPhaseStopOptions): TwoPhaseStop {
  const controller = useMemo(
    () => new StopController(budgetSeconds !== undefined ? { budgetSeconds } : {}),
    [budgetSeconds],
  );
  const [view, setView] = useState<StopView>(() => controller.view());

  // Refs so the tick effect does not restart on every render.
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  useEffect(() => {
    controller.observe(isLive ? 'live' : 'settled');
    setView(controller.view());
  }, [controller, isLive]);

  useEffect(() => {
    // Only while a turn is live: an idle composer must not hold a timer.
    if (!isLive) return;
    const timer = setInterval(() => {
      setView((previous) => {
        const next = controller.view();
        // Identity-stable when nothing changed, so an idle turn does not
        // re-render the composer five times a second for no reason.
        return next.phase === previous.phase &&
          next.label === previous.label &&
          next.enabled === previous.enabled
          ? previous
          : next;
      });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [controller, isLive]);

  const press = useCallback(() => {
    const action = controller.press();
    setView(controller.view());
    if (action.kind === 'noop') return;
    cancelRef.current({
      budgetSeconds: action.budgetSeconds,
      force: action.kind === 'force',
    });
  }, [controller]);

  return { ...view, press };
}
