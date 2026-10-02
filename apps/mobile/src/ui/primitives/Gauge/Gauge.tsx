// MP-41 Gauge (03 MP-41): a 4 pt ring; fg-2 below 80 %, warn to 95 %, err above (the one non-status use of warn/err,
// web B-13). The value itself is shown by the owning row.
import React from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { useThemeColors, type ThemeColors } from '../../lib/themeColors';
import { clampProgress } from '../ProgressBar';
import type { GaugeProps } from './Gauge.types';

export type { GaugeProps } from './Gauge.types';

export function gaugeTone(value: number): keyof Pick<ThemeColors, 'fg2' | 'warn' | 'err'> {
  if (value > 0.95) return 'err';
  if (value >= 0.8) return 'warn';
  return 'fg2';
}

const STROKE = 4;

export function Gauge({ value, size = 32, label, testID }: GaugeProps): React.ReactElement {
  const colors = useThemeColors();
  const v = clampProgress(value);
  const r = (size - STROKE) / 2;
  const circumference = 2 * Math.PI * r;
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(v * 100) }}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.lineStrong} strokeWidth={STROKE} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colors[gaugeTone(v)]}
          strokeWidth={STROKE}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference * v} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
    </View>
  );
}
