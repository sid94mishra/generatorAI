// ────────────────────────────────────────────────────────────────
// FileDiff — one file's unified (or split) diff, virtualised per line.
//
// Fixes D13. The old renderer put every line inside a `width: 760` box and
// clipped whatever did not fit. Now:
//
//   * rows are a LegendList with recycling on and a FIXED height per line at
//     the current font size (wrap off), so a 5,000-line refactor scrolls at
//     60fps and the list never measures;
//   * wrap on → rows grow, the list measures (still virtualised);
//   * wrap off → the whole surface scrolls sideways as ONE plane whose width
//     is computed from the longest line, so nothing is clipped and the
//     gutter cannot drift from its code;
//   * hunk headers stick to the top and fold on tap;
//   * pinch → font size 10–18, persisted;
//   * ≥700pt wide → split view (old | new), the way web does on a desktop.
//
// `embedded` is the inline form under a file row in the list: no nested
// virtual list (it cannot measure itself inside another), rows rendered
// directly and capped, with a pointer to the full-screen view.
//
// The query key carries the blob pair, not just the path: with a path-only
// key and any staleTime, editing a file leaves the previous diff on screen
// because the key never changed.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, View, useWindowDimensions, type ScrollViewProps } from 'react-native';
import Animated from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { usePagerInnerScroll } from '../ui/Pager';
import { LegendList, type LegendListRef } from '@legendapp/list/react-native';
import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { Copy, MessageSquarePlus } from 'lucide-react-native';
import { queryKeys, type DiffRow, type ReviewThread } from '@generatorai/client-core';

import { useApi } from '../../api/useApi';
import { useTheme } from '../../theme/ThemeProvider';
import { useContextMenu, type ContextMenuItem } from '../ui/ContextMenu';
import { EmptyState, ErrorState, LoadingState } from '../ui/States';
import { SkeletonList } from '../ui/Skeleton';
import { useToast } from '../ui/Toast';
import { resolveLanguage, type Language } from '../markdown/highlight';
import { DiffLine } from './DiffLine';
import { HunkHeader } from './HunkHeader';
import { setDiffFontSize, useDiffPrefs } from './diffPrefs';
import {
  anchorText,
  buildRows,
  clampFont,
  contentWidthFor,
  gutterWidthFor,
  headerHeightFor,
  hunkHeaderIndices,
  languageForPath,
  lineHeightFor,
  longestLine,
  maxLineNumber,
  parsePatch,
  prefersSplit,
  rowHeightFor,
  toSplitRows,
  type DiffRowModel,
  type DiffSide,
  type SplitDiffRowModel,
} from './diffModel';

/** Rows an embedded (inline) diff renders before deferring to full screen. */
export const EMBEDDED_ROW_LIMIT = 300;

/** Sticky hunk headers need an Animated scroll host (LegendList requirement). Hoisted so it is stable. */
const renderAnimatedScroll = (props: ScrollViewProps): React.ReactElement<ScrollViewProps> =>
  (<Animated.ScrollView {...props} />) as React.ReactElement<ScrollViewProps>;

export interface CommentRequest {
  side: DiffSide;
  startLine: number;
  endLine: number;
  anchorText: string;
}

export interface FileDiffProps {
  workspaceId: string;
  path: string;
  alias?: string;
  oldBlob?: string;
  newBlob?: string;
  /** Revision selector for the base side. Defaults to the session baseline. */
  base?: string;
  /** Server language hint, when the summary carried one. */
  lang?: string | null;
  /** Inline under a file row: no nested virtual list, capped rows. */
  embedded?: boolean;
  /** Open review threads on this file (already filtered by path). */
  threads?: readonly ReviewThread[];
  /** Long-press → Comment. Absent when the device cannot write reviews. */
  onComment?: (request: CommentRequest) => void;
  /** Tap the gutter marker. */
  onOpenThreads?: (side: DiffSide, line: number) => void;
  /** Embedded only: the cap was hit. */
  onOpenFull?: () => void;
  /** Explains why commenting is unavailable, shown in the long-press menu. */
  commentDisabledReason?: string | null;
}

export function FileDiff({
  workspaceId,
  path,
  alias,
  oldBlob,
  newBlob,
  base = 'baseline',
  lang,
  embedded = false,
  threads,
  onComment,
  onOpenThreads,
  onOpenFull,
  commentDisabledReason,
}: FileDiffProps): React.ReactElement {
  const api = useApi();
  const { colors } = useTheme();
  const toast = useToast();
  const menu = useContextMenu();
  const { width: viewport } = useWindowDimensions();
  const { wrap, fontSize, layout } = useDiffPrefs();
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(() => new Set());
  const listRef = useRef<LegendListRef>(null);

  const patch = useQuery({
    queryKey: [...queryKeys.changeFile(workspaceId, path, oldBlob, newBlob), base, alias ?? '.'],
    queryFn: () =>
      api.workspaces.filePatch(workspaceId, {
        path,
        base,
        head: 'working',
        ...(alias ? { alias } : {}),
        ...(oldBlob ? { oldBlob } : {}),
        ...(newBlob ? { newBlob } : {}),
      }),
    // A diff for a specific blob pair is immutable; only the working side moves.
    staleTime: newBlob ? Infinity : 10_000,
  });

  const parsed = useMemo(() => (patch.data?.patch ? parsePatch(patch.data.patch) : null), [patch.data]);
  const language = useMemo<Language | null>(() => resolveLanguage(languageForPath(path, lang)), [path, lang]);

  const rows = useMemo<DiffRowModel[]>(
    () => (parsed ? buildRows(parsed, { collapsed, truncated: patch.data?.truncated ?? false }) : []),
    [parsed, collapsed, patch.data?.truncated],
  );

  const split = !embedded && prefersSplit(viewport, layout);
  const splitRows = useMemo<SplitDiffRowModel[]>(() => (split ? toSplitRows(rows) : []), [split, rows]);

  const gutter = useMemo(() => gutterWidthFor(parsed ? maxLineNumber(parsed) : 1, fontSize), [parsed, fontSize]);
  const longest = useMemo(() => (parsed ? longestLine(parsed) : 0), [parsed]);
  // Inside the session pager (Changes pane): a sideways drag on a wide diff
  // scrolls the diff instead of switching panes. Inert elsewhere.
  const inner = usePagerInnerScroll();
  const contentWidth = useMemo(
    () => contentWidthFor({ longest, gutter: split ? gutter * 2 : gutter, fontSize, viewport }),
    [longest, gutter, split, fontSize, viewport],
  );

  /** Open thread count per `side:line`, anchored on the thread's last line. */
  const threadCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of threads ?? []) {
      if (t.status === 'resolved' || t.status === 'outdated') continue;
      const key = `${t.side}:${t.endLine}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [threads]);

  const toggleHunk = useCallback((hunkIndex: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(hunkIndex)) next.add(hunkIndex);
      return next;
    });
  }, []);

  const longPress = useCallback(
    (row: DiffRow) => {
      const side: DiffSide = row.kind === 'del' ? 'deletions' : 'additions';
      const line = row.kind === 'del' ? (row.oldNumber ?? 0) : (row.newNumber ?? row.oldNumber ?? 0);
      const items: ContextMenuItem[] = [];
      if (onComment && parsed) {
        items.push({
          label: 'Comment on this line',
          icon: <MessageSquarePlus size={18} color={colors.foreground} />,
          onPress: () =>
            onComment({ side, startLine: line, endLine: line, anchorText: anchorText(parsed, side, line, line) }),
        });
      } else if (commentDisabledReason) {
        items.push({
          label: 'Comment on this line',
          detail: commentDisabledReason,
          disabled: true,
          icon: <MessageSquarePlus size={18} color={colors['muted-foreground']} />,
          onPress: () => {},
        });
      }
      items.push({
        label: 'Copy line',
        icon: <Copy size={18} color={colors.foreground} />,
        onPress: () => {
          void Clipboard.setStringAsync(row.content);
          toast({ message: 'Line copied', tone: 'success' });
        },
      });
      menu.open(items, { title: `Line ${line}` });
    },
    [onComment, commentDisabledReason, parsed, colors, menu, toast],
  );

  // ── Pinch → font size ──────────────────────────────────────────
  const fontAtPinchStart = useRef(fontSize);
  useEffect(() => {
    fontAtPinchStart.current = fontSize;
  }, [fontSize]);
  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .runOnJS(true)
        .onEnd((event) => {
          setDiffFontSize(clampFont(fontAtPinchStart.current * event.scale));
        }),
    [],
  );

  const rowHeight = rowHeightFor(fontSize);
  const headerHeight = headerHeightFor(fontSize);

  const renderUnified = useCallback(
    (item: DiffRowModel): React.ReactElement => {
      if (item.type === 'hunk') return <HunkHeader row={item} fontSize={fontSize} onToggle={toggleHunk} />;
      if (item.type === 'notice') return <Notice text={item.text} tone={item.tone} fontSize={fontSize} />;
      return (
        <DiffLine
          row={item.row}
          fontSize={fontSize}
          wrap={wrap}
          gutter={gutter}
          language={language}
          threadCount={threadCounts.get(`${item.anchor.side}:${item.anchor.line}`) ?? 0}
          onLongPress={longPress}
          {...(onOpenThreads ? { onPressThreads: onOpenThreads } : {})}
        />
      );
    },
    [fontSize, wrap, gutter, language, threadCounts, longPress, onOpenThreads, toggleHunk],
  );

  const renderSplit = useCallback(
    (item: SplitDiffRowModel): React.ReactElement => {
      if (item.type === 'hunk') return <HunkHeader row={item} fontSize={fontSize} onToggle={toggleHunk} />;
      if (item.type === 'notice') return <Notice text={item.text} tone={item.tone} fontSize={fontSize} />;
      return (
        <View style={{ flexDirection: 'row', minHeight: rowHeight }}>
          <View style={{ flex: 1, borderRightWidth: 1, borderRightColor: colors['border-muted'] }}>
            {item.left ? (
              <DiffLine
                row={item.left}
                fontSize={fontSize}
                wrap={wrap}
                gutter={gutter}
                language={language}
                threadCount={
                  item.left.kind === 'del'
                    ? (threadCounts.get(`deletions:${item.left.oldNumber ?? 0}`) ?? 0)
                    : 0
                }
                onLongPress={longPress}
                {...(onOpenThreads ? { onPressThreads: onOpenThreads } : {})}
              />
            ) : (
              <View style={{ height: rowHeight, backgroundColor: colors.subtle }} />
            )}
          </View>
          <View style={{ flex: 1 }}>
            {item.right ? (
              <DiffLine
                row={item.right}
                fontSize={fontSize}
                wrap={wrap}
                gutter={gutter}
                language={language}
                threadCount={threadCounts.get(`additions:${item.right.newNumber ?? 0}`) ?? 0}
                onLongPress={longPress}
                {...(onOpenThreads ? { onPressThreads: onOpenThreads } : {})}
              />
            ) : (
              <View style={{ height: rowHeight, backgroundColor: colors.subtle }} />
            )}
          </View>
        </View>
      );
    },
    [fontSize, wrap, gutter, language, threadCounts, longPress, onOpenThreads, toggleHunk, rowHeight, colors],
  );

  // ── States ─────────────────────────────────────────────────────
  if (patch.isLoading) {
    return embedded ? (
      <View className="px-3 py-2">
        <SkeletonList rows={3} />
      </View>
    ) : (
      <LoadingState label="Loading diff…" />
    );
  }
  if (patch.isError) {
    return (
      <View className={embedded ? 'px-3 py-2' : 'flex-1'}>
        <ErrorState message="Could not load this diff." onRetry={() => void patch.refetch()} />
      </View>
    );
  }
  if (!parsed || rows.length === 0) {
    return embedded ? (
      <Text className="px-3 py-2 text-xs text-muted-foreground">No textual diff for this file.</Text>
    ) : (
      <EmptyState title="Nothing to show" message="This file has no textual diff." />
    );
  }

  // ── Embedded: direct rows, capped ──────────────────────────────
  if (embedded) {
    const shown = rows.slice(0, EMBEDDED_ROW_LIMIT);
    const body = (
      <View style={{ width: wrap ? undefined : contentWidth }}>
        {shown.map((item) => (
          <React.Fragment key={item.key}>{renderUnified(item)}</React.Fragment>
        ))}
      </View>
    );
    return (
      <View className="border-t border-border-muted bg-canvas-bg">
        {wrap ? (
          body
        ) : (
          <GestureDetector gesture={inner.gesture}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              nestedScrollEnabled
              onLayout={inner.onLayout}
              onContentSizeChange={inner.onContentSizeChange}
            >
              {body}
            </ScrollView>
          </GestureDetector>
        )}
        {rows.length > shown.length ? (
          <Text
            onPress={onOpenFull}
            accessibilityRole={onOpenFull ? 'button' : undefined}
            className="px-3 py-1.5 text-xs text-primary"
          >
            {rows.length - shown.length} more lines — open full screen to read the rest.
          </Text>
        ) : null}
      </View>
    );
  }

  // ── Full: virtualised ──────────────────────────────────────────
  const list = split ? (
    <LegendList
      ref={listRef}
      data={splitRows}
      keyExtractor={(item) => item.key}
      recycleItems
      estimatedItemSize={rowHeight}
      getFixedItemSize={(item) => (item.type === 'hunk' ? headerHeight : item.type === 'notice' || wrap ? undefined : rowHeight)}
      stickyHeaderIndices={hunkHeaderIndices(splitRows)}
      renderScrollComponent={renderAnimatedScroll}
      extraData={`${fontSize}|${wrap}|${threadCounts.size}|${language}`}
      contentContainerStyle={{ paddingBottom: 40 }}
      renderItem={({ item }) => renderSplit(item)}
    />
  ) : (
    <LegendList
      ref={listRef}
      data={rows}
      keyExtractor={(item) => item.key}
      recycleItems
      estimatedItemSize={rowHeight}
      getFixedItemSize={(item) => (item.type === 'hunk' ? headerHeight : item.type === 'notice' || wrap ? undefined : rowHeight)}
      stickyHeaderIndices={hunkHeaderIndices(rows)}
      renderScrollComponent={renderAnimatedScroll}
      extraData={`${fontSize}|${wrap}|${threadCounts.size}|${language}`}
      contentContainerStyle={{ paddingBottom: 40 }}
      renderItem={({ item }) => renderUnified(item)}
    />
  );

  return (
    <GestureDetector gesture={pinch}>
      <View className="flex-1 bg-canvas-bg">
        {wrap ? (
          list
        ) : (
          // Unwrapped, the whole list scrolls sideways as ONE surface (not
          // per row) so the gutter cannot drift out of alignment with its code.
          <GestureDetector gesture={inner.gesture}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator
              contentContainerStyle={{ flexGrow: 1 }}
              directionalLockEnabled
              onLayout={inner.onLayout}
              onContentSizeChange={inner.onContentSizeChange}
            >
              <View style={{ width: contentWidth, flex: 1 }}>{list}</View>
            </ScrollView>
          </GestureDetector>
        )}
      </View>
    </GestureDetector>
  );
}

function Notice({ text, tone, fontSize }: { text: string; tone: 'warning' | 'muted'; fontSize: number }): React.ReactElement {
  return (
    <View className={`px-3 py-1.5 ${tone === 'warning' ? 'bg-warning-muted' : 'bg-subtle'}`}>
      <Text className="text-foreground" style={{ fontSize, lineHeight: lineHeightFor(fontSize) }}>
        {text}
      </Text>
    </View>
  );
}
