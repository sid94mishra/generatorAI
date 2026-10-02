// ML-12 ListSection contract (03 ML-12; MD-68).
import type { ReactNode } from 'react';

export type RowPosition = 'first' | 'middle' | 'last' | 'only';

export interface ListSectionProps {
  title?: string;
  /** Mono count after the title. */
  count?: number;
  /** Trailing header link ("See all"). */
  action?: { label: string; onPress: () => void };
  /** footnote fg-3 under the group. */
  footer?: string;
  /** 'grouped' (default): iOS inset group / Android flat. 'carded': composite content (Android segmented list). */
  variant?: 'grouped' | 'carded';
  /** Default 'inset'. */
  dividers?: 'inset' | 'full' | 'none';
  children: ReactNode;
  testID?: string;
}
