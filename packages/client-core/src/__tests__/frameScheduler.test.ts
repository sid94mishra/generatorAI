// ────────────────────────────────────────────────────────────────
// W26 — the frame-aligned drain.
//
// The two failures this guards against, both of which are silent:
//
//   * scheduling on `requestAnimationFrame` ALONE, which never fires in a
//     background tab, so a chat left in an inactive tab stops draining and
//     stops refetching entirely;
//   * firing BOTH the rAF and the timer, which doubles every drain and every
//     invalidation batch in a visible tab.
// ────────────────────────────────────────────────────────────────

import { afterEach, describe, expect, it, vi } from 'vitest';

import { cancelFrame, scheduleFrame } from '../stream/frameScheduler.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('scheduleFrame', () => {
  it('runs on the animation frame when one is delivered', () => {
    // Fake timers first: vitest's own fake timers replace `requestAnimationFrame`,
    // so stubbing it before installing them would be immediately clobbered.
    vi.useFakeTimers();
    const pending: Array<() => void> = [];
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      pending.push(cb);
      return pending.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});

    const run = vi.fn();
    scheduleFrame(run);
    expect(run).not.toHaveBeenCalled();

    pending[0]!();
    expect(run).toHaveBeenCalledTimes(1);

    // The timer must not fire a second time behind the frame that already ran.
    vi.advanceTimersByTime(1000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('still runs when the animation frame never arrives (a background tab)', () => {
    vi.useFakeTimers();
    // rAF exists and is simply never called back — which is exactly what a
    // hidden tab looks like, and why an rAF-only scheduler stalls there.
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});

    const run = vi.fn();
    scheduleFrame(run);
    vi.advanceTimersByTime(20);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs on the timer where there is no rAF at all (Node, React Native)', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', undefined);

    const run = vi.fn();
    scheduleFrame(run);
    vi.advanceTimersByTime(20);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('cancels both arms', () => {
    vi.useFakeTimers();
    const pending: Array<() => void> = [];
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      pending.push(cb);
      return pending.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});

    const run = vi.fn();
    cancelFrame(scheduleFrame(run));
    vi.advanceTimersByTime(1000);
    expect(run).not.toHaveBeenCalled();
  });

  it('is safe to cancel after it has already run', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', undefined);

    const run = vi.fn();
    const handle = scheduleFrame(run);
    vi.advanceTimersByTime(20);
    expect(() => cancelFrame(handle)).not.toThrow();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
