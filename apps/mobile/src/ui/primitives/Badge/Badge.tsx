// MP-06 Badge (03 MP-06; MD-64): neutral or outline pill; sm for dense rows; mono for branch names.
import React from 'react';
import { View } from 'react-native';

import { cn } from '../../lib/cn';
import { Icon } from '../Icon';
import { Text } from '../Text';
import type { BadgeProps } from './Badge.types';

export type { BadgeProps } from './Badge.types';

/** The badge pill (shared with StatusBadge): MD-64 heights, radius and padding. */
export function badgeFrame(size: 'sm' | 'md'): string {
  return size === 'sm'
    ? 'min-h-badge-sm flex-row items-center gap-1 self-start rounded-badge px-1.5'
    : 'min-h-badge flex-row items-center gap-1 self-start rounded-badge ios:px-2.25 android:px-2';
}

export function Badge({ label, tone = 'neutral', icon, suffix, mono = false, size = 'md', testID }: BadgeProps): React.ReactElement {
  return (
    <View testID={testID} className={cn(badgeFrame(size), tone === 'outline' ? 'border border-line' : 'bg-selected')}>
      {icon ? <Icon concept={icon} size={size === 'sm' ? 12 : 14} tone="fg-2" /> : null}
      <Text role={mono ? 'monoSm' : 'caption'} tone="fg-2" chrome numberOfLines={1}>
        {label}
        {suffix ? (
          <Text role="monoSm" tone="fg-3" chrome>
            {` ${suffix}`}
          </Text>
        ) : null}
      </Text>
    </View>
  );
}
