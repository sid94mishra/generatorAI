// MP-20 Checkbox (03 MP-20; 02 §B.7 controls; MD-49). iOS: a 22 circle, 1.5 line-strong ring, filled accent + ✓ 14.
// Android: an 18 square r3 with a 2px fg-2 border (2 px inset in a 22 box), filled accent + ✓. Sizes, radius and
// border width come from geometry().controls.checkbox. Indeterminate = filled + minus. Haptic: selection.
import React from 'react';
import { View } from 'react-native';

import { cn } from '../../lib/cn';
import { geometry } from '../../platform/geometry';
import { Icon } from '../Icon';
import { Pressable } from '../Pressable';
import { Text } from '../Text';
import type { CheckboxProps } from './Checkbox.types';

export type { CheckboxProps } from './Checkbox.types';

/** The value a press sets (indeterminate → checked, like UIKit / M3). */
export function nextChecked(checked: CheckboxProps['checked']): boolean {
  return checked !== true;
}

/** The drawn box only (used by ListRow kind="check" and selection-mode rows). */
export function CheckboxBox({ checked, disabled = false }: Pick<CheckboxProps, 'checked' | 'disabled'>): React.ReactElement {
  const box = geometry().controls.checkbox;
  const on = checked !== false;
  return (
    <View className="size-5.5 items-center justify-center">
      <View
        className={cn('items-center justify-center', on ? 'bg-accent' : 'ios:border-line-strong android:border-fg-2', disabled && 'opacity-40')}
        style={{ width: box.size, height: box.size, borderRadius: box.radius, borderWidth: on ? 0 : box.border }}
      >
        {on ? <Icon concept={checked === 'indeterminate' ? 'minus' : 'check'} size={14} tone="on-accent" /> : null}
      </View>
    </View>
  );
}

export function Checkbox({ checked, onValueChange, label, accessibilityLabel, disabled = false, testID }: CheckboxProps): React.ReactElement {
  return (
    <Pressable
      testID={testID}
      onPress={() => onValueChange(nextChecked(checked))}
      disabled={disabled}
      haptic="selection"
      feedback="none"
      accessibilityRole="checkbox"
      accessibilityLabel={label ?? accessibilityLabel}
      accessibilityState={{ checked: checked === 'indeterminate' ? 'mixed' : checked }}
      className={label ? 'flex-row items-center justify-start gap-3 self-start' : undefined}
    >
      <CheckboxBox checked={checked} disabled={disabled} />
      {label ? (
        <Text role="body" tone={disabled ? 'fg-3' : 'fg'} className="shrink">
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}
