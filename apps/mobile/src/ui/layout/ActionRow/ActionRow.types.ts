// ActionRow contract (the gate-card action row, 03 MB-15 / MD-50; MD-51 sizes; MD-22 one primary).
import type { MobileIconConcept } from '@generatorai/design-tokens';

/** The shared gate roles (`GateActionRole`): primary → primary, secondary → secondary, danger → destructive, quiet → ghost. */
export type ActionRole = 'primary' | 'secondary' | 'danger' | 'quiet';

export interface RowAction {
  id: string;
  label: string;
  role: ActionRole;
  onPress: () => void;
  icon?: MobileIconConcept;
  disabled?: boolean;
  disabledReason?: string;
  loading?: boolean;
  /** When the label is ambiguous ("Allow git push"). */
  accessibilityLabel?: string;
  testID?: string;
}

export interface ActionRowProps {
  /** In display order (start → end). */
  actions: ReadonlyArray<RowAction>;
  /** A footnote under the row ("Face ID required"), announced with the actions. */
  note?: string;
  testID?: string;
}
