// ML-05 SidePanel contract (03 ML-05; MD-18, MD-19, MD-24, MD-28).
import type { ReactNode } from 'react';

export type SidePanelSide = 'start' | 'end';
export type SidePanelPresentation = 'overlay' | 'persistent' | 'fullscreen';

export interface SidePanelProps {
  /** start = the drawer / sidebar, end = the workspace pane. */
  side: SidePanelSide;
  /** Ignored when `presentation` is 'persistent' (always shown). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** overlay: over a scrim · persistent: an inline column · fullscreen: the pane at 100 % of its host. */
  presentation: SidePanelPresentation;
  /** Start side only: the iOS left-edge swipe opens it (root screens, compact class; the shell's policy decides). */
  edgeOpenEnabled?: boolean;
  /** The panel's own close pan; off while a surface owns gestures (terminal, WebView; MD-19). */
  dragToCloseEnabled?: boolean;
  /** Override; by default from geometry (drawer / pane caps on phones, sidebar / dock when persistent). */
  width?: number;
  /** "Sidebar" / "Workspace pane": the region name and the scrim's "Close <label>". */
  accessibilityLabel: string;
  children: ReactNode;
  /** 'drawer' / 'pane'. */
  testID?: string;
}
