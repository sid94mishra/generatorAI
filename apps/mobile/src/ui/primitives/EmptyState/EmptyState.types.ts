// MP-32 EmptyState contract (03 MP-32; MDF-136 R-EMPTY / R-NORESULT).
import type { EmptyStateKey } from '@generatorai/shared/ui-contract';
import type { MobileIconConcept } from '@generatorai/design-tokens';

export interface EmptyStateProps {
  /** Copy from EMPTY_STATE_COPY (the default); the props below override a field. */
  copyKey?: EmptyStateKey;
  icon?: MobileIconConcept;
  title?: string;
  description?: string;
  /** One secondary action at most (never primary): the module's New, "Clear search". */
  action?: { label: string; icon?: MobileIconConcept; onPress: () => void };
  /** Inside cards and widget previews: tighter padding. */
  compact?: boolean;
  testID?: string;
}
