// MP-43 NumberField — Android (03 MP-43): two 40 dp outlined circular IconButtons (frames 48) with the mono value
// between them. One adjustable element for TalkBack (volume-key style increments). Haptic: selection.
import React from 'react';
import { View } from 'react-native';

import { IconButton } from '../IconButton';
import { Text } from '../Text';
import type { NumberFieldProps } from './NumberField.types';
import { canStep, clampStep, numberAccessibilityValue } from './numberFieldModel';

export type { NumberFieldProps } from './NumberField.types';

export function NumberField({ value, onValueChange, min, max, step = 1, label, format, disabled = false, testID }: NumberFieldProps): React.ReactElement {
  const text = format ? format(value) : String(value);
  const change = (direction: 1 | -1): void => {
    if (!disabled && canStep(value, direction, min, max)) onValueChange(clampStep(value, direction * step, min, max));
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
      className="flex-row items-center"
    >
      <IconButton icon="minus" label={`Decrease ${label}`} variant="bordered" size="sm" haptic="selection" disabled={disabled || !canStep(value, -1, min, max)} onPress={() => change(-1)} />
      <Text role="monoLg" tone={disabled ? 'fg-3' : 'fg'} align="center" className="min-w-10">
        {text}
      </Text>
      <IconButton icon="plus" label={`Increase ${label}`} variant="bordered" size="sm" haptic="selection" disabled={disabled || !canStep(value, 1, min, max)} onPress={() => change(1)} />
    </View>
  );
}
