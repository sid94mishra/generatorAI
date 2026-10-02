// MP-05 IconButton contract (03 MP-05; MD-51, MD-54, MD-56).
import type { HapticConcept, MobileIconConcept } from '@generatorai/design-tokens';

export type IconButtonVariant = 'plain' | 'glass' | 'bordered' | 'filled' | 'tonal';

export interface IconButtonProps {
  icon: MobileIconConcept;
  /** Required accessible name; a badge count belongs in it ("Open workspace pane, 2 changes"). */
  label: string;
  /** Default 'plain'. 'glass' is iOS floating chrome; Android draws it plain. */
  variant?: IconButtonVariant;
  /** md 44 / 48 (default), sm 36 / 40. */
  size?: 'sm' | 'md';
  /** Toggle state (pane toggle while open). */
  selected?: boolean;
  badge?: { count?: number; dot?: 'warn'; tone?: 'fg' | 'run' };
  /** Filled glyph state (play, pin …). */
  filled?: boolean;
  disabled?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  haptic?: HapticConcept;
  testID?: string;
}
