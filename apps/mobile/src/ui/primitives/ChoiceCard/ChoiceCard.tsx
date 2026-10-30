// MP-48 ChoiceCard (03 MP-48; MD-49): a selectable card — icon 20, title 16/600, footnote description, and the
// platform's single-choice indicator (iOS ✓ trailing / Android radio leading). Selected = bg-selected + 1px
// line-strong. Radius rounded-card (14 / 12, MD-129). Callers stack them on phones and grid them at `medium`+.
import React from 'react';
import { View } from 'react-native';

import { cn } from '../../lib/cn';
import { Icon } from '../Icon';
import { Pressable } from '../Pressable';
import { RADIO_SIDE, Radio } from '../RadioGroup';
import { Text } from '../Text';
import type { ChoiceCardProps } from './ChoiceCard.types';

export type { ChoiceCardProps } from './ChoiceCard.types';

export function choiceCardSurface(selected: boolean): string {
  return cn('flex-row items-start gap-3 rounded-card border p-4', selected ? 'border-line-strong bg-selected' : 'border-line-soft bg-raised');
}

export function ChoiceCard({ value, selected, title, description, icon, disabled = false, locked, onPress, testID }: ChoiceCardProps): React.ReactElement {
  const inactive = disabled || Boolean(locked);
  const indicator = <Radio value={value} selected={selected} disabled={inactive} />;
  const name = [title, description, locked].filter(Boolean).join(', ');
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={inactive}
      disabledReason={locked}
      haptic="selection"
      frame="none"
      feedback="scale"
      large
      accessibilityRole="radio"
      accessibilityLabel={name}
      accessibilityState={{ checked: selected }}
    >
      <View className={cn(choiceCardSurface(selected), inactive && 'opacity-60')}>
        {RADIO_SIDE === 'leading' ? <View className="pt-0.5">{indicator}</View> : null}
        {icon ? <Icon concept={icon} size={20} tone={selected ? 'fg' : 'fg-2'} /> : null}
        <View className="flex-1 gap-1">
          <Text role="transcript" weight={600}>
            {title}
          </Text>
          {description ? (
            <Text role="footnote" tone="fg-3">
              {description}
            </Text>
          ) : null}
          {locked ? (
            <View className="flex-row items-center gap-1">
              <Icon concept="lock" size={12} tone="fg-3" />
              <Text role="footnote" tone="fg-3">
                {locked}
              </Text>
            </View>
          ) : null}
        </View>
        {RADIO_SIDE === 'trailing' ? <View className="pt-0.5">{indicator}</View> : null}
      </View>
    </Pressable>
  );
}
