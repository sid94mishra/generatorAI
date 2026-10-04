// ────────────────────────────────────────────────────────────────
// RailActivity (D-92; board EnhRailQuickAccess) — live items as status-tinted
// kind tiles in the rail while the Activity column is not docked (a narrow
// window, or the column closed): amber needs you, red failed, blue running,
// at most RAIL_TILE_LIMIT, then "+N" (opens the column). Hover or focus a
// tile for its popover (to the right of the rail); click / Enter toggles it
// and moves focus into its actions. Finished-OK items are not tiles.
// Replaces the rail's running counter: every running item is a tile.
// ────────────────────────────────────────────────────────────────

import { useId, useRef, type KeyboardEvent } from 'react';
import type { ActivityEntry } from '@generatorai/client-core';
import { useNow } from '@/lib/elapsed.js';
import { useActivityStore } from '@/stores/activityStore.js';
import { PopoverPopup, PopoverRoot } from '@/ui/primitives/Popover/Popover.js';
import { RailDivider, RailGroup, RailLiveOverflow, RailLiveTile } from '@/ui/shell/Rail/Rail.js';
import { ActivityDetails } from './ActivityDetails.js';
import { usePreview } from './ActivityItem.js';
import { kindIcon, tileLabel, tileTone } from './activityView.js';
import { useActivityModel } from './useActivityModel.js';

/** Tiles before the "+N" overflow (board: six fit a 760px window). */
export const RAIL_TILE_LIMIT = 6;

export function RailActivity() {
  const { model, modelLabel } = useActivityModel({ kind: 'all' });
  const now = useNow(Boolean(model && (model.header.running > 0 || model.header.needsYou > 0)), 1000);
  const open = useActivityStore((s) => s.setOpen);
  if (!model) return null;
  const live = [...model.groups.needs_you, ...model.groups.failed, ...model.groups.running];
  if (live.length === 0) return null;
  const shown = live.slice(0, RAIL_TILE_LIMIT);
  const overflow = live.length - shown.length;
  return (
    <>
      <RailDivider />
      <RailGroup role="list" aria-label="Live activity" data-testid="rail-activity">
        {shown.map((entry) => (
          <div role="listitem" key={entry.key}>
            <RailTile entry={entry} now={now} modelLabel={modelLabel} />
          </div>
        ))}
        {overflow > 0 ? <RailLiveOverflow count={overflow} data-testid="rail-activity-more" onClick={() => open(true)} /> : null}
      </RailGroup>
    </>
  );
}

function RailTile({ entry, now, modelLabel }: { entry: ActivityEntry; now: number; modelLabel: (id: string) => string }) {
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
        if (!next) preview.close();
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
          finalFocus={tileRef}
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
