// Shared, JSX-free parts of the Icon platform files: tone → literal colour,
// accessibility props, and the spinning rotation (mobile 02 §5.3 rules 4–5).
import { useEffect } from 'react';
import type { ViewProps, ViewStyle } from 'react-native';
import { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useReduceMotion } from '../../platform/motion';

import { useThemeColors, type ThemeColors } from '../../lib/themeColors';
import type { IconTone } from './Icon.types';

/** Icon tone → design token (02 §5.3 IconTone). */
const TONE_TOKEN = {
  fg: 'fg',
  'fg-2': 'fg2',
  'fg-3': 'fg3',
  accent: 'accent',
  'on-accent': 'onAccent',
  run: 'run',
  ok: 'ok',
  warn: 'warn',
  err: 'err',
  surface: 'surface',
} as const satisfies Record<IconTone, keyof ThemeColors>;

/** Literal colour of a tone for native glyph hosts (SF tint, Material font, SVG fill). */
export function useIconColor(tone: IconTone): string {
  return useThemeColors()[TONE_TOKEN[tone]];
}

/** Decorative unless labelled (mobile 02 §5.3). */
export function iconA11yProps(label: string | undefined): ViewProps {
  return label
    ? { accessible: true, accessibilityRole: 'image', accessibilityLabel: label }
    : { accessible: false, importantForAccessibility: 'no-hide-descendants', accessibilityElementsHidden: true };
}

/** Rotation for `spinning`; undefined (no animation) when off or under reduced motion. */
export function useSpinStyle(spinning: boolean): ReturnType<typeof useAnimatedStyle<ViewStyle>> | undefined {
  const reduced = useReduceMotion();
  const turn = useSharedValue(0);
  const active = spinning && !reduced;
  useEffect(() => {
    if (!active) {
      cancelAnimation(turn);
      turn.value = 0;
      return undefined;
    }
    turn.value = withRepeat(withTiming(360, { duration: 1000, easing: Easing.linear }), -1);
    return () => cancelAnimation(turn);
  }, [active, turn]);
  const style = useAnimatedStyle<ViewStyle>(() => ({ transform: [{ rotate: `${turn.value}deg` }] }));
  return active ? style : undefined;
}
