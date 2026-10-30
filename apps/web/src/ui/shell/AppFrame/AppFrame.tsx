// ────────────────────────────────────────────────────────────────
// S-01 AppFrame (03 §4 S-01, D-21, D-23; 06 §2.1, §3.5).
//
// The whole window: `bg-ground`, an optional S-06 TitleStrip on top (the
// `strip` layout: Windows, Linux with the custom title bar), then a row of
// [S-02 Sidebar | S-03 Rail] + S-04 MainCard, with the forced-rail flyout
// over that row. Mounts S-13 ToasterRegion. Presentational only: the layout
// (`mac | strip | native`) and the sidebar mode are decided by app/shell from
// the window chrome and the window width, and passed in.
//
// The Activity column (D-92) sits between the sidebar/rail and the card.
// Motion (D-109): the sidebar slot eases between the sidebar and rail widths
// (the card flexes with it); the Activity slot eases open from 0 to the
// column's width when docked and slides in when it floats over the card; the
// flyout slides in over the rail. Each part leaves the DOM once it has closed.
// `data-layout` / `data-sidebar` are the hooks the desktop-chrome CSS in
// globals.css keys off (the macOS rail-mode page-header inset, 06 §3.5), and
// what the shell smokes assert. The frame never writes the `<html>` classes
// (`platform-*`, `titlebar-*`, `window-*`); lib/desktop.ts does.
// ────────────────────────────────────────────────────────────────

import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/cn.js';
import { Reveal } from '../../primitives/Collapsible/Collapsible.js';
import { ToasterRegion } from '../ToasterRegion/ToasterRegion.js';

export type ShellLayout = 'mac' | 'strip' | 'native';
export type SidebarMode = 'expanded' | 'rail';

export interface AppFrameProps extends ComponentProps<'div'> {
  layout: ShellLayout;
  sidebarMode: SidebarMode;
  /** S-06 TitleStrip; rendered only in the `strip` layout. */
  titleStrip?: ReactNode;
  /** S-02 Sidebar or S-03 Rail. */
  sidebar: ReactNode;
  /** The Activity column (D-92): docked between the sidebar and the card, or an overlay over the card. */
  activity?: ReactNode;
  /** The Activity column is open (it eases in and out; mounted only while open or closing). */
  activityOpen?: boolean;
  /** The column floats over the card instead of docking beside it. */
  activityOverlay?: boolean;
  /** The SidebarFlyout (rail mode). */
  flyout?: ReactNode;
  /** The flyout is open (it slides in and out; mounted only while open or closing). */
  flyoutOpen?: boolean;
  /** S-04 MainCard. */
  children: ReactNode;
  /** Other shell layers (palette, shortcuts sheet, find bar), rendered after the body. */
  overlays?: ReactNode;
}

/** The app window frame: title strip, sidebar or rail, main card. */
export function AppFrame({
  layout,
  sidebarMode,
  titleStrip,
  sidebar,
  activity,
  activityOpen = false,
  activityOverlay = false,
  flyout,
  flyoutOpen = false,
  children,
  overlays,
  className,
  ...rest
}: AppFrameProps) {
  return (
    <div
      data-testid="app-frame"
      data-layout={layout}
      data-sidebar={sidebarMode}
      className={cn('@container/app relative flex h-dvh min-h-0 flex-col overflow-hidden bg-ground text-fg', className)}
      {...rest}
    >
      {layout === 'strip' ? titleStrip : null}
      <div className="relative flex min-h-0 flex-1">
        <div
          data-slot="sidebar-slot"
          className={cn('flex shrink-0 overflow-clip motion-size', sidebarMode === 'expanded' ? 'w-sidebar' : 'w-rail')}
        >
          {sidebar}
        </div>
        <Reveal
          open={activityOpen}
          motion={activityOverlay ? 'slide-start' : 'width'}
          // Overlay: a zero-width layer at the row's start; the column inside places itself (offset, width).
          className={activityOverlay ? 'absolute inset-y-0 left-0 z-dock' : 'flex shrink-0'}
        >
          {activity}
        </Reveal>
        {children}
        <Reveal open={sidebarMode === 'rail' && flyoutOpen} motion="slide-start" className="absolute inset-y-0 left-0 z-sidebar">
          {flyout}
        </Reveal>
      </div>
      {overlays}
      <ToasterRegion />
    </div>
  );
}
