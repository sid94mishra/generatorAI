// ML-20 SectionHeader (03 ML-20; MD-68): `list` — iOS 13/600 fg-3 at 20, Android 14/600 fg-2 at 16; `home` — the
// screen-level headline (17/600 / 16/600) fg; `label` — the drawer's h30 13/600 fg-3. Optional icon, Count and a
// trailing link ("See all"). Role header.
import React from 'react';
import { View } from 'react-native';

import { cn } from '../../lib/cn';
import { nativePlatform } from '../../platform/geometry';
import { Count } from '../../primitives/Count';
import { Icon } from '../../primitives/Icon';
import { Link } from '../../primitives/Link';
import { Text } from '../../primitives/Text';
import type { SectionHeaderProps } from './SectionHeader.types';

export type { SectionHeaderProps } from './SectionHeader.types';

export function SectionHeader({ title, variant = 'list', icon, count, countTone = 'fg-3', action, testID }: SectionHeaderProps): React.ReactElement {
  const android = nativePlatform === 'android';
  const home = variant === 'home';
  const label = variant === 'label';
  return (
    <View testID={testID} className={cn('flex-row items-center gap-2', label ? 'min-h-th px-3' : android ? 'min-h-th px-4' : 'min-h-th px-5', home && 'pb-1 pt-4')}>
      {icon ? <Icon concept={icon} size={14} tone={home ? 'fg-2' : 'fg-3'} /> : null}
      <Text role={home ? 'headline' : android && !label ? 'subhead' : 'footnote'} weight={600} tone={home ? 'fg' : android && !label ? 'fg-2' : 'fg-3'} accessibilityRole="header" numberOfLines={1} className="shrink">
        {title}
      </Text>
      {count !== undefined ? <Count value={count} tone={countTone} /> : null}
      <View className="flex-1" />
      {action ? <Link label={action.label} onPress={action.onPress} standalone /> : null}
    </View>
  );
}
