// ML-07 PaneShell contract (03 ML-07; MD-23, MD-54, MD-82).
import type { ReactElement, ReactNode } from 'react';
import type { PaneTabStripProps } from '../PaneTabStrip/PaneTabStrip.types';

export interface PaneShellProps {
  /** "Workspace". */
  title: string;
  /** The chat / run title. */
  subtitle?: string;
  mode: 'overlay' | 'fullscreen' | 'docked';
  onToggleFullscreen: () => void;
  onClose: () => void;
  /** Full screen only: leading "Back to chat". */
  onBackToChat?: () => void;
  backToLabel?: string;
  tabs: ReactElement<PaneTabStripProps>;
  /** The active tab's toolbar (40–48). */
  toolbar?: ReactNode;
  /** e.g. the Changes commit footer. */
  footer?: ReactNode;
  /** The active tab body (visited bodies stay mounted, MD-24). */
  children: ReactNode;
  testID?: string;
}
