// ────────────────────────────────────────────────────────────────
// DiffCodeView — virtualized multi-file diff surface
// ────────────────────────────────────────────────────────────────
//
// Wraps @pierre/diffs `CodeView`, which owns one scroll container holding a
// mixed list of file/diff items with per-line virtualization. That is the
// only reason a 10 000-line diff renders at all: the previous implementation
// emitted one <div> per line into the DOM.
//
// Item ownership is IMPERATIVE (`initialItems` + a ref), not controlled.
// Diff data arrives from SSE-driven refetches while the agent works, and
// routing every update through React state would thrash the list. Instead we
// reconcile against the viewer handle and bump each item's `version`, which
// is the library's deliberate escape hatch from expensive deep equality.

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { CodeView } from '@pierre/diffs/react';
import type { CodeViewHandle } from '@pierre/diffs/react';
import type {
  CodeViewItem,
  CodeViewLineSelection,
  SelectedLineRange,
} from '@pierre/diffs';
import { parseDiffFromFile, parsePatchFiles, setLanguageOverride } from '@pierre/diffs';
import { useTheme } from '@/providers/ThemeProvider.js';
import { DIFF_THEMES, DIFF_UNSAFE_CSS, diffHostStyle } from './diffTheme.js';

/** Annotation payload we attach to lines (review threads, CI notes, …). */
export type DiffAnnotationMeta = Record<string, unknown>;

export type DiffViewMode = 'split' | 'unified';

/** One file to render, already resolved to content or a patch. */
export interface DiffSource {
  /** Stable id — `${alias}:${path}`. Drives scrollTo/selection/reconciliation. */
  id: string;
  alias: string;
  path: string;
  /** Old/new contents. Preferred: enables "expand unchanged context". */
  oldContents?: string | null;
  newContents?: string | null;
  /** Unified patch fallback when the bodies are too large to ship. */
  patch?: string;
  lang?: string;
  /** `<oldBlob>:<newBlob>` — the worker pool's AST cache key. */
  cacheKey?: string;
  collapsed?: boolean;
  /** Rendered under the given line via `renderAnnotation`. */
  annotations?: DiffAnnotation[];
}

export interface DiffAnnotation {
  side: 'additions' | 'deletions';
  /** 0 = file-level, above the first hunk. */
  lineNumber: number;
  metadata: Record<string, unknown>;
}

export interface DiffLineRange {
  start: number;
  end: number;
  side: 'additions' | 'deletions';
  endSide?: 'additions' | 'deletions';
}

/** Imperative surface for hosts that need to drive the viewer. */
export interface DiffCodeViewHandle {
  /**
   * Drop the current line selection, in the viewer AND in our mirror of it.
   *
   * Needed because the selection is what the composer is written against:
   * abandoning the comment has to abandon the highlight too, or the diff is
   * left asserting that lines are selected when nothing is going to happen
   * to them.
   */
  clearSelection(): void;
  /**
   * Bring one file's header to the top of the scroll container.
   *
   * The list is virtualized, so a file that is not on screen has no element
   * to scroll to — only the viewer knows where it would be. Marking a file
   * active without this leaves the highlight somewhere the user cannot see.
   */
  scrollToItem(id: string): void;
}

export interface DiffCodeViewProps {
  sources: DiffSource[];
  ref?: React.Ref<DiffCodeViewHandle>;
  viewMode?: DiffViewMode;
  /** Enable click/drag line selection + the gutter "+" button. */
  enableSelection?: boolean;
  wrapLines?: boolean;
  className?: string;
  style?: React.CSSProperties;
  /** Fired on pointer-up with the final selected range (gutter "+" click). */
  onSelectRange?: (
    itemId: string,
    range: DiffLineRange,
    /**
     * Where the gutter button that triggered this sits, in viewport
     * coordinates. Hosts use it to float a composer beside the selection
     * instead of docking it somewhere the eye has to go looking for.
     */
    anchor: { x: number; y: number } | null,
  ) => void;
  /** Render an inline annotation (e.g. a review thread). */
  renderAnnotation?: (
    annotation: DiffAnnotation,
    item: { id: string; path: string; alias: string },
  ) => React.ReactNode;
  /**
   * Replaces the built-in file header entirely.
   *
   * Necessary rather than cosmetic: the built-in header shows counts the
   * viewer derives itself, which read 0/0 for files whose body streams in
   * after the initial render. Our counts come from `git diff --numstat` on
   * the server, so they are correct immediately and stay correct.
   */
  renderHeader?: (item: { id: string; path: string; alias: string }) => React.ReactNode;
  /**
   * Rendered height of `renderHeader`, in pixels.
   *
   * Load-bearing, not cosmetic. The virtualizer reserves space for every item
   * from an estimate before it measures, and its default assumes the
   * library's own header. A shorter custom header leaves the difference as
   * dead space above the first file — very visible when everything is
   * collapsed, since then the headers are ALL there is to show.
   */
  headerHeight?: number;
  emptyState?: React.ReactNode;
}

/** Build a CodeView item from a source, or null when it can't be rendered. */
function toItem(source: DiffSource): CodeViewItem<DiffAnnotationMeta> | null {
  const name = source.path;
  try {
    if (source.patch) {
      const parsed = parsePatchFiles(source.patch, source.cacheKey);
      const fileDiff = parsed[0]?.files[0];
      if (!fileDiff) return null;
      return {
        id: source.id,
        type: 'diff',
        fileDiff: source.lang ? setLanguageOverride(fileDiff, source.lang as never) : fileDiff,
        ...(source.annotations ? { annotations: source.annotations } : {}),
        ...(source.collapsed !== undefined ? { collapsed: source.collapsed } : {}),
      } as CodeViewItem<DiffAnnotationMeta>;
    }

    const oldFile = {
      name,
      contents: source.oldContents ?? '',
      ...(source.lang ? { lang: source.lang as never } : {}),
      ...(source.cacheKey ? { cacheKey: `${source.cacheKey}:old` } : {}),
    };
    const newFile = {
      name,
      contents: source.newContents ?? '',
      ...(source.lang ? { lang: source.lang as never } : {}),
      ...(source.cacheKey ? { cacheKey: `${source.cacheKey}:new` } : {}),
    };
    const fileDiff = parseDiffFromFile(oldFile, newFile);
    return {
      id: source.id,
      type: 'diff',
      fileDiff,
      ...(source.annotations ? { annotations: source.annotations } : {}),
      ...(source.collapsed !== undefined ? { collapsed: source.collapsed } : {}),
    } as CodeViewItem<DiffAnnotationMeta>;
  } catch {
    // A malformed patch must never take down the whole panel.
    return null;
  }
}

export function DiffCodeView({
  sources,
  ref,
  viewMode = 'unified',
  enableSelection = false,
  wrapLines = false,
  className,
  style,
  onSelectRange,
  renderAnnotation,
  renderHeader,
  headerHeight,
  emptyState,
}: DiffCodeViewProps) {
  const viewerRef = useRef<CodeViewHandle<DiffAnnotationMeta> | null>(null);
  const { resolvedTheme } = useTheme();
  const [selectedLines, setSelectedLines] = useState<CodeViewLineSelection | null>(null);
  /**
   * Viewport position of the most recent pointer press inside the viewer.
   *
   * The gutter-utility callback reports a line range but no coordinates, and
   * the button lives inside a shadow root we do not own, so its element is
   * not addressable from here. The pointer that pressed it is, and it is
   * within a few pixels of the button anyway.
   */
  const pointerRef = useRef<{ x: number; y: number } | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      clearSelection() {
        viewerRef.current?.clearSelectedLines();
        setSelectedLines(null);
      },
      scrollToItem(id: string) {
        // 'start' rather than 'nearest': the caller is saying "show me this
        // file", and an already-partly-visible file would otherwise not move
        // at all, leaving its diff below the fold.
        viewerRef.current?.scrollTo({ type: 'item', id, align: 'start' });
      },
    }),
    [],
  );

  /** Path/alias lookup for the render callbacks, keyed by item id. */
  const metaById = useMemo(() => {
    const map = new Map<string, { id: string; path: string; alias: string }>();
    for (const s of sources) map.set(s.id, { id: s.id, path: s.path, alias: s.alias });
    return map;
  }, [sources]);

  /**
   * The initial item list. Deliberately computed once — later updates go
   * through the imperative reconcile effect below.
   */
  const initialItems = useMemo(
    () => sources.map(toItem).filter((i): i is CodeViewItem<DiffAnnotationMeta> => i !== null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** Version counters so CodeView can do targeted updates. */
  const versions = useRef(new Map<string, number>());
  /** Last-rendered signature per item, to skip no-op updates. */
  const signatures = useRef(new Map<string, string>());
  /** Ids currently in the viewer, in order — drives removal detection. */
  const renderedOrder = useRef<string[]>(
    initialItems.map((i) => i.id),
  );

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const wanted = new Map(sources.map((s) => [s.id, s]));

    /**
     * Removal and reordering need a full reconcile — `addItems` only ever
     * appends, so without this a file that left the list (collapsed,
     * discarded, filtered out, or simply a different file selected in a
     * single-file viewer) would keep rendering forever.
     *
     * `setItems` is the library's reconciling path: it reuses the existing
     * instance for every id that survives, so this is not a remount.
     */
    const previousIds = renderedOrder.current;
    const needsReconcile =
      previousIds.length > 0 &&
      (previousIds.some((id) => !wanted.has(id)) ||
        sources.some((s, i) => previousIds[i] !== undefined && previousIds[i] !== s.id));

    const signatureOf = (source: DiffSource) =>
      // The signature must capture everything that affects the rendered
      // output. `cacheKey` alone is NOT enough: bodies stream in after the
      // summary, so a file would render as an empty diff forever if we only
      // watched the blob pair. Content lengths are a cheap, exact proxy for
      // "the body arrived / changed".
      [
        source.cacheKey ?? '',
        source.collapsed ? '1' : '0',
        source.patch ? `p${source.patch.length}` : 'v',
        `o${source.oldContents?.length ?? -1}`,
        `n${source.newContents?.length ?? -1}`,
        JSON.stringify(source.annotations ?? []),
      ].join('|');

    if (needsReconcile) {
      const items: CodeViewItem<DiffAnnotationMeta>[] = [];
      const nextOrder: string[] = [];
      for (const source of sources) {
        const item = toItem(source);
        if (!item) continue;
        const nextVersion = (versions.current.get(source.id) ?? 0) + 1;
        versions.current.set(source.id, nextVersion);
        signatures.current.set(source.id, signatureOf(source));
        items.push({ ...item, version: nextVersion } as CodeViewItem<DiffAnnotationMeta>);
        nextOrder.push(source.id);
      }
      viewer.getInstance()?.setItems(items);
      renderedOrder.current = nextOrder;
      for (const id of [...signatures.current.keys()]) {
        if (!wanted.has(id)) {
          signatures.current.delete(id);
          versions.current.delete(id);
        }
      }
      return;
    }

    const additions: CodeViewItem<DiffAnnotationMeta>[] = [];

    for (const source of sources) {
      const signature = signatureOf(source);

      const existing = viewer.getItem(source.id);
      if (!existing) {
        const item = toItem(source);
        if (item) {
          additions.push(item);
          signatures.current.set(source.id, signature);
          renderedOrder.current.push(source.id);
        }
        continue;
      }

      if (signatures.current.get(source.id) === signature) continue;

      const rebuilt = toItem(source);
      if (!rebuilt) continue;
      const nextVersion = (versions.current.get(source.id) ?? 0) + 1;
      versions.current.set(source.id, nextVersion);
      signatures.current.set(source.id, signature);
      viewer.updateItem({ ...rebuilt, version: nextVersion } as CodeViewItem<DiffAnnotationMeta>);
    }

    if (additions.length > 0) viewer.addItems(additions);
  }, [sources]);

  const handleSelectedLinesChange = useCallback((next: CodeViewLineSelection | null) => {
    setSelectedLines(next);
  }, []);

  /**
   * The gutter "+" button fires on pointer-up with the final range: a click
   * gives a single line, a drag gives the whole dragged span. The item id
   * comes from the current viewer-wide selection (selection is per-viewer,
   * so at most one item is selected at a time).
   */
  const handleGutterUtilityClick = useCallback(
    (range: SelectedLineRange) => {
      if (!onSelectRange) return;
      const itemId = selectedLines?.id ?? viewerRef.current?.getSelectedLines()?.id;
      if (!itemId) return;
      onSelectRange(
        itemId,
        {
          start: range.start,
          end: range.end,
          side: range.side as 'additions' | 'deletions',
          ...(range.endSide ? { endSide: range.endSide as 'additions' | 'deletions' } : {}),
        },
        pointerRef.current,
      );
    },
    [onSelectRange, selectedLines],
  );

  if (sources.length === 0) {
    return <>{emptyState ?? null}</>;
  }

  const view = (
    <CodeView<DiffAnnotationMeta>
      ref={viewerRef}
      initialItems={initialItems}
      className={className}
      style={{ ...diffHostStyle, ...style }}
      selectedLines={selectedLines}
      onSelectedLinesChange={handleSelectedLinesChange}
      options={{
        theme: DIFF_THEMES,
        themeType: resolvedTheme,
        unsafeCSS: DIFF_UNSAFE_CSS,
        diffStyle: viewMode === 'split' ? 'split' : 'unified',
        diffIndicators: 'bars',
        // Word-level inline highlighting inside changed lines. 'word-alt'
        // avoids the single-character speckling plain 'word' produces.
        lineDiffType: 'word-alt',
        overflow: wrapLines ? 'wrap' : 'scroll',
        // 'line-info-basic' rather than 'line-info': the latter has a known
        // WebKit 26 scroll-jump bug when combined with gutter utilities.
        hunkSeparators: 'line-info-basic',
        expansionLineCount: 100,
        collapsedContextThreshold: 2,
        stickyHeaders: true,
        enableLineSelection: enableSelection,
        enableGutterUtility: enableSelection,
        lineHoverHighlight: enableSelection ? 'number' : 'disabled',
        layout: { paddingTop: 8, paddingBottom: 24, gap: 10 },
        ...(headerHeight ? { itemMetrics: { diffHeaderHeight: headerHeight } } : {}),
        ...(onSelectRange ? { onGutterUtilityClick: handleGutterUtilityClick } : {}),
      }}
      {...(renderAnnotation
        ? {
            renderAnnotation: (annotation, item) => {
              const meta = metaById.get(item.id);
              if (!meta) return null;
              return renderAnnotation(annotation as unknown as DiffAnnotation, meta);
            },
          }
        : {})}
      {...(renderHeader
        ? {
            renderCustomHeader: (item) => {
              const meta = metaById.get(item.id);
              if (!meta) return null;
              return renderHeader(meta);
            },
          }
        : {})}
    />
  );

  // Selection needs no wrapper; only the composer-anchor capture does, and a
  // wrapper div would otherwise get between the caller's sizing and the
  // viewer's own scroll container.
  if (!onSelectRange) return view;

  return (
    <div
      style={{ display: 'contents' }}
      // Capture phase: the gutter button stops propagation of its own click,
      // and we need the coordinates regardless of what it does with the
      // event afterwards.
      onPointerDownCapture={(e) => {
        pointerRef.current = { x: e.clientX, y: e.clientY };
      }}
    >
      {view}
    </div>
  );
}
