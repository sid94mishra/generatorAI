// ────────────────────────────────────────────────────────────────
// W30-b — the web surface must reach the SECOND phase.
//
// `useTwoPhaseStop.test.ts` drives the hook with `isLive` as a free variable,
// so it proves the machine works when the surface feeds it honestly. It cannot
// see the defect this file exists for, which lives in the FEEDBACK LOOP the
// page closes around the machine:
//
//     press → onCancel → store.requestCancel(sessionId)
//                      → status becomes 'complete'   (reducer.ts)
//                      → isCopilotWorking goes false (ChatPage)
//                      → controller.observe('settled')
//                      → phase resets to 'idle', pressedAt cleared
//
// The first press settles the turn LOCALLY, so `arming` / `stopping` / `force`
// were unreachable on web and the 15 s Force reset — the entire point of
// W30-b — was dead code. Mobile never latched (`apps/mobile/app/chats/[id].tsx`
// passes `onCancel: () => cancel.mutate()` and lets the event stream decide),
// which is why only web lost the escape hatch; that asymmetry is what these
// tests pin shut.
//
// Everything below drives shipped code: the real reducer, the real hook, and
// `applyStopEffects` exactly as `ChatPage` calls it.
// ────────────────────────────────────────────────────────────────

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STOP_ARMING_MS, STOP_FORCE_RESET_MS } from '@generatorai/client-core';

import { useTwoPhaseStop } from '@/hooks/useTwoPhaseStop.js';
import { applyStopEffects, type StopEffectStore } from '@/pages/chatStopEffects.js';
import { useStreamStore } from '@/stores/streamStore.js';

const SESSION = 'session-under-test';

/** `ChatPage`'s own liveness derivation, read off the real store. */
function isCopilotWorking(): boolean {
  const status = useStreamStore.getState().streams[SESSION]?.status;
  return status === 'streaming' || status === 'thinking' || status === 'pending';
}

/**
 * Renders the hook wired the way `ChatPage` wires it: liveness read from the
 * store, `onCancel` delegating to the shipped `applyStopEffects`.
 */
function renderPageStop(): ReturnType<typeof renderHook<ReturnType<typeof useTwoPhaseStop>, void>> {
  return renderHook(() =>
    useTwoPhaseStop({
      isLive: isCopilotWorking(),
      onCancel: ({ force }) => {
        applyStopEffects(useStreamStore.getState() as StopEffectStore, SESSION, force);
      },
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  useStreamStore.getState().clearStream(SESSION);
  // A turn the user sent that the agent has begun answering. Driven through
  // the real reducer actions rather than poked into the store, so the status
  // under test is one the event stream can actually produce.
  useStreamStore.getState().startPending(SESSION, 'do the thing');
  useStreamStore.getState().appendToken(SESSION, 'work');
});

afterEach(() => {
  vi.useRealTimers();
  useStreamStore.getState().clearStream(SESSION);
});

describe('W30-b — two-phase Stop on web, at ChatPage’s wiring', () => {
  it('does not settle the turn locally on the first press', () => {
    // Rule 4: the BACKEND decides whether a turn is still running. A local
    // write that flips the status to a terminal one is the client answering
    // its own question, and it is what makes phase two unreachable.
    const { result } = renderPageStop();
    expect(result.current.phase).toBe('ready');

    act(() => result.current.press());

    expect(
      isCopilotWorking(),
      'the graceful press settled the turn locally — the two-phase machine has ' +
      'nothing left to escalate against',
    ).toBe(true);
  });

  it('reaches `stopping` after the arming window, with the turn still live', () => {
    const { result, rerender } = renderPageStop();

    act(() => result.current.press());
    expect(result.current.phase).toBe('arming');

    act(() => {
      vi.advanceTimersByTime(STOP_ARMING_MS + 50);
    });
    rerender();

    expect(result.current.phase).toBe('stopping');
    expect(result.current.enabled).toBe(true);
  });

  it('offers Force reset 15 s after a press the provider ignored', () => {
    const { result, rerender } = renderPageStop();

    act(() => result.current.press());
    act(() => {
      vi.advanceTimersByTime(STOP_FORCE_RESET_MS + 250);
    });
    rerender();

    // The whole point of W30-b-3: past this the graceful path has
    // demonstrably failed and the control must say so.
    expect(result.current).toMatchObject({ phase: 'force', label: 'Force reset', forceAvailable: true });
  });

  it('the forced press is the one that clears the transcript and settles it', () => {
    const { result, rerender } = renderPageStop();

    act(() => result.current.press());
    act(() => {
      vi.advanceTimersByTime(STOP_FORCE_RESET_MS + 250);
    });
    rerender();
    act(() => result.current.press());

    // Force is the honest reset: whatever is on screen belongs to a turn the
    // server could not stop, so it stops claiming to still be coming.
    expect(useStreamStore.getState().streams[SESSION]?.cancelRequested).toBe(true);
    expect(isCopilotWorking()).toBe(false);
  });

  it('still stands the control down when the BACKEND settles the turn', () => {
    // The other half of rule 4, and the reason the first press must not do
    // this itself: a genuine settle from the event stream returns the control
    // to idle without any press at all.
    const { result, rerender } = renderPageStop();

    act(() => result.current.press());
    act(() => {
      vi.advanceTimersByTime(STOP_ARMING_MS + 50);
    });
    rerender();
    expect(result.current.phase).toBe('stopping');

    act(() => {
      useStreamStore.getState().completeStream(SESSION);
    });
    rerender();

    expect(result.current).toMatchObject({ phase: 'idle', enabled: false });
  });
});
