// Pure SidePanel geometry and gesture rules (03 ML-05; 06 §1.3, §1.5; MD-19, MD-24). Unit-tested.
import type { NativeGeometry } from '@generatorai/design-tokens';
import type { SidePanelPresentation, SidePanelSide } from './SidePanel.types';

/** The panel's width: phones cap the drawer / pane at a share of the window; persistent columns use the shell widths. */
export function panelWidth(geo: Pick<NativeGeometry, 'mobileShell' | 'panelMaxFraction' | 'shell'>, side: SidePanelSide, presentation: SidePanelPresentation, windowWidth: number): number {
  if (presentation === 'fullscreen') return windowWidth;
  if (presentation === 'persistent') return side === 'start' ? geo.shell.sidebar : geo.shell.dock;
  const key = side === 'start' ? 'drawer' : 'pane';
  return Math.round(Math.min(geo.mobileShell[key], geo.panelMaxFraction[key] * windowWidth));
}

/** Opens past 40 % of travel or on a fling faster than 500 pt/s toward open (06 §1.5). */
export function settleOpen(progress: number, velocityTowardOpen: number, snap = 0.4): boolean {
  'worklet';
  if (velocityTowardOpen > 500) return true;
  if (velocityTowardOpen < -500) return false;
  return progress > snap;
}

/** Progress (0 closed → 1 open) after a drag of `translation` from `start`; `sign` is +1 for the start side. */
export function dragProgress(start: number, translation: number, sign: 1 | -1, width: number): number {
  'worklet';
  if (width <= 0) return start;
  return Math.min(1, Math.max(0, start + (sign * translation) / width));
}

/** Which surface recipe a panel draws (03 ML-05): the class list lives in the component, keyed by this. */
export type PanelSurface = 'ios-drawer' | 'ios-pane' | 'ios-card' | 'android-modal' | 'android-tablet-drawer' | 'android-tablet-pane';

export function panelSurface(platform: 'ios' | 'android', side: SidePanelSide, presentation: SidePanelPresentation): PanelSurface {
  if (platform === 'ios') {
    if (presentation === 'persistent') return 'ios-card';
    return side === 'start' ? 'ios-drawer' : 'ios-pane';
  }
  if (presentation === 'persistent') return side === 'start' ? 'android-tablet-drawer' : 'android-tablet-pane';
  return 'android-modal';
}
