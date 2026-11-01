// ────────────────────────────────────────────────────────────────
// ConnectedActivityColumn — the Activity column wired (D-92).
//
// Docked between the sidebar/rail and the main card while the window is at
// least `CHROME.railBreakpoint` wide AND the card keeps SHELL.activityColumn
// .minMain px beside it — or, while the page's side pane is open, the width
// the page needs to keep its main column beside that pane
// (DOCK_MIN_TWO_COLUMN_HOST: below it the pane covers the chat) —
// (`activityPlacement`); otherwise, when open, it floats
// over the card as an overlay (closes on Esc, a click outside, or opening a
// card). Width is persisted and resized from its right edge (docked only).
// Closing returns focus to the toggle that opened it (sidebar or rail).
// ────────────────────────────────────────────────────────────────

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { CHROME, SHELL } from '@generatorai/design-tokens';
import { useActivityPanel } from '@/features/activity/index.js';
import { GAI_OVERLAY_SELECTOR } from '@/ui/lib/overlay.js';
import { useActivityStore } from '@/stores/activityStore.js';
import { DOCK_MIN_TWO_COLUMN_HOST } from '@/blocks/dock/Dock.js';
import { ActivityColumn } from '@/ui/shell/ActivityColumn/ActivityColumn.js';

const GEOMETRY = SHELL.activityColumn;

/** Pure rule, exported for tests: does the column dock, given the window and what sits beside it. */
export function activityPlacement(input: {
  windowWidth: number;
  sidebarWidth: number;
  columnWidth: number;
  /** The page's side pane is open: the card must keep room for its main column AND the pane. */
  besideDock?: boolean;
}): 'docked' | 'overlay' {
  if (input.windowWidth < CHROME.railBreakpoint) return 'overlay';
  // The pane measures the card's inside: the card's own margin (and border) come off the window's room first.
  const minMain = input.besideDock ? Math.max(GEOMETRY.minMain, DOCK_MIN_TWO_COLUMN_HOST + 2 * CHROME.cardMargin) : GEOMETRY.minMain;
  return input.windowWidth - input.sidebarWidth - input.columnWidth >= minMain ? 'docked' : 'overlay';
}

function subscribeResize(onChange: () => void): () => void {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
}

/** Where the column goes, re-rendering only when that changes (not on every resize step). */
export function useActivityPlacement(sidebarWidth: number, columnWidth: number, besideDock = false): 'docked' | 'overlay' {
  return useSyncExternalStore(
    subscribeResize,
    () => activityPlacement({ windowWidth: window.innerWidth, sidebarWidth, columnWidth, besideDock }),
    () => 'docked',
  );
}

/** Moves focus back to the visible activity toggle (sidebar header or rail). */
export function focusActivityToggle(): void {
  document.querySelector<HTMLElement>('[data-activity-toggle]')?.focus();
}

export function ConnectedActivityColumn({ placement, sidebarWidth }: { placement: 'docked' | 'overlay'; sidebarWidth: number }) {
  const width = useActivityStore((s) => s.width);
  const setWidth = useActivityStore((s) => s.setWidth);
  const setOpen = useActivityStore((s) => s.setOpen);
  const overlay = placement === 'overlay';
  const ref = useRef<HTMLElement>(null);

  const close = () => {
    setOpen(false);
    requestAnimationFrame(focusActivityToggle);
  };
  const { header, tabs, body, onPanelKeyDown } = useActivityPanel({
    onClose: close,
    ...(overlay ? { onNavigate: () => setOpen(false) } : {}),
  });

  // Overlay: a press outside it (and outside any popover / menu it opened) closes it.
  useEffect(() => {
    if (!overlay) return undefined;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (!target || ref.current?.contains(target) || target.closest(GAI_OVERLAY_SELECTOR) || target.closest('[data-activity-toggle]')) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [overlay, setOpen]);

  return (
    <ActivityColumn
      ref={ref}
      variant={placement}
      width={overlay ? GEOMETRY.width : width}
      minWidth={GEOMETRY.min}
      maxWidth={GEOMETRY.max}
      defaultWidth={GEOMETRY.width}
      offsetLeft={sidebarWidth}
      // Never wider than leaves the card its minimum: the column stays docked while it is dragged.
      {...(overlay ? {} : { onWidthChange: (w: number) => setWidth(Math.min(w, window.innerWidth - sidebarWidth - GEOMETRY.minMain)) })}
      header={header}
      toolbar={tabs}
      onKeyDown={onPanelKeyDown}
    >
      {body}
    </ActivityColumn>
  );
}
