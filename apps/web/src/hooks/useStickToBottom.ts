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
// Follow writes are coalesced into one per animation frame: during a tool
// storm the ResizeObserver can fire several times between paints, and each
// `scrollTop` write forces a synchronous layout. One write per frame keeps
// the transcript glued to the bottom without the layout thrash — that, not a
// CSS smooth-scroll (which lags and fights the next flush), is what makes
// following feel smooth. The explicit "jump to latest" is the one place a
// smooth scroll is right, because the user asked for the travel.
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

export interface StickToBottom {
  ref: React.RefObject<HTMLDivElement | null>;
  showJumpToLatest: boolean;
  jumpToLatest: () => void;
}

export function useStickToBottom(dep: unknown): StickToBottom {
  const ref = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  // Track scroll position + follow content growth. Re-bound on `dep` so it
  // attaches once the element exists (after any loading skeleton). A
  // ResizeObserver catches async height changes (markdown/highlight layout,
  // smooth-reveal tail) that no `dep` change would otherwise re-trigger.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    let lastShow: boolean | null = null;
    let lastTop = el.scrollTop;
    const follow = () => {
      if (!pinnedRef.current || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (pinnedRef.current) el.scrollTop = el.scrollHeight;
      });
    };
    const onScroll = () => {
      const top = el.scrollTop;
      const near = el.scrollHeight - top - el.clientHeight < PIN_THRESHOLD_PX;
      pinnedRef.current = nextPinned(pinnedRef.current, { near, movedUp: top < lastTop - 1 });
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

    const ro = new ResizeObserver(follow);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    // The VIEWPORT changes height too, and that hides the latest content just
    // as surely as new content does: when the agent stops to ask a question,
    // the "1 tool running" and "waiting for your answer" strips appear under
    // the transcript and take ~50px from it. Nothing inside grew, so nothing
    // followed — the question card's Submit button (and a plan's Approve bar)
    // sat clipped below the fold of a list that believed it was at the bottom.
    ro.observe(el);
    if (pinnedRef.current) el.scrollTop = el.scrollHeight; // initial pin, synchronous

    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [dep]);

  const jumpToLatest = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    pinnedRef.current = true;
    setShowJumpToLatest(false);
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ top: el.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
  }, []);

  return { ref, showJumpToLatest, jumpToLatest };
}
