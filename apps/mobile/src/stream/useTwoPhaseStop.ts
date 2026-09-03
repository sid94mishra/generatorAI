// ────────────────────────────────────────────────────────────────
// useTwoPhaseStop — the React Native binding for W30-b's stop machine.
//
// The RULES — the 10 s budget and its [0.5, 60] clamp, the 400 ms arming
// window, the 15 s escape hatch, and the rule that the backend rather than the
// click count decides whether a turn is still running — all live in
// `StopController` in client-core and are tested there once, for every
// surface.
//
// Only the binding is per-surface, and it has to be: client-core may not
// import a UI framework (that constraint is what makes it shareable between a
// DOM app and a React Native one), so the hook cannot live there. `apps/web`
// has the same twenty lines against the same controller. If a third surface
// needs it, the thing to copy is this file — never the thresholds.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StopController, type StopView } from '@generatorai/client-core';

export interface UseTwoPhaseStopOptions {
  /** Whether the BACKEND still considers the turn live. */
  isLive: boolean;
  /** Sends the cancel. Called for both the graceful and the forced press. */
  onCancel: (options: { budgetSeconds: number; force: boolean }) => void;
  budgetSeconds?: number;
}

export interface TwoPhaseStop extends StopView {
  press: () => void;
}

/** Coarse on purpose — two thresholds move, and neither is animated. */
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

  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  useEffect(() => {
    controller.observe(isLive ? 'live' : 'settled');
    setView(controller.view());
  }, [controller, isLive]);

  useEffect(() => {
    // No turn, no timer: a phone must not wake five times a second to
    // recompute a label for a control that is not on screen.
    if (!isLive) return;
    const timer = setInterval(() => {
      setView((previous) => {
        const next = controller.view();
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
    cancelRef.current({ budgetSeconds: action.budgetSeconds, force: action.kind === 'force' });
  }, [controller]);

  return { ...view, press };
}
