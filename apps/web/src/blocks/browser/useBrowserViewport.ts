// ────────────────────────────────────────────────────────────────
// Screencast viewport sync: the live view's size → the headless page's
// viewport (`/resize`), and the page's scroll metrics ← `/scroll` (drives the
// overlay scrollbar headless frames lack).
// ────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';

import { fetchBrowserScroll, postBrowserViewport, type BrowserMode, type BrowserScrollState } from './browserApi.js';

/** A resize is pushed only when a side changes by at least this much (px)… */
export const RESIZE_THRESHOLD = 256;
/** …after the size has settled this long (ms)… */
export const RESIZE_DEBOUNCE_MS = 400;
/** …and never below this size (px) on either side. */
export const RESIZE_MIN_EDGE = 100;
const RESIZE_INITIAL_DELAY_MS = 100;
export const SCROLL_POLL_MS = 250;

interface ViewportOptions {
  open: boolean;
  workspaceId: string | undefined;
  ready: boolean | undefined;
  mode: BrowserMode | undefined;
}

/** Push the live-view container's size to the page. Returns the container ref. */
export function useBrowserViewportResize({ open, workspaceId, ready }: Omit<ViewportOptions, 'mode'>): React.RefObject<HTMLDivElement | null> {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open || !workspaceId || !ready) return;
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let pending: ReturnType<typeof setTimeout> | null = null;
    let lastW = 0, lastH = 0;
    const push = (w: number, h: number): void => {
      lastW = w; lastH = h;
      postBrowserViewport(workspaceId, w, h);
    };
    const obs = new ResizeObserver((entries) => {
      const entry = entries[0]; if (!entry) return;
      const w = Math.round(entry.contentRect.width);
      const h = Math.round(entry.contentRect.height);
      if (w < RESIZE_MIN_EDGE || h < RESIZE_MIN_EDGE) return;
      if (lastW !== 0 && Math.abs(w - lastW) < RESIZE_THRESHOLD && Math.abs(h - lastH) < RESIZE_THRESHOLD) return;
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => push(w, h), RESIZE_DEBOUNCE_MS);
    });
    obs.observe(el);
    const rect = el.getBoundingClientRect();
    if (rect.width >= RESIZE_MIN_EDGE && rect.height >= RESIZE_MIN_EDGE) {
      pending = setTimeout(() => push(Math.round(rect.width), Math.round(rect.height)), RESIZE_INITIAL_DELAY_MS);
    }
    return () => { obs.disconnect(); if (pending) clearTimeout(pending); };
  }, [open, workspaceId, ready]);
  return containerRef;
}

/** Poll the page's scroll metrics while a screencast is live. */
export function useBrowserScrollState({ open, workspaceId, ready, mode }: ViewportOptions): {
  scrollState: BrowserScrollState | null;
  setScrollState: React.Dispatch<React.SetStateAction<BrowserScrollState | null>>;
} {
  const [scrollState, setScrollState] = useState<BrowserScrollState | null>(null);
  useEffect(() => {
    // Only the screencast view draws an overlay scrollbar (headless frames
    // carry no native one). A native view scrolls itself, so polling it every
    // 250 ms over CDP was pure cost.
    if (!open || !workspaceId || !ready || mode === 'native') { setScrollState(null); return; }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async (): Promise<void> => {
      if (cancelled) return;
      try {
        const data = await fetchBrowserScroll(workspaceId);
        if (data && !cancelled) setScrollState(data);
      } catch { /* silent */ }
      if (!cancelled) timer = setTimeout(tick, SCROLL_POLL_MS);
    };
    void tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [open, workspaceId, ready, mode]);
  return { scrollState, setScrollState };
}
