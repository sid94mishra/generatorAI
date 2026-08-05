// ────────────────────────────────────────────────────────────────
// ProgressRing — the context-window gauge.
//
// Mirrors the web's `ContextUsageGauge`: same thresholds, same colours, so a
// user who has seen the desktop reads the phone the same way. Drawn with SVG
// rather than Skia because it is one arc and pulling in a GPU canvas for that
// costs a frame on mount for no gain.
//
// The arc animates its own fill. During a turn the ratio climbs steadily, and
// a gauge that jumps between discrete values reads as broken data rather than
// as consumption. The animation runs on the UI thread, which matters because
// the value changes while tokens are streaming on the JS thread.
// ────────────────────────────────────────────────────────────────

import React, { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  useAnimatedProps,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { TIMING } from './motion';
import { MAX_SCALE } from './accessibility';
import { useTheme } from '../../theme/ThemeProvider';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Web parity: green under 60%, amber under 80%, red above. */
export function usageTone(ratio: number): 'success' | 'warning' | 'danger' {
  if (ratio >= 0.8) return 'danger';
  if (ratio >= 0.6) return 'warning';
  return 'success';
}

function clamp(ratio: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
}

export function ProgressRing({
  ratio,
  size = 22,
  stroke = 2.5,
  label,
  accessibilityLabel = 'Context usage',
}: {
  /** 0..1. Values outside are clamped, since a provider can over-report. */
  ratio: number;
  size?: number;
  stroke?: number;
  label?: string;
  accessibilityLabel?: string;
}): React.ReactElement {
  const { colors } = useTheme();
  const clamped = clamp(ratio);
  const tone = usageTone(clamped);
  const color = colors[tone] ?? colors.primary;

  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  const progress = useSharedValue(clamped);
  useEffect(() => {
    progress.value = withTiming(clamped, TIMING);
  }, [clamped, progress]);

  const offset = useDerivedValue(() => circumference * (1 - progress.value));
  const animatedProps = useAnimatedProps(() => ({ strokeDashoffset: offset.value }));

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      className="flex-row items-center gap-1.5"
    >
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={colors['border-muted']}
          strokeWidth={stroke}
          fill="none"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          animatedProps={animatedProps}
          // Start the arc at 12 o'clock instead of 3 o'clock.
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {label ? (
        <Text maxFontSizeMultiplier={MAX_SCALE.chrome} className="text-xs text-muted-foreground">
          {label}
        </Text>
      ) : null}
    </View>
  );
}

/** Horizontal variant, used inside sheets where a ring is too small to read. */
export function ProgressBar({
  ratio,
  accessibilityLabel = 'Progress',
}: {
  ratio: number;
  accessibilityLabel?: string;
}): React.ReactElement {
  const { colors } = useTheme();
  const clamped = clamp(ratio);
  const color = colors[usageTone(clamped)] ?? colors.primary;

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      className="h-2 w-full overflow-hidden rounded-full bg-emphasis"
    >
      <View
        style={{ width: `${clamped * 100}%`, backgroundColor: color }}
        className="h-full rounded-full"
      />
    </View>
  );
}
