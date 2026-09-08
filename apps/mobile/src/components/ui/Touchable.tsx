// ────────────────────────────────────────────────────────────────
// Touchable — the single tap primitive.
//
// Every tappable surface in the app goes through this, which is what makes
// press feedback consistent instead of "whatever that screen's author felt
// like". It provides four things RN's `Pressable` does not:
//
//   • a spring scale on the UI thread (never the JS thread — the chat screen
//     is mid-token-stream when most taps happen), suppressed under Reduce
//     Motion in favour of a plain opacity change,
//   • a haptic vocabulary tied to intent rather than to a raw API,
//   • an enforced platform-minimum hit target (44pt iOS / 48dp Android),
//   • a Material ripple on Android, which is the single loudest "this is a
//     real Android app" cue and costs one prop.
//
// `role` is a prop rather than a hardcoded `accessibilityRole="button"`. The
// old version baked the button role in ahead of the props spread, so every
// card, list row, chip, sheet scrim and grabber announced itself as a button
// — which is how a screen-reader user ends up in a UI made entirely of two
// hundred identical buttons.
// ────────────────────────────────────────────────────────────────

import React, { useCallback } from 'react';
import { Platform, type PressableProps, type ViewStyle } from 'react-native';
import { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { AnimatedPressable } from './animated';
import { PRESS_SCALE, PRESS_SCALE_LARGE, SPRING_PRESS, TIMING_FAST } from './motion';
import { haptics } from './haptics';
import { MIN_TARGET, useReduceMotion } from './accessibility';

export type HapticIntent = 'none' | 'select' | 'tap' | 'commit';

export interface TouchableProps extends Omit<PressableProps, 'style'> {
  /** `large` presses less, so a full-width card does not appear to shrink. */
  scale?: 'default' | 'large' | 'none';
  haptic?: HapticIntent;
  /**
   * Defaults to `button`. Pass the truthful one for rows, tabs and scrims.
   *
   * Named `a11yRole` rather than `role` because RN reserves `role` for the
   * narrower ARIA vocabulary, which has no `adjustable` or `none`.
   */
  a11yRole?: PressableProps['accessibilityRole'];
  /** Android ripple. Off for surfaces that are not visually contained. */
  ripple?: boolean;
  className?: string;
  style?: ViewStyle;
  children?: React.ReactNode;
}

export function Touchable({
  scale = 'default',
  haptic = 'tap',
  a11yRole = 'button',
  ripple = true,
  onPress,
  disabled,
  children,
  style,
  accessibilityState,
  hitSlop,
  ...rest
}: TouchableProps): React.ReactElement {
  const pressed = useSharedValue(0);
  const reduceMotion = useReduceMotion();

  const target = scale === 'large' ? PRESS_SCALE_LARGE : PRESS_SCALE;
  const scaleEnabled = scale !== 'none' && !reduceMotion;

  // The dimming for `disabled` belongs HERE, not in the static style array.
  // Reanimated writes its animated props straight onto the node, so an
  // `opacity` in the style array is overwritten by this worklet's own value
  // on the very first frame — every disabled control in the app was drawn at
  // full strength and only announced its state to a screen reader.
  const dim = disabled ? 0.4 : 1;
  const animatedStyle = useAnimatedStyle(
    () => ({
      transform: [{ scale: scaleEnabled ? 1 - pressed.value * (1 - target) : 1 }],
      opacity: dim - pressed.value * 0.12,
    }),
    [scaleEnabled, target, dim],
  );

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
      accessibilityRole={a11yRole}
      // Announcing the disabled state is what turns a dead control from
      // "silently does nothing" into "unavailable, and here is its label".
      accessibilityState={{ disabled: Boolean(disabled), ...accessibilityState }}
      disabled={disabled}
      // Restores the platform minimum around a control that is visually
      // smaller, without changing how the row lays out.
      hitSlop={hitSlop ?? Math.round((MIN_TARGET - 28) / 2)}
      android_ripple={
        ripple && Platform.OS === 'android' && !disabled
          ? { color: 'rgba(127,127,127,0.18)', foreground: true }
          : null
      }
      onPressIn={() => {
        pressed.value = reduceMotion ? withTiming(1, TIMING_FAST) : withSpring(1, SPRING_PRESS);
      }}
      onPressOut={() => {
        pressed.value = reduceMotion ? withTiming(0, TIMING_FAST) : withSpring(0, SPRING_PRESS);
      }}
      onPress={handlePress}
      style={[animatedStyle, style]}
      {...rest}
    >
      {children}
    </AnimatedPressable>
  );
}
