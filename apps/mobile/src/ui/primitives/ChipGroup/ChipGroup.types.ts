// MP-11 ChipGroup contract (03 MP-11).
import type { ChipProps } from '../Chip/Chip.types';

export type ChipGroupItem = Omit<ChipProps, 'onPress' | 'selected'> & { id: string };

export interface ChipGroupProps {
  items: ReadonlyArray<ChipGroupItem>;
  /** Default 'none' (each chip acts on its own via onItemPress). */
  selection?: 'single' | 'multi' | 'none';
  value?: string | string[];
  onValueChange?: (value: string | string[]) => void;
  onItemPress?: (id: string) => void;
  /** 'scroll' (default; horizontal, gutter inset) or 'wrap'. */
  layout?: 'scroll' | 'wrap';
  /** wrap only: show this many, then a "+N" chip that shows the rest. */
  max?: number;
  accessibilityLabel: string;
  testID?: string;
}
