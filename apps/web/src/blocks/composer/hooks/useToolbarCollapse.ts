import type React from 'react';
import { useEffect, useState } from 'react';

/** Below this toolbar width, effort and context tier fold into "More options" (F-composer-10). */
export const TOOLBAR_COLLAPSE_BELOW_PX = 420;

/**
 * Responsive collapse — watch the toolbar width and fold the reasoning +
 * context controls into the "⋯" overflow menu when the row gets tight, so
 * the icons never spill out of the card. They pop back inline when there's
 * room again. Threshold is a heuristic that comfortably fits the model
 * pill + both controls + the gauge on the left cluster.
 */
export function useToolbarCollapse(toolbarRef: React.RefObject<HTMLElement | null>): boolean {
  const [collapseControls, setCollapseControls] = useState(false);
  useEffect(() => {
    const el = toolbarRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setCollapseControls(w < TOOLBAR_COLLAPSE_BELOW_PX);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [toolbarRef]);
  return collapseControls;
}
