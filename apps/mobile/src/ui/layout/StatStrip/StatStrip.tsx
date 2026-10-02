// ML-18 StatTile / StatStrip (03 ML-18; MD-50, MD-71). `tiles`: equal tiles, gap 8, padding 12 14, raised,
// rounded-card-lg; the value in the `title` step with tabular numerals and a status tone for a count of that status,
// the label 13 fg-2; each tile can be pressed. `strip`: one rounded-group card, columns divided by hairlines, value
// over a caption label. Unknown values read "—".
import React from 'react';
import { View } from 'react-native';

import { cn } from '../../lib/cn';
import { formatCount } from '../../lib/format';
import { Pressable } from '../../primitives/Pressable';
import { Separator } from '../../primitives/Separator';
import { Text } from '../../primitives/Text';
import type { StatItem, StatStripProps } from './StatStrip.types';

export type { StatItem, StatStripProps } from './StatStrip.types';

export function statValue(value: StatItem['value']): string {
  if (value === null) return '—';
  return typeof value === 'number' ? formatCount(value) : value;
}

function Tile({ item }: { item: StatItem }): React.ReactElement {
  const body = (
    <View className="min-h-tile justify-between gap-1 rounded-card-lg bg-raised px-3.5 py-3">
      <Text role="title" tone={item.tone ?? 'fg'} tabular chrome>
        {statValue(item.value)}
      </Text>
      <Text role="footnote" tone="fg-2" numberOfLines={2}>
        {item.label}
      </Text>
    </View>
  );
  const label = `${statValue(item.value)}, ${item.label}`;
  if (!item.onPress) {
    return (
      <View className="flex-1" accessible accessibilityLabel={label}>
        {body}
      </View>
    );
  }
  return (
    <View className="flex-1">
      <Pressable onPress={item.onPress} frame="none" feedback="scale" large accessibilityRole="button" accessibilityLabel={label}>
        {body}
      </Pressable>
    </View>
  );
}

export function StatStrip({ variant, items, testID }: StatStripProps): React.ReactElement {
  if (variant === 'tiles') {
    return (
      <View testID={testID} className="flex-row gap-2">
        {items.map((item) => (
          <Tile key={item.id} item={item} />
        ))}
      </View>
    );
  }
  return (
    <View testID={testID} className="flex-row rounded-group bg-raised px-1 py-3.5">
      {items.map((item, i) => (
        <React.Fragment key={item.id}>
          {i > 0 ? <Separator orientation="vertical" /> : null}
          <View className={cn('flex-1 items-center gap-0.5 px-2')} accessible accessibilityLabel={`${statValue(item.value)}, ${item.label}`}>
            <Text role="detailTitle" tone={item.tone ?? 'fg'} tabular chrome>
              {statValue(item.value)}
            </Text>
            <Text role="caption" tone="fg-3" align="center" numberOfLines={2}>
              {item.label}
            </Text>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}
