// MP-04 Button (03 MP-04; MD-22, MD-51): capsule on both OSes; sm 36 / md 44·40 / lg 50·48, drawn inside a
// Pressable frame that reaches the hit target (MD-91). Disabled dims the content, not the surface.
import React from 'react';
import { View } from 'react-native';

import { cn } from '../../lib/cn';
import { Icon } from '../Icon';
import { Pressable } from '../Pressable';
import { Text } from '../Text';
import { useRegisterPrimary } from '../../lib/primaryAction';
import type { ButtonProps } from './Button.types';
import { ICON_SIZE, LABEL_ROLE, LABEL_TONE, buttonSurface } from './buttonStyles';

export type { ButtonProps, ButtonSize, ButtonVariant } from './Button.types';

export function Button({
  label,
  variant = 'secondary',
  size = 'md',
  icon,
  trailingIcon,
  loading = false,
  fullWidth = false,
  disabled = false,
  disabledReason,
  onPress,
  haptic,
  accessibilityLabel,
  testID,
}: ButtonProps): React.ReactElement {
  useRegisterPrimary(variant === 'primary', label);
  const tone = LABEL_TONE[variant];
  const iconSize = ICON_SIZE[size];
  const inactive = disabled || loading;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={inactive}
      disabledReason={disabledReason}
      feedback="scale"
      haptic={haptic}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ busy: loading }}
      className={cn(fullWidth && 'self-stretch')}
    >
      <View className={cn(buttonSurface({ variant, size }), fullWidth && 'w-full')}>
        {/* Never flattened: opacity toggles flattening, and an unflatten while the label re-renders re-parents the
            label's native view on Android Fabric ("addViewAt … already has a parent", MD-198). */}
        <View collapsable={false} className={cn('flex-row items-center gap-2', disabled && 'opacity-40')}>
          {loading ? (
            <Icon concept="loader" size={iconSize} tone={tone} spinning />
          ) : icon ? (
            <Icon concept={icon} size={iconSize} tone={tone} />
          ) : null}
          <Text role={LABEL_ROLE[size]} weight={600} tone={tone} numberOfLines={1}>
            {label}
          </Text>
          {trailingIcon ? <Icon concept={trailingIcon} size={iconSize} tone={tone} /> : null}
        </View>
      </View>
    </Pressable>
  );
}
