// Resolves EmptyState copy (03 MP-32): EMPTY_STATE_COPY[copyKey] with prop overrides.
import { EMPTY_STATE_COPY } from '@generatorai/shared/ui-contract';
import type { MobileIconConcept } from '@generatorai/design-tokens';
import type { EmptyStateProps } from './EmptyState.types';

export interface ResolvedEmptyCopy {
  icon?: MobileIconConcept;
  title: string;
  description?: string;
}

export function emptyCopy({ copyKey, icon, title, description }: Pick<EmptyStateProps, 'copyKey' | 'icon' | 'title' | 'description'>): ResolvedEmptyCopy {
  const base = copyKey ? EMPTY_STATE_COPY[copyKey] : undefined;
  return {
    icon: icon ?? (base?.icon as MobileIconConcept | undefined),
    title: title ?? base?.title ?? '',
    description: description ?? base?.description,
  };
}
