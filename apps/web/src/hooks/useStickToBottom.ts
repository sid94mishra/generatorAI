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
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';

const PIN_THRESHOLD_PX = 80;

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
    const onScroll = () => {
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < PIN_THRESHOLD_PX;
      pinnedRef.current = near;
      // Only touch React state on a transition — this handler runs on every
      // scroll event, including the ones our own follow writes cause.
      if (lastShow !== !near) {
        lastShow = !near;
        setShowJumpToLatest(!near);
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });

    const follow = () => {
      if (!pinnedRef.current || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (pinnedRef.current) el.scrollTop = el.scrollHeight;
      });
    };
    const ro = new ResizeObserver(follow);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
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
