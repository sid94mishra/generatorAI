// ────────────────────────────────────────────────────────────────
// B-24 TranscriptView — the transcript column (max-width 760, pad 20/28):
// load-earlier, the turns, the empty state, a "Jump to latest" pill, the view
// mode segment (G-06) and transcript find.
//
// Default: every turn stays in the DOM (find-in-page, selection, the a11y
// tree), long transcripts contain each turn with `content-visibility: auto`,
// and the D-33 fallback `collapseBeyond` starts finished turns collapsed.
//
// `virtualize="auto"` is the D-33 spike (NO-GO for now — see
// docs/redesign/reviews/P4-07-virtualization-spike.md): TURN-granularity
// TanStack Virtual 3.14 with measured heights, `anchorTo: 'end'` +
// follow-on-append for streaming, above-the-fold size compensation, and an
// app-level find (Mod+F / the desktop FindBar via `transcriptFindStore`) that
// searches the whole model because off-screen turns are not rendered.
//
// Stick-to-bottom and "Jump to latest" belong to the host (it owns the scroll
// ref and knows when content grows); this view only renders them.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { TranscriptTurn as TurnModel } from '@generatorai/client-core';
import type { ChatMessage } from '@generatorai/shared';
import { TRANSCRIPT_COPY, TRANSCRIPT_VIEW_MODES, type TranscriptViewMode } from '@generatorai/shared/ui-contract';
import { cn } from '@/ui/lib/cn.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { SegmentedControl } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { FindWidget } from '@/ui/patterns/FindWidget/FindWidget.js';
import { useTranscriptFindStore } from '@/stores/transcriptFindStore.js';
import { TranscriptTurn } from '../TranscriptTurn/TranscriptTurn.js';
import { useTranscriptFind } from './useTranscriptFind.js';

/** Virtualize above this many turns (D-33 spike decision). */
export const VIRTUALIZE_MIN_TURNS = 40;

/** A turn the virtualizer has not measured yet is assumed this tall (px). */
const ESTIMATED_TURN_HEIGHT = 320;

export interface TranscriptViewProps {
  turns: readonly TurnModel[];
  /** The host's scroll container ref (it owns stick-to-bottom). */
  scrollRef: RefObject<HTMLDivElement | null>;
  agentName: string;
  avatar?: 'initials' | 'bot';
  /** Messages are loading: show `loadingFallback` above the turns. */
  loading?: boolean;
  loadingFallback?: ReactNode;
  /** Older messages exist: offer "Load earlier messages". */
  hasMore?: boolean;
  onLoadEarlier?: () => void;
  /** Rendered after the turns when there are none. */
  empty?: ReactNode;
  showJumpToLatest?: boolean;
  onJumpToLatest?: () => void;
  viewMode: TranscriptViewMode;
  onViewModeChange?: (mode: TranscriptViewMode) => void;
  renderUserActions?: ((message: ChatMessage) => ReactNode) | undefined;
  renderResponseActions?: ((message: ChatMessage, engaged: boolean) => ReactNode) | undefined;
  renderLive?: (() => ReactNode) | undefined;
  /** `never` (default) renders every turn; `auto` virtualizes long transcripts (the D-33 spike). */
  virtualize?: 'auto' | 'never';
  /** D-33 fallback: collapse finished turns before the last N (0 = off). */
  collapseBeyond?: number;
  className?: string;
}

const VIEW_ITEMS = TRANSCRIPT_VIEW_MODES.map((value) => ({ value, label: TRANSCRIPT_COPY.viewModes[value] }));

export function TranscriptView({
  turns,
  scrollRef,
  agentName,
  avatar = 'initials',
  loading = false,
  loadingFallback,
  hasMore = false,
  onLoadEarlier,
  empty,
  showJumpToLatest = false,
  onJumpToLatest,
  viewMode,
  onViewModeChange,
  renderUserActions,
  renderResponseActions,
  renderLive,
  virtualize = 'never',
  collapseBeyond = 0,
  className,
}: TranscriptViewProps) {
  // Virtualize only when the scroller has real layout (a jsdom test has none).
  const [measurable, setMeasurable] = useState(false);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const check = () => setMeasurable(el.clientHeight > 0 && el.getBoundingClientRect().height > 0);
    check();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollRef]);
  const virtual = virtualize === 'auto' && measurable && turns.length > VIRTUALIZE_MIN_TURNS;

  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  // The list's offset in the scroller (the load-earlier row sits above it).
  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-measured every commit; the setter bails when unchanged
  useLayoutEffect(() => {
    if (!virtual) return;
    const next = listRef.current?.offsetTop ?? 0;
    setScrollMargin((prev) => (prev === next ? prev : next));
  });

  const virtualizer = useVirtualizer({
    count: turns.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_TURN_HEIGHT,
    getItemKey: (i) => turns[i]?.key ?? i,
    overscan: 3,
    scrollMargin,
    anchorTo: 'end',
    followOnAppend: true,
    scrollEndThreshold: 80,
    enabled: virtual,
  });

  const find = useTranscriptFind(turns, {
    scrollToTurn: (index) => {
      if (virtual) virtualizer.scrollToIndex(index, { align: 'center' });
      else scrollRef.current?.querySelector(`[data-gai-turn="${CSS.escape(turns[index]?.key ?? '')}"]`)?.scrollIntoView({ block: 'center' });
    },
    turnElement: (index) =>
      scrollRef.current?.querySelector<HTMLElement>(`[data-gai-turn="${CSS.escape(turns[index]?.key ?? '')}"]`) ?? null,
    scrollElement: () => scrollRef.current,
  });

  // While virtualized, off-screen turns are not in the DOM: take over find.
  const openFind = find.open;
  const register = useTranscriptFindStore((s) => s.register);
  useEffect(() => {
    if (!virtual) return undefined;
    const unregister = register(openFind);
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        openFind();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      unregister();
      window.removeEventListener('keydown', onKey);
    };
  }, [virtual, register, openFind]);

  const findInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (find.isOpen) findInputRef.current?.focus();
  }, [find.isOpen]);

  const renderTurn = useCallback(
    (turn: TurnModel, index: number) => (
      <TranscriptTurn
        turn={turn}
        agentName={agentName}
        avatar={avatar}
        defaultCollapsed={collapseBeyond > 0 && !turn.live && index < turns.length - collapseBeyond}
        renderUserActions={renderUserActions}
        renderResponseActions={renderResponseActions}
        renderLive={turn.live ? renderLive : undefined}
      />
    ),
    [agentName, avatar, collapseBeyond, turns.length, renderUserActions, renderResponseActions, renderLive],
  );

  return (
    <div className={cn('relative flex min-h-0 flex-1 flex-col overflow-hidden', className)} data-testid="transcript-view">
      <div ref={scrollRef} className="relative flex-1 overflow-y-auto" data-testid="transcript-scroll">
        <div className="mx-auto flex w-full max-w-190 flex-col px-7 pb-5">
          {onViewModeChange ? (
            <div className="sticky top-0 z-sticky flex justify-end bg-surface py-2">
              <SegmentedControl<TranscriptViewMode>
                label={TRANSCRIPT_COPY.viewMode}
                value={viewMode}
                onValueChange={onViewModeChange}
                items={VIEW_ITEMS}
                data-testid="transcript-view-mode"
              />
            </div>
          ) : (
            <div className="pt-5" />
          )}
          {loading ? loadingFallback : null}
          {hasMore && !loading && onLoadEarlier ? (
            <div className="mb-4 flex justify-center">
              <Button size="sm" onClick={onLoadEarlier}>
                {TRANSCRIPT_COPY.loadEarlier}
              </Button>
            </div>
          ) : null}
          {virtual ? (
            <div ref={listRef} className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map((item) => {
                const turn = turns[item.index];
                if (!turn) return null;
                return (
                  <div
                    key={item.key}
                    data-index={item.index}
                    ref={virtualizer.measureElement}
                    className="absolute inset-x-0 top-0 pb-6"
                    style={{ transform: `translateY(${item.start - scrollMargin}px)` }}
                  >
                    {renderTurn(turn, item.index)}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {turns.map((turn, index) => (
                <div key={turn.key} className={turns.length > VIRTUALIZE_MIN_TURNS ? 'contain-turn' : undefined}>
                  {renderTurn(turn, index)}
                </div>
              ))}
            </div>
          )}
          {turns.length === 0 && !loading ? empty : null}
        </div>
      </div>
      {showJumpToLatest && onJumpToLatest ? (
        <Button
          icon="chevron-down"
          size="sm"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-pop"
          onClick={onJumpToLatest}
        >
          {TRANSCRIPT_COPY.jumpToLatest}
        </Button>
      ) : null}
      {find.isOpen ? (
        <FindWidget
          className="absolute top-2 right-4 z-popover"
          label={TRANSCRIPT_COPY.find}
          placeholder={TRANSCRIPT_COPY.find}
          query={find.query}
          onQueryChange={find.setQuery}
          {...(find.matches ? { matches: find.matches } : {})}
          onNext={find.next}
          onPrev={find.prev}
          onClose={find.close}
          inputRef={findInputRef}
          data-testid="transcript-find"
        />
      ) : null}
    </div>
  );
}
