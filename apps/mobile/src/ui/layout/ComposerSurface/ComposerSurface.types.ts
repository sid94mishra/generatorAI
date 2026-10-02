// The composer's platform surface and its primary control (03 MB-01; MD-03, MD-56): iOS a glass capsule, Android a
// tonal `raised` card; Send / Stop is an ink circle (iOS 36) or a 48 × 48 radius-16 button (Android).
import type { ReactNode } from 'react';

export interface ComposerSurfaceProps {
  children: ReactNode;
  testID?: string;
}

export type ComposerPrimaryKind = 'send' | 'stop' | 'stopping' | 'force';

export interface ComposerPrimaryButtonProps {
  kind: ComposerPrimaryKind;
  /** Send: the draft is empty or blocked (drawn `bg-selected` + fg-3, MD-03). */
  disabled?: boolean;
  /** The blocking reason, spoken as the hint of a disabled Send. */
  disabledReason?: string;
  /** "Stop Bug Fixer". */
  stopLabel?: string;
  onPress: () => void;
  onLongPress?: () => void;
  testID?: string;
}
