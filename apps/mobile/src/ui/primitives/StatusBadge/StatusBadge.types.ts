// MP-07 StatusBadge contract (03 MP-07): the shared props + mobile extras.
import type { StatusBadgeProps as SharedStatusBadgeProps } from '@generatorai/shared/ui-contract';

export interface StatusBadgeProps extends SharedStatusBadgeProps {
  /** Appended " · <detail>" (fg-2, 500): " · Bug Fixer". */
  detail?: string;
  /** ISO start; renders a ticking mono duration ("Running 4:12"). */
  elapsedSince?: string;
  /** md (default) or sm (dense rows, MD-64). */
  size?: 'sm' | 'md';
  testID?: string;
}
