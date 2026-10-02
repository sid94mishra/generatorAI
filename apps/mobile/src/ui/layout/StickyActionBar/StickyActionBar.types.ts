// ML-23 StickyActionBar contract (03 ML-23; MD-22).
import type { ButtonProps } from '../../primitives/Button/Button.types';

export interface StickyActionBarProps {
  summary?: { title: string; subtitle?: string };
  /** The screen's one filled primary (rendered `primary`, size lg). */
  primary: Omit<ButtonProps, 'variant' | 'size'>;
  /** Back · Continue wizards: the secondary step button. */
  secondary?: Omit<ButtonProps, 'variant' | 'size'>;
  testID?: string;
}
