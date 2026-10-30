// MP-46 Card contract (03 MP-46; MD-50).
import type { ReactNode } from 'react';

export interface CardProps {
  /** card 14/12 (default) · group 22/16 · gate / tile = card-lg 20/16 (MD-50). */
  radius?: 'card' | 'group' | 'gate' | 'tile';
  /** 1px line-soft border (the Android default for composites). */
  outlined?: boolean;
  /** Default 'md' (12 14 iOS / 12 16 Android). */
  padding?: 'none' | 'sm' | 'md';
  onPress?: () => void;
  accessibilityLabel?: string;
  children: ReactNode;
  testID?: string;
}
