// MP-04 Button contract (03 MP-04; MD-22, MD-51).
import type { HapticConcept, MobileIconConcept } from '@generatorai/design-tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'tonal';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  label: string;
  /** Default 'secondary'. At most one 'primary' per screen (MD-22). */
  variant?: ButtonVariant;
  /** Default 'md'. 'lg' for full-width CTAs only (MD-51). */
  size?: ButtonSize;
  /** Leading glyph. */
  icon?: MobileIconConcept;
  trailingIcon?: MobileIconConcept;
  /** Replaces the leading glyph with the spinner; keeps width; busy. */
  loading?: boolean;
  fullWidth?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onPress: () => void;
  /** None by default: success haptics fire on server confirmation, not here (MD-78). */
  haptic?: HapticConcept;
  /** When the label is ambiguous ("Deny" → "Deny git push"). */
  accessibilityLabel?: string;
  testID?: string;
}
