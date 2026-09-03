// ────────────────────────────────────────────────────────────────
// P1-51 — invalidation coalescing.
//
// A 20-stage run fires ~160 full refetches a second: every stage event
// invalidates its own chat-history key, the run key and the runs list. The
// microtask de-dup that was there first only collapsed the keys of a single
// SSE frame, because frames arrive one macrotask apart. The window is now a
// frame (16 ms), matching mobile's `useChatStream`.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scheduleInvalidation, _flushInvalidationsNow } from '@/stores/sseManager.js';
import { queryClient } from '@/providers/QueryProvider.js';

describe('scheduleInvalidation', () => {
  // The real client's overloaded signature does not fit `MockInstance`'s
  // generic, so the handle is typed by what the assertions actually use.
  let spy: { mockRestore: () => void } & ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    spy = vi.spyOn(queryClient, 'invalidateQueries')
      .mockImplementation(async () => {}) as unknown as typeof spy;
  });
  afterEach(() => {
    _flushInvalidationsNow();
    spy.mockRestore();
    vi.useRealTimers();
  });

  it('collapses identical keys within the tick to one invalidation', () => {
    for (let i = 0; i < 50; i++) scheduleInvalidation(['chat', 'c1', 'messages']);
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(16);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('collapses keys queued across separate macrotasks inside one frame', () => {
    scheduleInvalidation(['run', 'r1']);
    vi.advanceTimersByTime(4); // a later SSE frame, same 16 ms window
    scheduleInvalidation(['run', 'r1']);
    scheduleInvalidation(['run', 'r1']);
    vi.advanceTimersByTime(12);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('still issues one invalidation per distinct key', () => {
    scheduleInvalidation(['a']);
    scheduleInvalidation(['b']);
    scheduleInvalidation(['a']);
    vi.advanceTimersByTime(16);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('opens a fresh window after a flush', () => {
    scheduleInvalidation(['a']);
    vi.advanceTimersByTime(16);
    scheduleInvalidation(['a']);
    expect(spy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(16);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('does not fire before the window closes', () => {
    scheduleInvalidation(['a']);
    vi.advanceTimersByTime(15);
    expect(spy).not.toHaveBeenCalled();
  });
});
