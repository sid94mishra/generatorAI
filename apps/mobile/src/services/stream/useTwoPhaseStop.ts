// ────────────────────────────────────────────────────────────────
// useTwoPhaseStop — the React Native binding for W30-b's stop machine.
//
// The RULES — the 10 s budget and its [0.5, 60] clamp, the 400 ms arming
// window, the 15 s escape hatch, and the rule that the backend rather than the
// click count decides whether a turn is still running — all live in
// `composerReducer` in client-core and are tested there once, for every
// surface.
//
// Only the binding is per-surface, and it has to be: client-core may not
// import a UI framework (that constraint is what makes it shareable between a
// DOM app and a React Native one), so the hook cannot live there. `apps/web`
// has the same twenty lines against the same controller. If a third surface
// needs it, the thing to copy is this file — never the thresholds.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import { composerReducer, createComposerState, selectStopPhase, stopViewForPhase, type StopView } from '@generatorai/client-core';
import { useLatestRef } from '../lib/useLatestRef';

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
  const machine = useRef(createComposerState(budgetSeconds !== undefined ? { budgetSeconds } : {}));
  const [view, setView] = useState<StopView>(() => stopViewForPhase('idle'));
  const publish = useCallback(() => {
    const next = stopViewForPhase(selectStopPhase(machine.current));
    setView(previous => next.phase === previous.phase ? previous : next);
  }, [machine]);

  const cancelRef = useLatestRef(onCancel);

  useEffect(() => {
    machine.current = createComposerState(budgetSeconds !== undefined ? { budgetSeconds } : {});
    machine.current = composerReducer(machine.current, { type: 'turn/observed', liveness: isLive ? 'live' : 'settled', at: Date.now() });
    publish();
  }, [budgetSeconds, isLive, publish]);

  useEffect(() => {
    // No turn, no timer: a phone must not wake five times a second to
    // recompute a label for a control that is not on screen.
    if (!isLive) return;
    const timer = setInterval(() => {
      machine.current = composerReducer(machine.current, { type: 'clock/ticked', at: Date.now() });
      publish();
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [machine, isLive, publish]);

  const press = useCallback(() => {
    machine.current = composerReducer(machine.current, { type: 'turn/observed', liveness: isLive ? 'live' : 'settled', at: Date.now() });
    machine.current = composerReducer(machine.current, { type: 'stop/pressed', at: Date.now() });
    const action = machine.current.lastStopAction;
    publish();
    if (!action || action.kind === 'noop') return;
    cancelRef.current({ budgetSeconds: action.budgetSeconds, force: action.kind === 'force' });
  }, [machine, isLive, publish, cancelRef]);

  return { ...view, press };
}
