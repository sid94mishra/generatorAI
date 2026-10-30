// MP-06 Badge contract (03 MP-06; MD-64). Status tones only through StatusBadge (MD-25).
import type { MobileIconConcept } from '@generatorai/design-tokens';

export interface BadgeProps {
  label: string;
  /** Default 'neutral' (bg-selected); 'outline' = 1px border-line, transparent (scope and risk tags). */
  tone?: 'neutral' | 'outline';
  icon?: MobileIconConcept;
  /** Rendered mono after the label ("v7"). */
  suffix?: string;
  /** Whole label mono (branch names, MD-64). */
  mono?: boolean;
  /** md = h-badge 24 / 26, sm = h-badge-sm 20 (MD-64). Default 'md'. */
  size?: 'sm' | 'md';
  testID?: string;
}
