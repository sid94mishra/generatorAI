// ────────────────────────────────────────────────────────────────
// useNarrow — the container-query flag T-02 `railStacked` / T-03
// `asideCollapsed` expect from their caller (the templates never watch their
// own width). Measures the element the ref lands on, so it follows the main
// card rather than the window.
// ────────────────────────────────────────────────────────────────

import { useCallback, useRef, useState } from 'react';

/** ~1150px: below it a 360 rail or a 320 aside no longer fits beside the content (03 §5). */
export const TEMPLATE_BREAKPOINT = 1150;

export function useNarrow<T extends HTMLElement>(threshold = TEMPLATE_BREAKPOINT) {
  const [narrow, setNarrow] = useState(false);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback(
    (node: T | null) => {
      observer.current?.disconnect();
      observer.current = null;
      if (!node || typeof ResizeObserver === 'undefined') return;
      const measure = (width: number) => setNarrow(width < threshold);
      measure(node.getBoundingClientRect().width);
      observer.current = new ResizeObserver(([entry]) => {
        if (entry) measure(entry.contentRect.width);
      });
      observer.current.observe(node);
    },
    [threshold],
  );
  return [ref, narrow] as const;
}
