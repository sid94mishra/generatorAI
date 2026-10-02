// MP-14 ProgressBar (03 MP-14): a 4 pt meter track; determinate fill or a sliding 30 % segment (static under
// Reduce Motion).
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { cn } from '../../lib/cn';
import { useReduceMotion } from '../../platform/motion';
import { Text } from '../Text';
import type { ProgressBarProps } from './ProgressBar.types';

export type { ProgressBarProps } from './ProgressBar.types';

export const clampProgress = (value: number): number => Math.min(1, Math.max(0, value));

export function ProgressBar({ value, tone = 'run', label, valueText, accessibilityLabel, testID }: ProgressBarProps): React.ReactElement {
  const reduced = useReduceMotion();
  const [width, setWidth] = useState(0);
  const offset = useSharedValue(0);
  const indeterminate = value === undefined;
  useEffect(() => {
    if (!indeterminate || reduced || width === 0) {
      cancelAnimation(offset);
      offset.set(0);
      return undefined;
    }
    offset.set(withRepeat(withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }), -1));
    return () => cancelAnimation(offset);
  }, [indeterminate, reduced, width, offset]);
  const sliding = useAnimatedStyle(() => ({ transform: [{ translateX: offset.get() * width * 0.7 }] }), [width]);
  const fill = tone === 'neutral' ? 'bg-fg-2' : 'bg-run';
  const now = indeterminate ? undefined : Math.round(clampProgress(value) * 100);
  return (
    <View testID={testID} className="gap-1.5">
      {label || valueText ? (
        <View className="flex-row items-center justify-between">
          {label ? <Text role="footnote" tone="fg-2">{label}</Text> : <View />}
          {valueText ? <Text role="monoSm" tone="fg-2">{valueText}</Text> : null}
        </View>
      ) : null}
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityValue={now === undefined ? undefined : { min: 0, max: 100, now }}
        accessibilityState={{ busy: indeterminate }}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        className="h-meter overflow-hidden rounded-full"
      >
        <View className="absolute inset-0 bg-line-strong opacity-40" />
        {indeterminate ? (
          <Animated.View className={cn('h-meter w-3/10 rounded-full', fill)} style={sliding} />
        ) : (
          <View className={cn('h-meter rounded-full', fill)} style={{ width: `${(now ?? 0)}%` }} />
        )}
      </View>
    </View>
  );
}
