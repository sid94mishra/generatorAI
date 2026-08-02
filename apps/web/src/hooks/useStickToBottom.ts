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
    const onScroll = () => {
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < PIN_THRESHOLD_PX;
      pinnedRef.current = near;
      setShowJumpToLatest(!near);
    };
    el.addEventListener('scroll', onScroll, { passive: true });

    const follow = () => { if (pinnedRef.current) el.scrollTop = el.scrollHeight; };
    const ro = new ResizeObserver(follow);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    follow(); // initial pin

    return () => { el.removeEventListener('scroll', onScroll); ro.disconnect(); };
  }, [dep]);

  const jumpToLatest = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    pinnedRef.current = true;
    setShowJumpToLatest(false);
  }, []);

  return { ref, showJumpToLatest, jumpToLatest };
}
