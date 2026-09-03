// ────────────────────────────────────────────────────────────────
// scheduleFrame — W26's frame-aligned drain.
//
// The thing this replaces, and why it was wrong: coalescing a token stream
// with `queueMicrotask` collapses only the work produced inside ONE macrotask.
// SSE frames arrive roughly one macrotask apart, so a microtask flush fires
// once per frame — it does not coalesce anything a fast model actually does.
// With twenty stages streaming that is still tens of store writes and
// invalidation batches per second, each one a full React render pass.
//
// A frame boundary is the right unit because it is the granularity the user
// can perceive: work collapsed inside one frame is invisible, and work spread
// across frames is exactly what dropping a frame means.
//
// ── Why both a rAF and a timer, always ───────────────────────────
// `requestAnimationFrame` is the real frame boundary, and in a BACKGROUND TAB
// it never fires at all. Scheduling on rAF alone would mean a chat left in an
// inactive tab drains nothing and refetches nothing until the user comes back
// — the buffered text would eventually land, but every query invalidation the
// turn produced would sit unflushed behind it, so the tab would return with
// stale lists. The previous `setTimeout(16)` did not have that failure, and
// replacing it with a plain rAF would have introduced one.
//
// So both are armed and whichever fires first wins; the loser is cancelled.
// In a visible tab that is the rAF, on the frame; in a hidden tab (or Node, or
// React Native without rAF) it is the timer, at roughly the same cadence the
// old implementation used.
//
// Deliberately NOT a class or a registry: the caller owns its own handle, so
// two independent drains cannot accidentally cancel each other.
// ────────────────────────────────────────────────────────────────

/** Opaque handle; pass it to `cancelFrame`. */
export interface FrameHandle {
  raf: number | null;
  timer: ReturnType<typeof setTimeout> | null;
}

/** Timer cadence when rAF is unavailable or throttled. Roughly one frame. */
const FRAME_MS = 16;

function raf(): ((cb: () => void) => number) | null {
  const fn = (globalThis as { requestAnimationFrame?: (cb: () => void) => number })
    .requestAnimationFrame;
  return typeof fn === 'function' ? fn.bind(globalThis) : null;
}

function cancelRaf(id: number): void {
  const fn = (globalThis as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame;
  if (typeof fn === 'function') fn.call(globalThis, id);
}

/** Run `callback` at the next frame boundary — or at ~16 ms if there is none. */
export function scheduleFrame(callback: () => void): FrameHandle {
  const handle: FrameHandle = { raf: null, timer: null };
  let fired = false;
  const fire = (): void => {
    if (fired) return;
    fired = true;
    // Cancel the loser before running the callback: the callback frequently
    // schedules the NEXT frame, and a stale sibling firing afterwards would
    // double it.
    cancelFrame(handle);
    callback();
  };

  const request = raf();
  if (request) handle.raf = request(fire);
  handle.timer = setTimeout(fire, FRAME_MS);
  return handle;
}

/** Cancel a pending frame callback. Safe to call after it has already run. */
export function cancelFrame(handle: FrameHandle | null): void {
  if (!handle) return;
  if (handle.raf !== null) {
    cancelRaf(handle.raf);
    handle.raf = null;
  }
  if (handle.timer !== null) {
    clearTimeout(handle.timer);
    handle.timer = null;
  }
}
