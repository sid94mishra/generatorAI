// ────────────────────────────────────────────────────────────────
// The Changes file-row height, in pixels.
//
// The diff virtualizer reserves space for every file header from a NUMBER
// before it measures, so the header height must be known exactly; a mismatch
// shows as dead space above the first file. The row is the 28h step row
// (`--gai-h-step`, 24 in Compact density), read from the token and re-read
// whenever the appearance attributes on <html> change (density is one).
// ────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';

const FALLBACK = 28;

function readStep(): number {
  if (typeof window === 'undefined') return FALLBACK;
  const px = Number.parseFloat(window.getComputedStyle(document.documentElement).getPropertyValue('--gai-h-step'));
  return Number.isFinite(px) && px > 0 ? px : FALLBACK;
}

export function useRowHeight(): number {
  const [height, setHeight] = useState(readStep);
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return undefined;
    const observer = new MutationObserver(() => setHeight(readStep()));
    observer.observe(document.documentElement, { attributes: true });
    setHeight(readStep());
    return () => observer.disconnect();
  }, []);
  return height;
}
