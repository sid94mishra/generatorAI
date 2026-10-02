// MP-43 NumberField — iOS (03 MP-43): the value (mono) to the start of a joined −|+ pill, 92 × 32, rounded-seg 9,
// bg-selected, a hairline between the halves. Each half's Pressable frame reaches 44 (MD-91). The whole control is
// one adjustable element (swipe up / down) for VoiceOver. Haptic: selection.
import React from 'react';
import { View } from 'react-native';

import { cn } from '../../lib/cn';
import { Icon } from '../Icon';
import { Pressable } from '../Pressable';
import { Text } from '../Text';
import type { NumberFieldProps } from './NumberField.types';
import { canStep, clampStep, numberAccessibilityValue } from './numberFieldModel';

export type { NumberFieldProps } from './NumberField.types';

export function NumberField({ value, onValueChange, min, max, step = 1, label, format, disabled = false, testID }: NumberFieldProps): React.ReactElement {
  const text = format ? format(value) : String(value);
  const change = (direction: 1 | -1): void => {
    if (!disabled && canStep(value, direction, min, max)) onValueChange(clampStep(value, direction * step, min, max));
  };
  const half = (direction: 1 | -1): React.ReactElement => {
    const enabled = !disabled && canStep(value, direction, min, max);
    return (
      <Pressable onPress={() => change(direction)} disabled={!enabled} haptic="selection" feedback="highlight" accessibilityRole="button" accessibilityLabel={direction > 0 ? `Increase ${label}` : `Decrease ${label}`}>
        <View className={cn('h-8 w-11.5 items-center justify-center bg-selected', direction < 0 ? 'rounded-s-seg' : 'rounded-e-seg', !enabled && 'opacity-40')}>
          <Icon concept={direction > 0 ? 'plus' : 'minus'} size={16} tone="fg" />
        </View>
      </Pressable>
    );
  };
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={numberAccessibilityValue(value, text, min, max)}
      accessibilityState={{ disabled }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => change(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
      className="flex-row items-center gap-3"
    >
      <Text role="monoLg" tone={disabled ? 'fg-3' : 'fg'}>
        {text}
      </Text>
      <View className="flex-row items-center">
        {half(-1)}
        <View className="h-4.5 w-px bg-line" />
        {half(1)}
      </View>
    </View>
  );
}
