// ML-15 SwipeRow contract (03 ML-15; MD-52, MD-28).
import type { ReactElement } from 'react';
import type { MobileIconConcept } from '@generatorai/design-tokens';
import type { EntityRowProps } from '../EntityRow/EntityRow.types';

export interface SwipeAction {
  id: string;
  label: string;
  icon: MobileIconConcept;
  /** neutral (More: line-strong) or strong (Archive: fg-2 + surface text), MD-52. */
  tone: 'neutral' | 'strong';
  onPress: () => void;
}

export interface SwipeRowProps {
  /** Pin / Mark unread (only once MG-02 lands, MD-52). */
  leading?: ReadonlyArray<SwipeAction>;
  /** More / Archive. Never Approve, Delete or Run (MD-52). */
  trailing?: ReadonlyArray<SwipeAction>;
  /** Which side's last action a full swipe performs (only reversible ones). Default 'trailing' when trailing exists. */
  fullSwipe?: 'leading' | 'trailing' | false;
  children: ReactElement<EntityRowProps>;
  testID?: string;
}
