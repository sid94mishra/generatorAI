// MP-21 RadioGroup (+ Radio, RadioOption) — 03 MP-21, MD-49. iOS draws no radio control: the selected row shows a
// trailing ✓ 18 in the accent. Android: a leading M3 radio, 20 circle with a 2px ring (accent when selected, fg-2
// otherwise) and a 10 dot. Geometry from geometry().controls.radio. Haptic: selection.
import React, { useMemo } from 'react';
import { View } from 'react-native';

import { cn } from '../../lib/cn';
import { geometry, nativePlatform } from '../../platform/geometry';
import { Icon } from '../Icon';
import type { IconSize } from '../Icon/Icon.types';
import { Pressable } from '../Pressable';
import { Text } from '../Text';
import type { RadioGroupProps, RadioOptionProps, RadioProps } from './RadioGroup.types';
import { RadioGroupContext, useRadioGroup } from './radioContext';

export type { RadioGroupProps, RadioOptionProps, RadioProps } from './RadioGroup.types';

/** Where the indicator sits on this OS (MD-49). */
export const RADIO_SIDE: 'leading' | 'trailing' = nativePlatform === 'android' ? 'leading' : 'trailing';

export function Radio({ selected, disabled = false }: RadioProps): React.ReactElement {
  const r = geometry().controls.radio;
  if (nativePlatform !== 'android') {
    // iOS: a fixed-width slot so labels stay aligned; the ✓ appears only when selected.
    return (
      <View className={cn('size-4.5 items-center justify-center', disabled && 'opacity-40')}>
        {selected ? <Icon concept="check" size={r.checkmark as IconSize} tone="accent" /> : null}
      </View>
    );
  }
  return (
    <View
      className={cn('items-center justify-center rounded-full', selected ? 'border-accent' : 'border-fg-2', disabled && 'opacity-40')}
      style={{ width: r.size, height: r.size, borderWidth: r.ring }}
    >
      {selected ? <View className="rounded-full bg-accent" style={{ width: r.dot, height: r.dot }} /> : null}
    </View>
  );
}

export function RadioGroup({ value, onValueChange, accessibilityLabel, children, testID }: RadioGroupProps): React.ReactElement {
  const context = useMemo(() => ({ value, select: onValueChange }), [value, onValueChange]);
  return (
    <RadioGroupContext.Provider value={context}>
      <View testID={testID} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}>
        {children}
      </View>
    </RadioGroupContext.Provider>
  );
}

export function RadioOption({ value, label, description, disabled = false, testID }: RadioOptionProps): React.ReactElement {
  const group = useRadioGroup();
  const selected = group?.value === value;
  const indicator = <Radio value={value} selected={selected} disabled={disabled} />;
  return (
    <Pressable
      testID={testID}
      onPress={() => group?.select(value)}
      disabled={disabled}
      haptic="selection"
      frame="none"
      accessibilityRole="radio"
      accessibilityLabel={description ? `${label}, ${description}` : label}
      accessibilityState={{ checked: selected }}
      className="min-h-item flex-row items-center gap-3 px-4 py-2"
    >
      {RADIO_SIDE === 'leading' ? indicator : null}
      <View className="flex-1 gap-0.5">
        <Text role="body" tone={disabled ? 'fg-3' : 'fg'}>
          {label}
        </Text>
        {description ? (
          <Text role="footnote" tone="fg-3">
            {description}
          </Text>
        ) : null}
      </View>
      {RADIO_SIDE === 'trailing' ? indicator : null}
    </Pressable>
  );
}
