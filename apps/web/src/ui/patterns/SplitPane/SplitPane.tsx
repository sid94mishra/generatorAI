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
// `collapsible`/`collapsedSize` mechanism (imperative `collapse()`/`expand()`
// via `panelRef`) rather than conditionally rendering it, so the side panel's
// React subtree — and anything it holds (a terminal, a native browser view)
// — never unmounts when the dock closes (D-27: "closing the dock collapses
// it; it does not unmount it").
//
// `id` persists the split ratio per page (`autoSaveId` equivalent) via the
// library's `useDefaultLayout` (localStorage-backed here; pass `storage` to
// use something else).
// ────────────────────────────────────────────────────────────────

import { useEffect, useRef, type ReactNode } from 'react';
import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
  usePanelCallbackRef,
  type GroupProps,
} from 'react-resizable-panels';
import { cn } from '../../lib/cn.js';
import { focusRing, separatorHitSlop } from '../../lib/focus.js';

export interface SplitPaneProps {
  /** Persists the split ratio (localStorage) across reloads; unique per page/dock. */
  id: string;
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
  orientation?: GroupProps['orientation'];
  className?: string;
  sideClassName?: string;
  mainClassName?: string;
}

/** A resizable main + side split (the chat/run dock). Keyboard: arrow keys, Home, End on the separator. */
export function SplitPane({
  id,
  children,
  defaultSize = 480,
  minSize = 360,
  maxSize = '60%',
  collapsed = false,
  orientation = 'horizontal',
  className,
  sideClassName,
  mainClassName,
}: SplitPaneProps) {
  const [main, side] = children;
  const vertical = orientation === 'vertical';
  const [sidePanel, setSidePanel] = usePanelCallbackRef();
  const wasCollapsed = useRef(collapsed);

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id, panelIds: ['main', 'side'] });

  useEffect(() => {
    if (collapsed === wasCollapsed.current) return;
    wasCollapsed.current = collapsed;
    if (!sidePanel) return;
    if (collapsed) sidePanel.collapse();
    else sidePanel.expand();
  }, [collapsed, sidePanel]);

  return (
    <Group
      orientation={orientation}
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
      className={cn('flex min-h-0 min-w-0 flex-1', vertical ? 'flex-col' : 'flex-row', className)}
    >
      <Panel
        id="main"
        // The library forces `overflow: auto` via an inline style on this same
        // element regardless of `overflow-hidden` in `className` (inline style
        // wins), so it — not `main`'s own content — is the scrollable region;
        // `tabIndex` keeps it keyboard-reachable (axe scrollable-region-focusable).
        tabIndex={0}
        className={cn('flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden -outline-offset-2', focusRing, mainClassName)}
      >
        {main}
      </Panel>
      <Separator
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
      <Panel
        id="side"
        panelRef={setSidePanel}
        defaultSize={defaultSize}
        minSize={minSize}
        maxSize={maxSize}
        collapsible
        collapsedSize={0}
        tabIndex={0}
        className={cn('flex min-h-0 min-w-0 flex-col overflow-hidden -outline-offset-2', focusRing, sideClassName)}
      >
        {side}
      </Panel>
    </Group>
  );
}
