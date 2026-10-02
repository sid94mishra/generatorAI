// MP-23 SegmentedControl — the drawn path (03 MP-23 J path; MD-47): used when a segment has a count, glyph, lock or
// disabled state, and for Jest / web / clients without Expo UI. iOS: a h-seg 32 track (rounded-seg 9, bg-selected,
// padding 2) with the selected segment raised (rounded-seg-item 7, bg-raised + 1px line). Android: a connected h40
// group, 2 px gaps, ends radius 20 / inner 8, selected bg-selected + ✓ 16. Each segment's frame reaches the hit
// target (MD-91). Haptic: selection.
import React from 'react';
import { View } from 'react-native';

import { cn } from '../../lib/cn';
import { nativePlatform } from '../../platform/geometry';
import { Icon } from '../../primitives/Icon';
import { Pressable } from '../../primitives/Pressable';
import { Text } from '../../primitives/Text';
import type { SegmentedControlProps } from './SegmentedControl.types';

function androidShape(index: number, count: number): string {
  if (count === 1) return 'rounded-seg';
  if (index === 0) return 'rounded-s-seg rounded-e-seg-item';
  if (index === count - 1) return 'rounded-e-seg rounded-s-seg-item';
  return 'rounded-seg-item';
}

export function SegmentedControlJs<V extends string>({ segments, value, onValueChange, accessibilityLabel, size = 'md', fullWidth = false, testID }: SegmentedControlProps<V>): React.ReactElement {
  const android = nativePlatform === 'android';
  return (
    <View testID={testID} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel} className={cn('relative flex-row justify-center', fullWidth ? 'self-stretch' : 'self-start', android && 'gap-0.5')}>
      {android ? null : <View className="absolute inset-x-0 top-1.5 min-h-seg rounded-seg bg-selected" />}
      {segments.map((s, i) => {
        const selected = s.value === value;
        const inactive = Boolean(s.disabled || s.locked);
        return (
          <Pressable
            key={s.value}
            testID={testID ? `${testID}-${s.value}` : undefined}
            onPress={() => !selected && onValueChange(s.value)}
            disabled={inactive}
            disabledReason={s.locked ? 'Locked' : undefined}
            haptic="selection"
            feedback="none"
            accessibilityRole="radio"
            accessibilityLabel={s.count === undefined ? s.label : `${s.label}, ${s.count}`}
            accessibilityState={{ checked: selected }}
            className={cn('flex-row px-0.5', fullWidth && 'flex-1')}
          >
            <View
              className={cn(
                'grow flex-row items-center justify-center gap-1.5 px-3',
                android
                  ? cn(size === 'sm' ? 'min-h-8' : 'min-h-seg', androidShape(i, segments.length), selected ? 'bg-selected' : 'border border-line-strong')
                  : cn('min-h-7 rounded-seg-item', selected && 'border border-line bg-raised'),
                inactive && 'opacity-40',
              )}
            >
              {android && selected ? <Icon concept="check" size={16} tone="fg" /> : null}
              {s.icon ? <Icon concept={s.icon} size={14} tone={selected ? 'fg' : 'fg-2'} /> : null}
              <Text role={android ? 'subhead' : 'footnote'} weight={selected ? 600 : 500} tone={selected ? 'fg' : 'fg-2'} numberOfLines={1} chrome>
                {s.label}
              </Text>
              {s.count !== undefined ? (
                <Text role="monoSm" tone="fg-3" chrome>
                  {String(s.count)}
                </Text>
              ) : null}
              {s.locked ? <Icon concept="lock" size={12} tone="fg-3" /> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
