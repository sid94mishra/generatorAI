// ────────────────────────────────────────────────────────────────
// exitAfterBoundedFlush — APPLICATION-REVIEW-2026-09 §6.7 ("three shutdown
// paths skip the final flush"). Pins: the flush is attempted, the exit
// happens exactly once, and a hung flush cannot hold the process past the
// deadline.
// ────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FAULT_FLUSH_DEADLINE_MS, exitAfterBoundedFlush } from '../boundedFlush.js';

describe('exitAfterBoundedFlush', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('flushes, then exits exactly once with the given code', async () => {
    const flush = vi.fn(async () => {});
    const exit = vi.fn();
    await exitAfterBoundedFlush(1, { flush, exit, log: () => {} });
    expect(flush).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    // The deadline timer must not fire a second exit later.
    await vi.advanceTimersByTimeAsync(FAULT_FLUSH_DEADLINE_MS * 2);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('gives up on a hung flush at the deadline and still exits once', async () => {
    const flush = vi.fn(() => new Promise<void>(() => {}));
    const exit = vi.fn();
    const log = vi.fn();
    const done = exitAfterBoundedFlush(1, { flush, exit, log });
    await vi.advanceTimersByTimeAsync(FAULT_FLUSH_DEADLINE_MS - 1);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toMatch(/abandoned/);
    void done; // the flush promise never settles; the exit already happened
  });

  it('exits even when the flush rejects, and does not throw', async () => {
    const flush = vi.fn(async () => {
      throw new Error('db closed');
    });
    const exit = vi.fn();
    const log = vi.fn();
    await expect(exitAfterBoundedFlush(1, { flush, exit, log })).resolves.toBeUndefined();
    expect(exit).toHaveBeenCalledWith(1);
    expect(log.mock.calls[0]?.[0]).toContain('db closed');
  });

  it('exits immediately when no flush is available (pre-container fault)', async () => {
    const exit = vi.fn();
    await exitAfterBoundedFlush(1, { exit, log: () => {} });
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('defaults to the documented 2 s deadline', () => {
    expect(FAULT_FLUSH_DEADLINE_MS).toBe(2_000);
  });
});
