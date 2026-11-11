import type React from 'react';
import { useEffect, useRef, useState } from 'react';

/** Below this toolbar width, effort and context tier fold into "More options" (F-composer-10). */
export const TOOLBAR_COLLAPSE_BELOW_PX = 420;

/** The width the toolbar's items take on one row: their widths plus the gaps between them. */
function rowWidth(el: HTMLElement): number {
  const items: Element[] = [];
  for (const child of Array.from(el.children)) {
    // The menus wrapper is `display: contents`: its children are the row's items.
    if (getComputedStyle(child).display === 'contents') items.push(...Array.from(child.children));
    else items.push(child);
  }
  const widths = items.map((i) => i.getBoundingClientRect().width).filter((w) => w > 0);
  const gap = Number.parseFloat(getComputedStyle(el).columnGap) || 0;
  return widths.reduce((sum, w) => sum + w, 0) + gap * Math.max(0, widths.length - 1);
}

/**
 * Responsive collapse — fold the reasoning + context controls into the "⋯"
 * overflow menu when the row no longer fits on one line, so the gauge and
 * Compact never wrap under the attach button. A fixed width was not enough:
 * how much fits depends on the model label ("Sonnet 5.5" vs "GPT-5.6-Terra"),
 * the agent-mode chip and whether the chat has a gauge. The controls come back
 * once the toolbar is as wide as the row they needed.
 */
export function useToolbarCollapse(toolbarRef: React.RefObject<HTMLElement | null>): boolean {
  const [collapseControls, setCollapseControls] = useState(false);
  const collapsed = useRef(false);
  /** The row width the full controls needed when they last did not fit. */
  const needed = useRef(0);
  useEffect(() => {
    const el = toolbarRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    // Fires on a width change and on a wrap (the toolbar grows a row).
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      let next: boolean;
      if (w < TOOLBAR_COLLAPSE_BELOW_PX) next = true;
      else if (collapsed.current) next = w < needed.current;
      else {
        const row = rowWidth(el);
        next = row > w + 0.5;
        if (next) needed.current = row;
      }
      collapsed.current = next;
      setCollapseControls(next);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [toolbarRef]);
  return collapseControls;
}
