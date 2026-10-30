// ────────────────────────────────────────────────────────────────
// Changes panel view state: compare base, unified/split, wrap, the file tree
// (shown? which side?) and the checkpoint timeline (shown? overlay?).
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DiffViewMode } from './diffTypes.js';

export type TreePosition = 'left' | 'right';

/** Below this surface width the checkpoint timeline covers the diff. */
const CHECKPOINTS_OVERLAY_BELOW = 760;

export function useChangesViewSettings(defaultBase = 'baseline') {
  const [base, setBase] = useState(defaultBase);
  const [viewMode, setViewMode] = useState<DiffViewMode>('unified');
  /**
   * Whether the file tree is docked beside the diff.
   *
   * Off by default: with every file rendered as a collapsed header the diff
   * pane already IS the file list, so the tree is a second copy of the same
   * information until the user asks for it.
   */
  const [showTree, setShowTree] = useState(false);
  const [treePosition, setTreePosition] = useState<TreePosition>('left');
  const [wrapLines, setWrapLines] = useState(false);

  const toggleTree = useCallback(() => setShowTree((v) => !v), []);
  const toggleWrapLines = useCallback(() => setWrapLines((w) => !w), []);
  /** Choosing a side is asking to see the tree there. */
  const placeTree = useCallback((position: TreePosition) => {
    setTreePosition(position);
    setShowTree(true);
  }, []);

  return {
    base,
    setBase,
    viewMode,
    setViewMode,
    showTree,
    toggleTree,
    treePosition,
    placeTree,
    wrapLines,
    toggleWrapLines,
  };
}

/**
 * The checkpoint timeline beside (or over) the diff.
 *
 * It lives on the Changes surface rather than in each host page so every
 * surface that renders changes gets rewind for free. Layout follows the
 * SURFACE width, not the viewport: the surface runs in a ~640px side pane and
 * across a full-width run page, and the viewport says nothing about either.
 */
export function useCheckpointPanel() {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [overlay, setOverlay] = useState(false);
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => {
      // 288px of timeline plus a diff still worth reading.
      setOverlay((entry?.contentRect.width ?? 0) < CHECKPOINTS_OVERLAY_BELOW);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  const close = useCallback(() => setOpen(false), []);

  return { surfaceRef, open, overlay, toggle, close };
}
