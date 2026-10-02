// MP-03 Pressable — the base of every tappable kit part (03 MP-03). The frame reaches the platform hit target
// (MD-91); iOS presses by scale (buttons) or highlight (rows), Android by ripple (02 §6.2 `press`).
import React, { useCallback, useState } from 'react';
import type { AccessibilityActionEvent, GestureResponderEvent } from 'react-native';
import { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { AnimatedPressable } from '../../lib/animated';
import { cn } from '../../lib/cn';
import { useThemeColors } from '../../lib/themeColors';
import { haptic as playHaptic } from '../../platform/haptics';
import { useMotion } from '../../platform/motion';
import { pressFeedback } from '../../platform/pressFeedback';
import type { PressableProps } from './Pressable.types';

export type { PressableProps, PressFeedback } from './Pressable.types';

export function Pressable({
  onPress,
  onLongPress,
  delayLongPress = 400,
  disabled = false,
  disabledReason,
  feedback = 'highlight',
  haptic,
  accessibilityRole = 'button',
  accessibilityLabel,
  accessibilityHint,
  accessibilityState,
  accessibilityActions,
  onAccessibilityAction,
  hitSlop,
  frame = 'hit',
  large = false,
  borderless = false,
  className,
  testID,
  children,
}: PressableProps): React.ReactElement {
  const colors = useThemeColors();
  const motion = useMotion('press');
  const kind = pressFeedback(feedback);
  const [highlighted, setHighlighted] = useState(false);
  const pressed = useSharedValue(0);
  const target = large ? (motion.pressScale?.large ?? 1) : (motion.pressScale?.default ?? 1);
  const scales = kind === 'scale' && !motion.reduced;
  // Reduce Motion on iOS: no scale; the highlight is an instant opacity (02 §6.2).
  const dims = kind === 'scale' && motion.reduced;
  const animated = useAnimatedStyle(
    () => ({
      transform: [{ scale: scales ? 1 - pressed.value * (1 - target) : 1 }],
      opacity: dims ? 1 - pressed.value * 0.3 : 1,
    }),
    [scales, dims, target],
  );

  const spring = motion.spatial?.type === 'spring' ? motion.spatial.config : undefined;
  const pressIn = useCallback(() => {
    if (kind === 'highlight') setHighlighted(true);
    pressed.set(spring ? withSpring(1, spring) : withTiming(1, { duration: 0 }));
    if (haptic === 'selection') playHaptic('selection');
  }, [kind, pressed, spring, haptic]);
  const pressOut = useCallback(() => {
    setHighlighted(false);
    pressed.set(spring ? withSpring(0, spring) : withTiming(0, { duration: 0 }));
  }, [pressed, spring]);
  const press = useCallback(
    (_e: GestureResponderEvent) => {
      if (haptic && haptic !== 'selection') playHaptic(haptic);
      onPress?.();
    },
    [haptic, onPress],
  );
  const accessibilityAction = useCallback(
    (e: AccessibilityActionEvent) => onAccessibilityAction?.(e.nativeEvent.actionName),
    [onAccessibilityAction],
  );

  const hint = [accessibilityHint, disabled ? disabledReason : undefined].filter(Boolean).join('. ') || undefined;
  return (
    <AnimatedPressable
      testID={testID}
      onPress={press}
      onPressIn={pressIn}
      onPressOut={pressOut}
      onLongPress={onLongPress}
      delayLongPress={delayLongPress}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={hint}
      accessibilityState={{ ...accessibilityState, disabled }}
      accessibilityActions={accessibilityActions as AccessibilityActionInfoList}
      onAccessibilityAction={onAccessibilityAction ? accessibilityAction : undefined}
      android_ripple={rippleFor(kind, disabled, colors.selected, borderless)}
      className={cn(frame === 'hit' && 'min-h-hit min-w-hit items-center justify-center', highlighted && 'bg-selected', className)}
      style={animated}
    >
      {children}
    </AnimatedPressable>
  );
}

/** The Android ripple config for a feedback kind (exported for tests). */
export function rippleFor(
  kind: ReturnType<typeof pressFeedback>,
  disabled: boolean,
  color: string,
  borderless: boolean,
): { color: string; borderless: boolean; foreground: true } | undefined {
  return kind === 'ripple' && !disabled ? { color, borderless, foreground: true } : undefined;
}

type AccessibilityActionInfoList = { name: string; label?: string }[];
