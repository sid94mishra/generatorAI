// ML-17 AdaptiveLayout contract (03 ML-17; 06 §1.3, §1.4; MD-24).
import type { ReactElement, ReactNode } from 'react';
import type { SidePanelPresentation } from '../SidePanel/SidePanel.types';

export interface PanelSlot {
  presentation: SidePanelPresentation;
  /** Only for the end panel in full screen: the main column's width (the sidebar stays when docked). */
  width?: number;
}

export interface AdaptiveLayoutProps {
  /** The sidebar: a SidePanel side="start" in the given presentation. */
  start: (slot: PanelSlot) => ReactElement;
  /** The workspace pane: a SidePanel side="end" in the given presentation. */
  end?: (slot: PanelSlot) => ReactElement;
  /** Tablet: the user hid the sidebar (it falls back to the drawer). */
  startHidden?: boolean;
  /** The start overlay is open: the main column leaves the accessibility tree (focus trap, MD-28). */
  startOverlayOpen?: boolean;
  /** The end panel is open (docked at ≥ 840, overlay below). */
  endOpen?: boolean;
  endFullscreen?: boolean;
  /** Insets the main column pays once (status bar; sides where no panel is docked). */
  mainInsets?: { top: number; left: number; right: number };
  children: ReactNode;
  testID?: string;
}
