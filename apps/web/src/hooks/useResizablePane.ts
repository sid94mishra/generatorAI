// ────────────────────────────────────────────────────────────────
// useResizablePane — drag-to-resize side panel width.
//
// Returns the current width (px) and a drag handle to attach to a
// resizer element. The initial width is derived from `defaultRatio`
// applied to the container width, clamped to [minPx, maxPx].
//
// The width is persisted per key in localStorage so it survives
// reloads and switching between run pages.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';

export interface ResizablePane {
  /** Current width in pixels. */
  width: number;
  /** True while the user is actively dragging the handle. */
  dragging: boolean;
  /** Callback ref — bind to the container whose width bounds the pane. */
  hostRef: (node: HTMLElement | null) => void;
  /** Bind to a <div> that acts as the drag handle. */
  handleProps: {
    onMouseDown: (e: React.MouseEvent) => void;
    onDoubleClick: () => void;
    role: 'separator';
    'aria-orientation': 'vertical';
    'aria-valuenow': number;
  };
  /** Reset to the default ratio (e.g. bound to a "reset" menu action). */
  reset: () => void;
}

interface UseResizablePaneOptions {
  /** localStorage key. */
  storageKey: string;
  /** Fraction of the *host* width when no stored value exists (0..1). */
  defaultRatio: number;
  /** Absolute floor (px). Defaults to 240. */
  minPx?: number;
  /** Absolute ceiling as a fraction of host width. Defaults to 0.8. */
  maxRatio?: number;
}

function readStored(key: string): number | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return null;
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: number) {
  try {
    window.localStorage.setItem(key, String(Math.round(value)));
  } catch {
    /* ignore quota / privacy errors */
  }
}

export function useResizablePane(opts: UseResizablePaneOptions): ResizablePane {
  const { storageKey, defaultRatio, minPx = 240, maxRatio = 0.8 } = opts;

  // Lazy initial width — try stored, else 0 (means "not yet computed;
  // fall back to ratio × host width when host is measured").
  const [width, setWidth] = useState<number>(() => readStored(storageKey) ?? 0);
  const [dragging, setDragging] = useState(false);
  // Store the host DOM node in state so effects react to it being (re)attached.
  const [hostNode, setHostNode] = useState<HTMLElement | null>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const hostRef = useCallback((node: HTMLElement | null) => {
    setHostNode(node);
  }, []);

  // Compute the initial width from ratio once the host is attached. Also
  // clamp on window resize so the pane never exceeds the viewport.
  useEffect(() => {
    if (!hostNode) return;

    const applyClamp = () => {
      const hostWidth = hostNode.clientWidth;
      if (hostWidth <= 0) return;
      const maxPx = Math.max(minPx, hostWidth * maxRatio);
      setWidth((prev) => {
        const base = prev > 0 ? prev : Math.round(hostWidth * defaultRatio);
        return Math.max(minPx, Math.min(maxPx, base));
      });
    };

    // Defer the first measurement — layout may not be settled yet on mount.
    const raf = requestAnimationFrame(applyClamp);
    const ro = new ResizeObserver(applyClamp);
    ro.observe(hostNode);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [hostNode, defaultRatio, minPx, maxRatio]);

  // Persist changes
  useEffect(() => {
    if (width > 0) writeStored(storageKey, width);
  }, [width, storageKey]);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startXRef.current = e.clientX;
      startWidthRef.current = width;
      setDragging(true);
    },
    [width],
  );

  // Global mousemove/mouseup while dragging.
  useEffect(() => {
    if (!dragging || !hostNode) return;
    const hostWidth = hostNode.clientWidth;
    const maxPx = Math.max(minPx, hostWidth * maxRatio);

    const handleMove = (e: MouseEvent) => {
      // Handle sits at the left edge of the *right* pane, so dragging left
      // makes the pane wider.
      const delta = startXRef.current - e.clientX;
      const next = startWidthRef.current + delta;
      setWidth(Math.max(minPx, Math.min(maxPx, next)));
    };
    const handleUp = () => setDragging(false);

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [dragging, hostNode, minPx, maxRatio]);

  const reset = useCallback(() => {
    if (!hostNode) return;
    const hostWidth = hostNode.clientWidth;
    const maxPx = Math.max(minPx, hostWidth * maxRatio);
    setWidth(Math.max(minPx, Math.min(maxPx, Math.round(hostWidth * defaultRatio))));
  }, [hostNode, defaultRatio, minPx, maxRatio]);

  return {
    width: width > 0 ? width : minPx,
    dragging,
    hostRef,
    handleProps: {
      onMouseDown,
      onDoubleClick: reset,
      role: 'separator',
      'aria-orientation': 'vertical',
      'aria-valuenow': width,
    },
    reset,
  };
}
