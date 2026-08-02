// ────────────────────────────────────────────────────────────────
// Touchable — the single tap primitive.
//
// Every tappable surface in the app goes through this, which is what makes
// press feedback consistent instead of "whatever that screen's author felt
// like". It provides three things RN's `Pressable` does not:
//
//   • a spring scale on the UI thread (never the JS thread — the chat screen
//     is mid-token-stream when most taps happen),
//   • a haptic vocabulary tied to intent rather than to a raw API,
//   • an enforced 44pt hit target via `hitSlop`, so a 20pt icon is still
//     comfortably tappable without padding the layout out of shape.
// ────────────────────────────────────────────────────────────────

import React, { useCallback } from 'react';
import { type PressableProps, type ViewStyle } from 'react-native';
import { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { AnimatedPressable } from './animated';
import { PRESS_SCALE, PRESS_SCALE_LARGE, SPRING_PRESS } from './motion';
import { haptics } from './haptics';

export type HapticIntent = 'none' | 'select' | 'tap' | 'commit';

export interface TouchableProps extends Omit<PressableProps, 'style'> {
  /** `large` presses less, so a full-width card does not appear to shrink. */
  scale?: 'default' | 'large' | 'none';
  haptic?: HapticIntent;
  className?: string;
  style?: ViewStyle;
  children?: React.ReactNode;
}

export function Touchable({
  scale = 'default',
  haptic = 'tap',
  onPress,
  disabled,
  children,
  style,
  ...rest
}: TouchableProps): React.ReactElement {
  const pressed = useSharedValue(0);

  const target = scale === 'large' ? PRESS_SCALE_LARGE : PRESS_SCALE;

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: scale === 'none' ? 1 : 1 - pressed.value * (1 - target) },
    ],
    opacity: 1 - pressed.value * 0.12,
  }));

  const handlePress = useCallback<NonNullable<PressableProps['onPress']>>(
    (event) => {
      if (haptic === 'select') haptics.select();
      else if (haptic === 'commit') haptics.commit();
      else if (haptic === 'tap') haptics.tap();
      onPress?.(event);
    },
    [haptic, onPress],
  );

  return (
    <AnimatedPressable
      accessibilityRole="button"
      disabled={disabled}
      // 8pt on every side turns a 28pt chip into a 44pt target without
      // changing how the row lays out.
      hitSlop={8}
      onPressIn={() => {
        pressed.value = withSpring(1, SPRING_PRESS);
      }}
      onPressOut={() => {
        pressed.value = withSpring(0, SPRING_PRESS);
      }}
      onPress={handlePress}
      style={[animatedStyle, style, disabled ? { opacity: 0.45 } : null]}
      {...rest}
    >
      {children}
    </AnimatedPressable>
  );
}
