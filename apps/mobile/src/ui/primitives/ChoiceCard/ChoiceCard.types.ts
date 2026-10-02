// MP-48 ChoiceCard contract (03 MP-48; MD-49). Grouped by RadioGroup (MP-21).
import type { MobileIconConcept } from '@generatorai/design-tokens';

export interface ChoiceCardProps {
  value: string;
  selected: boolean;
  title: string;
  description?: string;
  icon?: MobileIconConcept;
  disabled?: boolean;
  /** Why it cannot be chosen ("Requires admin access"): lock glyph + the reason; not selectable. */
  locked?: string;
  onPress: () => void;
  testID?: string;
}
