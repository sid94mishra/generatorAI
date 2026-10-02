// ML-20 SectionHeader contract (03 ML-20; MD-68).
import type { MobileIconConcept } from '@generatorai/design-tokens';

export interface SectionHeaderProps {
  title: string;
  /** list (default): list-section label · home: screen-level section title (headline) · label: drawer section (h30). */
  variant?: 'list' | 'home' | 'label';
  icon?: MobileIconConcept;
  count?: number;
  countTone?: 'fg-3' | 'warn';
  action?: { label: string; onPress: () => void };
  testID?: string;
}
