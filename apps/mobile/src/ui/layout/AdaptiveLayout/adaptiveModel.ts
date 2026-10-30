// Pure size-class presentation rules (06 §1.3, MD-24). Unit-tested.
import type { SizeClass } from '../../platform/breakpoints';
import type { SidePanelPresentation } from '../SidePanel/SidePanel.types';

export interface AdaptivePresentations {
  start: Exclude<SidePanelPresentation, 'fullscreen'>;
  end: SidePanelPresentation;
}

/**
 * compact (< 600): drawer + pane over a scrim · medium (600–839): persistent sidebar, overlay pane · expanded (≥ 840):
 * persistent sidebar, docked pane while open. A hidden sidebar falls back to the drawer; full screen is a pane mode.
 */
export function adaptivePresentations(sizeClass: SizeClass, flags: { startHidden?: boolean; endOpen?: boolean; endFullscreen?: boolean }): AdaptivePresentations {
  const start = sizeClass !== 'compact' && !flags.startHidden ? 'persistent' : 'overlay';
  const end = flags.endOpen && flags.endFullscreen ? 'fullscreen' : flags.endOpen && sizeClass === 'expanded' ? 'persistent' : 'overlay';
  return { start, end };
}

/** The full-screen pane covers the main column: the window less a docked sidebar. */
export function fullscreenWidth(windowWidth: number, start: AdaptivePresentations['start'], sidebarWidth: number): number {
  return Math.max(0, windowWidth - (start === 'persistent' ? sidebarWidth : 0));
}
