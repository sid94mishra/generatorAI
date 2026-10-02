// ML-04 StatusLine contract (03 ML-04; MD-67).
import type { ReactElement } from 'react';
import type { StatusBadgeProps } from '../../primitives/StatusBadge/StatusBadge.types';

export interface StatusLineProps {
  status: StatusBadgeProps;
  /** Mono meta after the badge, joined with " · " ("v7 · last run #248"). */
  meta?: ReadonlyArray<string | ReactElement>;
  testID?: string;
}
