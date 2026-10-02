// MP-10 Chip contract (03 MP-10; MD-49).
import type { MobileIconConcept } from '@generatorai/design-tokens';

export type ChipVariant = 'filter' | 'dropdown' | 'input' | 'composer' | 'attachment' | 'add';

export interface ChipProps {
  label: string;
  /** Default 'filter'. */
  variant?: ChipVariant;
  selected?: boolean;
  icon?: MobileIconConcept;
  /** Composer agent chip: lock glyph + "locked" in the name. */
  locked?: boolean;
  /** Mono count after the label ("Active 12"). */
  count?: number;
  /** Attachment image. */
  thumbnail?: { uri: string };
  /** Attachment upload progress 0..1 (thin bottom bar). */
  progress?: number;
  /** Attachment failed: err border; onPress retries. */
  error?: string;
  onPress?: () => void;
  /** input / attachment: a separate "Remove <label>" control with its own hit frame. */
  onRemove?: () => void;
  disabled?: boolean;
  testID?: string;
}
