// ────────────────────────────────────────────────────────────────
// RailActivity (D-92; board EnhRailQuickAccess) — live items as status-tinted
// kind tiles in the rail while the Activity column is not docked (a narrow
// window, or the column closed): amber needs you, red failed, blue running,
// at most RAIL_TILE_LIMIT, then "+N" (opens the column). Hover or focus a
// tile for its popover (to the right of the rail); click / Enter toggles it
// and moves focus into its actions. Finished-OK items are not tiles.
// Replaces the rail's running counter: every running item is a tile.
// ────────────────────────────────────────────────────────────────

import { useCallback, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { ActivityEntry } from '@generatorai/client-core';
import { useNow } from '@/lib/elapsed.js';
import { useActivityStore } from '@/stores/activityStore.js';
import { PopoverPopup, PopoverRoot } from '@/ui/primitives/Popover/Popover.js';
import { RailDivider, RailGroup, RailLiveOverflow, RailLiveTile } from '@/ui/shell/Rail/Rail.js';
import { ActivityDetails } from './ActivityDetails.js';
import { usePreview } from './ActivityItem.js';
import { kindIcon, tileLabel, tileTone } from './activityView.js';
import { useActivityModel } from './useActivityModel.js';

/** Most tiles before the "+N" overflow (board EnhRailQuickAccess). */
export const RAIL_TILE_LIMIT = 6;
/** A tile (34) + the group gap (2); the divider and the "+N" button. */
const TILE_PX = 36;
const DIVIDER_PX = 13;
const OVERFLOW_PX = 26;

/** How many tiles fit the space the rail has left (it takes the spacer's place), never more than the limit. */
export function railTileCapacity(heightPx: number, items: number): number {
  const room = heightPx - DIVIDER_PX;
  if (items * TILE_PX <= room) return Math.min(items, RAIL_TILE_LIMIT);
  return Math.max(0, Math.min(RAIL_TILE_LIMIT, Math.floor((room - OVERFLOW_PX) / TILE_PX)));
}

/**
 * Fills the rail's free space (in place of RailSpacer) and shows as many
 * tiles as fit it — the rest are "+N", which opens the column.
 */
export function RailActivity() {
  const { model, modelLabel } = useActivityModel({ kind: 'all' });
  const now = useNow(Boolean(model && (model.header.running > 0 || model.header.needsYou > 0)), 1000);
  const open = useActivityStore((s) => s.setOpen);
  const [height, setHeight] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const measure = useCallback((node: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node || typeof ResizeObserver === 'undefined') return;
    setHeight(node.clientHeight);
    observer.current = new ResizeObserver(([entry]) => entry && setHeight(entry.contentRect.height));
    observer.current.observe(node);
  }, []);
  const live = model ? [...model.groups.needs_you, ...model.groups.failed, ...model.groups.running] : [];
  const shown = live.slice(0, railTileCapacity(height, live.length));
  const overflow = live.length - shown.length;
  return (
    <div
      ref={measure}
      className="flex min-h-2 w-full flex-1 flex-col items-center overflow-hidden"
      data-testid="rail-activity-area"
    >
      {live.length === 0 ? null : (
        <>
          <RailDivider />
          <RailGroup role="list" aria-label="Live activity" data-testid="rail-activity">
            {shown.map((entry) => (
              <div role="listitem" key={entry.key}>
                <RailTile entry={entry} now={now} modelLabel={modelLabel} />
              </div>
            ))}
            {overflow > 0 ? (
              <RailLiveOverflow count={overflow} data-testid="rail-activity-more" onClick={() => open(true)} />
            ) : null}
          </RailGroup>
        </>
      )}
    </div>
  );
}

function RailTile({
  entry,
  now,
  modelLabel,
}: {
  entry: ActivityEntry;
  now: number;
  modelLabel: (id: string) => string;
}) {
  const preview = usePreview(`rail:${entry.key}`);
  const tileRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const focusIntoPopup = () => {
    preview.openNow();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => popupRef.current?.querySelector<HTMLElement>('button, a[href]')?.focus());
    });
  };

  return (
    <PopoverRoot
      open={preview.open}
      onOpenChange={(next) => {
        if (next) return;
        const inside = popupRef.current?.contains(document.activeElement) ?? false;
        preview.close();
        if (inside) tileRef.current?.focus();
      }}
    >
      <RailLiveTile
        ref={tileRef}
        data-testid="rail-activity-tile"
        data-group={entry.group}
        icon={kindIcon(entry)}
        tone={tileTone(entry)}
        label={tileLabel(entry)}
        count={entry.asks.length}
        active={preview.open}
        aria-expanded={preview.open}
        aria-haspopup="dialog"
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse') preview.openSoon();
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') preview.closeSoon();
        }}
        onFocus={(e) => {
          if (e.currentTarget.matches(':focus-visible')) preview.openSoon();
        }}
        onBlur={(e) => {
          if (e.relatedTarget instanceof Node && popupRef.current?.contains(e.relatedTarget)) return;
          preview.closeSoon();
        }}
        onClick={() => (preview.open ? preview.close() : focusIntoPopup())}
        onKeyDown={(e: KeyboardEvent<HTMLButtonElement>) => {
          if (e.key === 'ArrowRight') {
            e.preventDefault();
            focusIntoPopup();
          }
        }}
      />
      {preview.open ? (
        <PopoverPopup
          ref={popupRef}
          anchor={tileRef}
          side="right"
          align="start"
          sideOffset={10}
          collisionPadding={8}
          initialFocus={false}
          finalFocus={false}
          aria-labelledby={titleId}
          className="w-aside overflow-hidden rounded-panel"
          onPointerEnter={() => preview.cancel()}
          onPointerLeave={(e) => {
            if (e.pointerType === 'mouse') preview.closeSoon();
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') {
              e.preventDefault();
              preview.close();
              tileRef.current?.focus();
            }
          }}
        >
          <ActivityDetails entry={entry} now={now} modelLabel={modelLabel} titleId={titleId} onDone={preview.close} />
        </PopoverPopup>
      ) : null}
    </PopoverRoot>
  );
}
