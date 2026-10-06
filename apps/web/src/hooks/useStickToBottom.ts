// ────────────────────────────────────────────────────────────────
// useStickToBottom — auto-follow a scroll container while the user is
// pinned near the bottom; the moment they scroll up, stop following and
// surface a "jump to latest" affordance.
//
// Driven by a `dep` that changes whenever content grows (message count,
// streamed text length, status). The effects re-run on `dep`, so they bind
// correctly even when the panel renders a loading skeleton first, and they
// follow each streaming flush. A programmatic scroll lands at the bottom
// (near = true), so it never flips the pinned state — no guard needed.
//
// Following is a rAF-driven spring (D-91, `followStep`): content that grows —
// the paced text reveal, a tool card — is tracked as one continuous motion
// instead of a jump per chunk; the loop runs only while there is a gap and
// reads layout once per frame. "Jump to latest" travels on the same spring.
// Reduced motion: every follow is one step.
//
// Only the READER unpins. A scroll event arrives a frame after the write that
// caused it, and a large response grows by more than the threshold between
// the two (a table, a code block, a burst of streamed markdown). Reading that
// event as "the reader left the bottom" stopped following in the middle of
// every long answer. So a scroll event unpins only when the view moved UP;
// one that lands lower (our own follow, the reader scrolling down) keeps the
// current state, and reaching the bottom always pins.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';

const PIN_THRESHOLD_PX = 80;

/**
 * Whether the view keeps following after a scroll event: reaching the bottom
 * pins, moving up away from it unpins, anything else (our own follow write
 * landing short of content that grew meanwhile, scrolling down) keeps the state.
 */
export function nextPinned(pinned: boolean, scroll: { near: boolean; movedUp: boolean }): boolean {
  if (scroll.near) return true;
  if (scroll.movedUp) return false;
  return pinned;
}

/** The "Reduce motion" setting (`data-motion="reduce"` on <html>, D-20) or the OS preference. */
function prefersReducedMotion(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.getAttribute('data-motion') === 'reduce') return true;
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The follow is a velocity spring (after StackBlitz's use-stick-to-bottom):
 * per 60 Hz frame `v = (DAMPING·v + STIFFNESS·gap) / MASS`, then `top += v`.
 * Unlike an eased duration it tracks a target that keeps moving (text still
 * arriving) without stopping and restarting at every chunk.
 */
const DAMPING = 0.7;
const STIFFNESS = 0.05;
const MASS = 1.25;

/**
 * One frame of the follow: the next `scrollTop` (and velocity) toward `max`.
 * Frame-rate independent (`dtMs`); never overshoots the bottom; one step under
 * reduced motion.
 */
export function followStep(
  top: number,
  max: number,
  velocity: number,
  dtMs: number,
  options: { reducedMotion?: boolean } = {},
): { top: number; velocity: number } {
  const gap = max - top;
  if (gap <= 0.5 || options.reducedMotion) return { top: max, velocity: 0 };
  // Integrate in whole 60 Hz sub-steps (at least one), so 30 Hz and 120 Hz screens follow the same curve.
  const steps = Math.max(1, Math.min(4, Math.round(dtMs / (1000 / 60))));
  let v = velocity;
  let next = top;
  for (let i = 0; i < steps && next < max; i += 1) {
    v = (DAMPING * v + STIFFNESS * (max - next)) / MASS;
    next = Math.min(max, next + Math.max(0.5, v));
  }
  return { top: next, velocity: next >= max ? 0 : v };
}

export interface StickToBottom {
  ref: React.RefObject<HTMLDivElement | null>;
  showJumpToLatest: boolean;
  jumpToLatest: () => void;
}

export interface StickToBottomOptions {
  /** Use this element instead of the returned `ref` (a page that already owns its scroll host). */
  ref?: React.RefObject<HTMLDivElement | null>;
  /**
   * Start following (default). False: follow only once the reader reaches the
   * bottom — a page whose top matters (a workflow run's header) is not yanked
   * down on open, but a reader at the end of a streaming stage stays with it.
   */
  initiallyPinned?: boolean;
}

export function useStickToBottom(dep: unknown, options: StickToBottomOptions = {}): StickToBottom {
  const ownRef = useRef<HTMLDivElement | null>(null);
  const ref = options.ref ?? ownRef;
  const pinnedRef = useRef(options.initiallyPinned !== false);
  const boundRef = useRef(false);
  const velocityRef = useRef(0);
  const startRef = useRef<() => void>(() => {});
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  // Track scroll position + follow content growth. Re-bound on `dep` so it
  // attaches once the element exists (after any loading skeleton). A
  // ResizeObserver catches async height changes (markdown/highlight layout,
  // the paced reveal) that no `dep` change would otherwise re-trigger.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    let last: number | null = null;
    let lastShow: boolean | null = null;
    let lastTop = el.scrollTop;
    const step = (now: number) => {
      frame = 0;
      if (!pinnedRef.current) {
        velocityRef.current = 0;
        return;
      }
      const max = el.scrollHeight - el.clientHeight;
      if (max - el.scrollTop <= 0.5) {
        last = null;
        velocityRef.current = 0;
        return;
      }
      const dt = last === null ? 1000 / 60 : Math.min(64, now - last);
      last = now;
      const next = followStep(el.scrollTop, max, velocityRef.current, dt, { reducedMotion: prefersReducedMotion() });
      velocityRef.current = next.velocity;
      el.scrollTop = next.top;
      lastTop = el.scrollTop;
      frame = requestAnimationFrame(step);
    };
    const follow = () => {
      if (!pinnedRef.current || frame) return;
      frame = requestAnimationFrame(step);
    };
    startRef.current = follow;
    const onScroll = () => {
      const top = el.scrollTop;
      const fromEnd = el.scrollHeight - top - el.clientHeight;
      const near = fromEnd < PIN_THRESHOLD_PX;
      // Content that shrank (a table or code block re-laid out) clamps scrollTop down to the new
      // end: that is not the reader scrolling up.
      const clamped = fromEnd < 1;
      pinnedRef.current = nextPinned(pinnedRef.current, { near, movedUp: top < lastTop - 1 && !clamped });
      lastTop = top;
      const show = !pinnedRef.current;
      // Only touch React state on a transition — this handler runs on every
      // scroll event, including the ones our own follow writes cause.
      if (lastShow !== show) {
        lastShow = show;
        setShowJumpToLatest(show);
      }
      if (pinnedRef.current && !near) follow();
    };
    el.addEventListener('scroll', onScroll, { passive: true });

    // A reader already at the end when the content grows (no scroll event says
    // so — a page that fit its viewport, or one scrolled to the end) follows it.
    let lastMax = el.scrollHeight - el.clientHeight;
    const onResize = () => {
      const max = el.scrollHeight - el.clientHeight;
      if (!pinnedRef.current && lastMax - el.scrollTop < PIN_THRESHOLD_PX && max > lastMax) {
        pinnedRef.current = true;
        if (lastShow !== false) {
          lastShow = false;
          setShowJumpToLatest(false);
        }
      }
      lastMax = max;
      follow();
    };
    const ro = new ResizeObserver(onResize);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    // The VIEWPORT changes height too, and that hides the latest content just
    // as surely as new content does: when the agent stops to ask a question,
    // the "1 tool running" and "waiting for your answer" strips appear under
    // the transcript and take ~50px from it. Nothing inside grew, so nothing
    // followed — the question card's Submit button (and a plan's Approve bar)
    // sat clipped below the fold of a list that believed it was at the bottom.
    ro.observe(el);
    // The first bind pins synchronously (no frame at the top of a long chat).
    // A re-bind (every turn boundary) follows on the next frame instead: a
    // synchronous scrollHeight read inside the commit forced a full layout of a
    // long transcript in the middle of the turn-end render (D-88).
    if (pinnedRef.current && !boundRef.current) {
      el.scrollTop = el.scrollHeight;
      lastTop = el.scrollTop;
    } else {
      follow();
    }
    boundRef.current = true;

    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [dep, ref]);

  const jumpToLatest = useCallback(() => {
    pinnedRef.current = true;
    setShowJumpToLatest(false);
    startRef.current();
  }, []);

  return { ref, showJumpToLatest, jumpToLatest };
}
