// ────────────────────────────────────────────────────────────────
// C-20 SplitPane (03 §3 C-20; D-27, D-38; react-resizable-panels 4).
//
// A resizable two-pane split: `main` (flexible) + `side` (the dock, default
// 480 / 440 on runs), 1px `line-soft` separator with an invisible 8px hit
// area and `cursor-col-resize` (vertical splits get `cursor-row-resize`).
// react-resizable-panels 4's `Separator` already renders `role="separator"`
// with the required WAI-ARIA value attributes and is keyboard-operable
// (arrow keys, Home/End) out of the box — this file only styles it.
//
// `collapsed` collapses the side panel to 0 through the library's own
// `collapsible`/`collapsedSize` mechanism rather than conditionally rendering
// it, so the side panel's React subtree — and anything it holds (a terminal,
// a native browser view) — never unmounts when the dock closes (D-27:
// "closing the dock collapses it; it does not unmount it"). A split that
// mounts collapsed starts at 0 (no flash of an open pane) and re-opens at the
// last open size, else `defaultSize`. Dragging the side pane past its minimum
// collapses it too; `onCollapsedChange(true)` reports that so the owner's
// open state follows.
//
// `id` persists the split ratio per page (`autoSaveId` equivalent) via the
// library's `useDefaultLayout`, only after a user drag or key resize;
// `storageKey` names the exact localStorage key instead of the library's
// `react-resizable-panels:<id>:main:side`.
// `resizable={false}` removes the separator (the dock's sheet and maximized
// modes); `separatorLabel` names it.
// ────────────────────────────────────────────────────────────────

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
  usePanelCallbackRef,
  type GroupProps,
  type LayoutStorage,
  type PanelSize,
} from 'react-resizable-panels';
import { cn } from '../../lib/cn.js';
import { focusRing, separatorHitSlop } from '../../lib/focus.js';

export interface SplitPaneProps {
  /** Persists the split ratio (localStorage) across reloads; unique per page/dock. */
  id: string;
  /** Exact localStorage key for the persisted layout (default: the library's key built from `id`). */
  storageKey?: string;
  /** `main` (flexible) then `side` (the resizable pane). */
  children: readonly [ReactNode, ReactNode];
  /** Side pane size in px. Default 480 (440 on run pages, D-27). */
  defaultSize?: number;
  /** Side pane minimum size in px. Default 360. */
  minSize?: number;
  /** Side pane maximum size — a percentage string or a px number. Default `'60%'`. */
  maxSize?: number | string;
  /** Collapses the side pane to 0 width without unmounting it. */
  collapsed?: boolean;
  /** The side pane was collapsed (`true`) by a drag past its minimum. */
  onCollapsedChange?: (collapsed: boolean) => void;
  /** `false` removes the separator (nothing to drag). Default true. */
  resizable?: boolean;
  /** Accessible name of the separator. */
  separatorLabel?: string;
  /**
   * Whether each pane is a tab stop. Default true (a pane that scrolls must be
   * keyboard-reachable); pass false for a pane whose content owns its own
   * scrolling, or an empty spacer.
   */
  mainFocusable?: boolean;
  sideFocusable?: boolean;
  orientation?: GroupProps['orientation'];
  className?: string;
  sideClassName?: string;
  mainClassName?: string;
}

/** localStorage under one fixed key; unavailable storage (private window) reads as empty. */
function fixedKeyStorage(key: string): LayoutStorage {
  return {
    getItem: () => {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    setItem: (_ignored, value) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        /* quota / private mode: the layout is just not remembered */
      }
    },
  };
}

/** A resizable main + side split (the chat/run dock). Keyboard: arrow keys, Home, End on the separator. */
export function SplitPane({
  id,
  storageKey,
  children,
  defaultSize = 480,
  minSize = 360,
  maxSize = '60%',
  collapsed = false,
  onCollapsedChange,
  resizable = true,
  separatorLabel,
  mainFocusable = true,
  sideFocusable = true,
  orientation = 'horizontal',
  className,
  sideClassName,
  mainClassName,
}: SplitPaneProps) {
  const [main, side] = children;
  const vertical = orientation === 'vertical';
  const [sidePanel, setSidePanel] = usePanelCallbackRef();
  const storage = useMemo(() => (storageKey ? fixedKeyStorage(storageKey) : undefined), [storageKey]);

  // `onlySaveAfterUserInteractions`: without it, ANY layout computation gets persisted —
  // including a transient one measured before the container has its final size (a flex
  // ancestor still settling, a route transition). That would silently corrupt the saved
  // split ratio to something degenerate (found via a Storybook demo: an early 0-width
  // render saved `{main:100,side:0}`, which then pinned the side pane to 0 forever).
  // Only a real drag or arrow-key resize should be remembered.
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id,
    panelIds: ['main', 'side'],
    onlySaveAfterUserInteractions: true,
    ...(storage ? { storage } : {}),
  });

  // The size to re-open at: the last non-zero size seen, else the saved one, else `defaultSize`.
  const savedSide = defaultLayout?.['side'];
  const openSize = useRef<number | string>(savedSide && savedSide > 0 ? `${savedSide}%` : defaultSize);
  // Mounting collapsed starts at 0 instead of opening and then collapsing (a visible flash).
  const [initialLayout] = useState(() => (collapsed ? { main: 100, side: 0 } : defaultLayout));
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  const onCollapsedChangeRef = useRef(onCollapsedChange);
  onCollapsedChangeRef.current = onCollapsedChange;
  // A side pane at 0 stays mounted (its state survives) but is `invisible`: out
  // of the tab order and the accessibility tree, like a closed disclosure.
  const [sideShut, setSideShut] = useState(collapsed);

  useLayoutEffect(() => {
    if (!sidePanel) return;
    const isCollapsed = sidePanel.isCollapsed();
    if (collapsed && !isCollapsed) sidePanel.collapse();
    else if (!collapsed && isCollapsed) sidePanel.resize(openSize.current);
  }, [collapsed, sidePanel]);

  const onSideResize = (size: PanelSize, _id: string | number | undefined, prev: PanelSize | undefined) => {
    setSideShut(size.asPercentage === 0);
    if (size.asPercentage > 0) {
      openSize.current = `${size.asPercentage}%`;
      return;
    }
    // Open → 0 while the owner still wants it open: the user dragged it shut.
    // (Not on mount: a saved 0 layout is re-opened by the effect above.)
    if (prev && prev.asPercentage > 0 && !collapsedRef.current) onCollapsedChangeRef.current?.(true);
  };

  return (
    <Group
      id={id}
      orientation={orientation}
      defaultLayout={initialLayout}
      // A collapsed layout is an open/closed state, not a size: never persist it (the
      // owner persists open state itself), so a reload re-opens at the last real size.
      onLayoutChanged={(layout, meta) => {
        if ((layout['side'] ?? 0) > 0) onLayoutChanged(layout, meta);
      }}
      className={cn('flex min-h-0 min-w-0 flex-1', vertical ? 'flex-col' : 'flex-row', className)}
    >
      <Panel
        id="main"
        // The library forces `overflow: auto` via an inline style on this same
        // element regardless of `overflow-hidden` in `className` (inline style
        // wins), so it — not `main`'s own content — is the scrollable region;
        // `tabIndex` keeps it keyboard-reachable (axe scrollable-region-focusable).
        tabIndex={mainFocusable ? 0 : undefined}
        className={cn(
          'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
          mainFocusable && cn('-outline-offset-2', focusRing),
          mainClassName,
        )}
      >
        {main}
      </Panel>
      {resizable ? (
        <Separator
          aria-label={separatorLabel}
          className={cn(
            // A 1px hairline drawn with a border (no h-px/w-px literal, D-56): a
            // horizontal separator (vertical split) is a border-top with no set
            // height; a vertical separator (horizontal split) is a border-left
            // with no set width — the box collapses to the border's own width.
            'shrink-0 border-line-soft outline-none',
            vertical ? 'w-full border-t cursor-row-resize' : 'h-full border-l cursor-col-resize',
            vertical ? separatorHitSlop.horizontal : separatorHitSlop.vertical,
            focusRing,
          )}
        />
      ) : null}
      <Panel
        id="side"
        panelRef={setSidePanel}
        defaultSize={defaultSize}
        minSize={minSize}
        maxSize={maxSize}
        collapsible
        collapsedSize={0}
        onResize={onSideResize}
        tabIndex={sideFocusable && !sideShut ? 0 : undefined}
        className={cn(
          'flex min-h-0 min-w-0 flex-col overflow-hidden',
          sideFocusable && cn('-outline-offset-2', focusRing),
          sideShut && 'invisible',
          sideClassName,
        )}
      >
        {side}
      </Panel>
    </Group>
  );
}

