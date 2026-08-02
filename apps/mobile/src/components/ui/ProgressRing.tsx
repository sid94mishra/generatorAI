// ────────────────────────────────────────────────────────────────
// ProgressRing — the context-window gauge.
//
// Mirrors the web's `ContextUsageGauge`: same thresholds, same colours, so a
// user who has seen the desktop reads the phone the same way. Drawn with SVG
// rather than Skia because it is one static arc and pulling in a GPU canvas
// for that costs a frame on mount for no gain.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { useTheme } from '../../theme/ThemeProvider';

/** Web parity: green under 60%, amber under 80%, red above. */
export function usageTone(ratio: number): 'success' | 'warning' | 'danger' {
  if (ratio >= 0.8) return 'danger';
  if (ratio >= 0.6) return 'warning';
  return 'success';
}

export function ProgressRing({
  ratio,
  size = 22,
  stroke = 2.5,
  label,
}: {
  /** 0..1. Values outside are clamped, since a provider can over-report. */
  ratio: number;
  size?: number;
  stroke?: number;
  label?: string;
}): React.ReactElement {
  const { colors } = useTheme();
  const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  const tone = usageTone(clamped);
  const color = colors[tone] ?? colors.primary;

  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <View className="flex-row items-center gap-1.5">
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={colors['border-muted']}
          strokeWidth={stroke}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - clamped)}
          // Start the arc at 12 o'clock instead of 3 o'clock.
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {label ? <Text className="text-xs text-muted-foreground">{label}</Text> : null}
    </View>
  );
}

/** Horizontal variant, used inside sheets where a ring is too small to read. */
export function ProgressBar({ ratio }: { ratio: number }): React.ReactElement {
  const { colors } = useTheme();
  const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  const color = colors[usageTone(clamped)] ?? colors.primary;

  return (
    <View className="h-2 w-full overflow-hidden rounded-full bg-emphasis">
      <View
        style={{ width: `${clamped * 100}%`, backgroundColor: color }}
        className="h-full rounded-full"
      />
    </View>
  );
}
