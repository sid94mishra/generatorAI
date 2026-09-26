// ────────────────────────────────────────────────────────────────
// useChangesNavigation — which file is active, which are expanded, and
// getting a file on screen.
//
// Every "show me this file" path — the transcript's `focusFile` token, a tree
// click, a comment picked from the comments list, a mount-group click — goes
// through `reveal` / `requestScroll`, so they agree on what revealing means:
// mark it active, open the Kept group if it lives there, expand it, and
// scroll the viewer to it after the re-render.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { DiffCodeViewHandle } from './diffTypes.js';
import type { DiffSourceEntry, useExpandedDiffs } from './useDiffSources.js';

/** Up to this many changed files open expanded without a click. */
const AUTO_EXPAND_MAX = 3;

export interface UseChangesNavigationOptions {
  /** Every row on the surface, kept or not. */
  entries: readonly DiffSourceEntry[];
  keptIds: ReadonlySet<string>;
  display: (alias: string, path: string) => string;
  expanded: ReturnType<typeof useExpandedDiffs>;
  openKept: () => void;
  viewerRef: RefObject<Pick<DiffCodeViewHandle, 'scrollToItem'> | null>;
  /**
   * Imperative "show me this file" (display path). A fresh `token` re-fires
   * the focus even for the same path.
   */
  focusFile?: { path: string; token: number } | null | undefined;
}

export function useChangesNavigation({
  entries,
  keptIds,
  display,
  expanded,
  openKept,
  viewerRef,
  focusFile,
}: UseChangesNavigationOptions) {
  const { expandedIds, toggle, expandAll, collapseAll } = expanded;
  const [activePath, setActivePath] = useState<string | null>(null);

  /**
   * File the viewer still owes us a scroll to, flushed by the effect below.
   *
   * Scrolling straight from the click does not survive: marking a file active
   * re-renders the surface, which hands the viewer a new `renderHeader` and
   * therefore a new options object, and applying those options discards any
   * scroll still in flight. Parking the request and replaying it after the
   * commit puts it last, where nothing is left to cancel it.
   *
   * The nonce guarantees that commit happens: a request whose other state
   * updates are all no-ops (a mount-group click with no active row) would
   * otherwise never re-render, and the parked scroll would be lost.
   */
  const pendingScrollRef = useRef<string | null>(null);
  const [, setScrollNonce] = useState(0);
  useEffect(() => {
    const id = pendingScrollRef.current;
    if (id == null) return;
    pendingScrollRef.current = null;
    viewerRef.current?.scrollToItem(id);
  });
  const requestScroll = useCallback((id: string) => {
    pendingScrollRef.current = id;
    setScrollNonce((n) => n + 1);
  }, []);

  const allIds = useMemo(() => entries.map((e) => e.id), [entries]);

  /**
   * Files that can actually be opened. Binary and oversized files render a
   * placeholder instead of a diff, so counting them would leave "Expand all"
   * looking stuck: it could never reach the all-expanded state.
   */
  const expandableIds = useMemo(
    () => entries.filter((e) => !e.file.isBinary && !e.file.isTooLarge).map((e) => e.id),
    [entries],
  );
  const allExpanded =
    expandableIds.length > 0 && expandableIds.every((id) => expandedIds.has(id));
  const toggleExpandAll = useCallback(() => {
    if (allExpanded) collapseAll();
    else expandAll(expandableIds);
  }, [allExpanded, collapseAll, expandAll, expandableIds]);

  // Auto-expand a small change set — for one or two files the extra click is
  // pure friction, and the payload is trivial.
  const autoExpandKey = allIds.join('\u0000');
  useEffect(() => {
    if (allIds.length > 0 && allIds.length <= AUTO_EXPAND_MAX) expandAll(allIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoExpandKey]);

  /**
   * Put one file on screen: active, its group open, expanded, scrolled to.
   * A kept file lives in the collapsed group at the bottom; revealing one
   * without opening that group would highlight a row nobody can see.
   */
  const reveal = useCallback(
    (id: string, displayPath: string) => {
      setActivePath(displayPath);
      if (keptIds.has(id)) openKept();
      if (!expandedIds.has(id)) toggle(id);
      requestScroll(id);
    },
    [keptIds, openKept, expandedIds, toggle, requestScroll],
  );

  // External focus (transcript → this file). Waits for the summary to list
  // the file: a click on a just-written file can arrive before the refetch
  // that adds it, and the request must not be lost to that race.
  const lastFocusToken = useRef<number | null>(null);
  useEffect(() => {
    if (!focusFile || lastFocusToken.current === focusFile.token) return;
    const entry = entries.find((e) => display(e.alias, e.file.path) === focusFile.path);
    if (!entry) return;
    lastFocusToken.current = focusFile.token;
    reveal(entry.id, focusFile.path);
  }, [focusFile, entries, display, reveal]);

  const selectTreePath = useCallback(
    (path: string) => {
      const entry = entries.find((e) => display(e.alias, e.file.path) === path);
      if (!entry) return;
      // The list is virtualized, so only the viewer knows where the row is;
      // aligning to the top also means the diff that is about to expand opens
      // into view rather than below the fold.
      reveal(entry.id, path);
    },
    [entries, display, reveal],
  );

  /** Jump to a mount group's first file. Nothing stays highlighted. */
  const jumpToGroup = useCallback(
    (firstId: string) => {
      requestScroll(firstId);
      setActivePath(null);
    },
    [requestScroll],
  );

  return {
    activePath,
    expandedIds,
    toggle,
    expandableIds,
    allExpanded,
    toggleExpandAll,
    reveal,
    selectTreePath,
    jumpToGroup,
  };
}
