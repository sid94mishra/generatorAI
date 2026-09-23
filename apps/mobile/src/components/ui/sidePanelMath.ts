// Pure geometry for SidePanel, split out so it is testable without a renderer.

/** Material 3 caps a modal drawer at 360dp; HIG sidebars sit near 320pt. */
export const SIDE_PANEL_MAX_WIDTH = 340;
/** Share of the window a panel may take, so a strip of content stays tappable. */
export const SIDE_PANEL_WIDTH_RATIO = 0.86;

export function sidePanelWidth(windowWidth: number): number {
  return Math.round(Math.min(SIDE_PANEL_MAX_WIDTH, windowWidth * SIDE_PANEL_WIDTH_RATIO));
}

/**
 * Where a released drag settles. A flick wins over position, the way the
 * platform drawers behave: a quick swipe opens from a few points of travel.
 */
export function settleOpen(progress: number, velocityTowardsOpen: number): boolean {
  'worklet';
  if (velocityTowardsOpen > 500) return true;
  if (velocityTowardsOpen < -500) return false;
  return progress > 0.5;
}

/**
 * Width of the strip along a panel's edge that starts an opening drag.
 *
 * Android's gesture navigation owns roughly the outer 24dp of each side for
 * Back and takes priority, so a strip no wider than that can never be reached;
 * the strip extends well past it there. iOS has no competing edge gesture on a
 * root screen, so the conventional narrow strip is enough.
 */
export function edgeStripWidth(platform: string): number {
  return platform === 'android' ? 72 : 28;
}
