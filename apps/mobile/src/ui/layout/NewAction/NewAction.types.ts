// ML-09 NewAction contract (03 ML-09; MD-22).
import type { MobileIconConcept } from '@generatorai/design-tokens';

export interface NewActionProps {
  /** "New chat", "New project", "Run" … (also the accessible name when collapsed). */
  label: string;
  icon: MobileIconConcept;
  onPress: () => void;
  /** Icon-only while the list scrolls down (the Screen's scroll direction drives it). */
  collapsed?: boolean;
  testID?: string;
}
