// ────────────────────────────────────────────────────────────────
// W30-b — the React binding for the two-phase Stop.
//
// The machine's own thresholds are asserted in
// `packages/client-core/src/__tests__/stopController.test.ts`. This covers the
// wiring the surface owns: that a press actually sends a cancel, that the
// arming window suppresses the send rather than merely dimming the button, and
// that the BACKEND settling the turn — not the press — is what stands the
// control down.
//
// Against the pre-W30-b composer every one of these fails: `onStop` was
// `cancelMutation.mutate(chatId)` with no state around it, so there was no
// arming window to suppress anything and no escalation to observe.
// ────────────────────────────────────────────────────────────────

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STOP_ARMING_MS, STOP_FORCE_RESET_MS } from '@generatorai/client-core';

import { useTwoPhaseStop } from '@/hooks/useTwoPhaseStop.js';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useTwoPhaseStop', () => {
  it('sends one cancel for the first press', () => {
    const onCancel = vi.fn();
    const { result } = renderHook(() => useTwoPhaseStop({ isLive: true, onCancel }));

    expect(result.current).toMatchObject({ label: 'Stop', enabled: true });
    act(() => result.current.press());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledWith({ budgetSeconds: 10, force: false });
  });

  it('suppresses the send for a double-tap, not just the styling', () => {
    const onCancel = vi.fn();
    const { result } = renderHook(() => useTwoPhaseStop({ isLive: true, onCancel }));

    act(() => result.current.press());
    act(() => {
      vi.advanceTimersByTime(STOP_ARMING_MS - 50);
      result.current.press();
    });
    // A disabled button that still fires its handler is not an arming window.
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(result.current.enabled).toBe(false);
  });

  it('escalates to a forced reset once the budget has demonstrably failed', () => {
    const onCancel = vi.fn();
    const { result } = renderHook(() => useTwoPhaseStop({ isLive: true, onCancel }));

    act(() => result.current.press());
    act(() => {
      vi.advanceTimersByTime(STOP_FORCE_RESET_MS + 250);
    });
    expect(result.current).toMatchObject({ label: 'Force reset', forceAvailable: true });

    act(() => result.current.press());
    expect(onCancel).toHaveBeenLastCalledWith({ budgetSeconds: 10, force: true });
  });

  it('stands down when the backend settles the turn, not when the user presses', () => {
    const onCancel = vi.fn();
    const { result, rerender } = renderHook(
      ({ isLive }: { isLive: boolean }) => useTwoPhaseStop({ isLive, onCancel }),
      { initialProps: { isLive: true } },
    );

    act(() => result.current.press());
    // Still live as far as the event stream is concerned: the control must
    // stay available, or a turn that ignored the abort has no escape.
    act(() => {
      vi.advanceTimersByTime(STOP_ARMING_MS + 50);
    });
    expect(result.current.enabled).toBe(true);

    rerender({ isLive: false });
    expect(result.current).toMatchObject({ phase: 'idle', enabled: false });
    act(() => result.current.press());
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('holds no timer while no turn is running', () => {
    const onCancel = vi.fn();
    renderHook(() => useTwoPhaseStop({ isLive: false, onCancel }));
    // An idle composer must not wake up five times a second forever.
    expect(vi.getTimerCount()).toBe(0);
  });
});
