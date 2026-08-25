// ────────────────────────────────────────────────────────────────
// FrameCoalescer — W05, the "one write per flush" half.
//
// Encoding once per event (P1-10) removed the O(K) `JSON.stringify`. It did
// not remove the O(N) `res.write()`: every token was still its own syscall on
// every subscriber's socket, which is the cost that actually scales with how
// fast the model talks.
//
// So deltas are buffered and written together. Two rules decide when:
//
//   ITEM   flushes immediately. A `tool_call` or a `stage_run.*` is something
//          the user is waiting to see, and holding one for 16 ms to save a
//          syscall trades the thing that matters for the thing that does not.
//
//   DELTA  waits out an adaptive window. Tokens are only meaningful as a
//          stream, and a reader cannot perceive the difference between one
//          arriving now and arriving 8 ms from now.
//
// The window is adaptive because a fixed one is wrong in both directions. Wide
// is pure latency on a slow producer that never fills it; narrow coalesces
// nothing on a fast one. It therefore follows the producer: a flush that
// carried a real batch widens it, a flush that carried a single frame collapses
// it back to the floor.
// ────────────────────────────────────────────────────────────────

/** Floor. Below this the window costs a timer and coalesces almost nothing. */
export const MIN_WINDOW_MS = 4;

/**
 * Ceiling. 16 ms is one frame at 60 Hz — the longest a delay can be while still
 * being invisible in a paint the client was going to do anyway.
 */
export const MAX_WINDOW_MS = 16;

/** Frames in one flush above which the producer is judged faster than the window. */
const GROW_ABOVE = 8;

export class FrameCoalescer {
  private pending = '';
  private count = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private window = MIN_WINDOW_MS;

  constructor(private readonly onFlush: (payload: string) => void) {}

  /** Current adaptive window, in ms. Exposed for tests and diagnostics. */
  get windowMs(): number {
    return this.window;
  }

  /** Frames buffered and not yet written. */
  get pendingCount(): number {
    return this.count;
  }

  /** Buffer a frame that may wait. Arms the window on the first one. */
  defer(frame: string): void {
    this.pending += frame;
    this.count += 1;
    if (this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, this.window);
    // A coalescing window must never be the reason the process cannot exit.
    // Anything still buffered at that point is at most 16 ms of tokens on a
    // socket that is being torn down regardless.
    this.timer.unref?.();
  }

  /** Buffer a frame and write everything, now. */
  flushWith(frame: string): void {
    this.pending += frame;
    this.count += 1;
    this.flush();
  }

  flush(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.count === 0) return;
    const payload = this.pending;
    const flushed = this.count;
    // Cleared BEFORE `onFlush`, which writes to a socket and can re-enter here
    // through a 'drain' or an error path. Clearing afterwards would write the
    // same bytes twice.
    this.pending = '';
    this.count = 0;
    this.adapt(flushed);
    this.onFlush(payload);
  }

  /** Discard anything buffered. For a socket that is going away. */
  cancel(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.pending = '';
    this.count = 0;
  }

  private adapt(flushed: number): void {
    if (flushed > GROW_ABOVE) {
      this.window = Math.min(MAX_WINDOW_MS, this.window * 2);
    } else if (flushed <= 1) {
      // One frame per window means the wait bought nothing and cost latency.
      this.window = MIN_WINDOW_MS;
    }
  }
}
