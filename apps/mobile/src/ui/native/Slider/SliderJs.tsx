// MP-25 Slider — the JS path (Jest, web, clients without Expo UI): a 4 pt track with the accent fill and a thumb,
// dragged or tapped through RNGH. iOS draws the raised system-like thumb; Android the accent M3 thumb.
import React, { useState } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { cn } from '../../lib/cn';
import { haptic } from '../../platform/haptics';
import { nativePlatform } from '../../platform/geometry';
import { Icon } from '../../primitives/Icon';
import { Text } from '../../primitives/Text';
import type { SliderProps } from './Slider.types';
import { adjustStep, crossedStop, sliderFraction, sliderValueAt, snapSlider } from './sliderModel';

/**
 * The row every Slider path shares: optional min / max glyphs, the track (native or drawn), the trailing mono value,
 * and one adjustable element for assistive tech (the native host is hidden from it). A stepped slider ticks
 * `selection` at each stop.
 */
export function SliderFrame({ props, track }: { props: SliderProps; track: (onChange: (v: number) => void) => React.ReactElement }): React.ReactElement {
  const { value, min, max, step, onValueChange, label, valueText, minIcon, maxIcon, disabled = false, testID } = props;
  const change = (next: number): void => {
    const v = snapSlider(next, min, max, step);
    if (crossedStop(value, v, step)) haptic('selection');
    if (v !== value) onValueChange(v);
  };
  const text = valueText ? valueText(value) : String(Math.round(value * 100) / 100);
  const delta = adjustStep(min, max, step);
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min, max, now: value, text }}
      accessibilityState={{ disabled }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => !disabled && change(value + (e.nativeEvent.actionName === 'increment' ? delta : -delta))}
      className="min-h-hit flex-row items-center gap-3"
    >
      {minIcon ? <Icon concept={minIcon} size={14} tone="fg-3" /> : null}
      <View className="flex-1" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {track(change)}
      </View>
      {maxIcon ? <Icon concept={maxIcon} size={20} tone="fg-3" /> : null}
      {valueText ? (
        <Text role="mono" tone="fg-2" chrome className="min-w-10" align="end">
          {text}
        </Text>
      ) : null}
    </View>
  );
}

export function SliderTrack({ value, min, max, step, onValueChange, onSlidingComplete, disabled = false }: Omit<SliderProps, 'label'>): React.ReactElement {
  const [width, setWidth] = useState(0);
  const set = (x: number): void => {
    const next = sliderValueAt(x, width, min, max, step);
    if (next !== value) onValueChange(next);
  };
  const pan = Gesture.Pan()
    .enabled(!disabled)
    .runOnJS(true)
    .minDistance(0)
    .onBegin((e) => set(e.x))
    .onUpdate((e) => set(e.x))
    .onFinalize(() => onSlidingComplete?.(value));
  const fraction = sliderFraction(value, min, max);
  const android = nativePlatform === 'android';
  return (
    <GestureDetector gesture={pan}>
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} className={cn('min-h-hit flex-1 justify-center', disabled && 'opacity-40')}>
        <View className="h-1 overflow-hidden rounded-full bg-line-strong">
          <View className="h-1 bg-accent" style={{ width: fraction * width }} />
        </View>
        <View
          pointerEvents="none"
          className={cn('absolute size-6 rounded-full', android ? 'bg-accent' : 'border border-line bg-raised shadow-float')}
          style={{ start: Math.max(0, fraction * width - 12) }}
        />
      </View>
    </GestureDetector>
  );
}

export function SliderJs(props: SliderProps): React.ReactElement {
  return <SliderFrame props={props} track={(change) => <SliderTrack {...props} onValueChange={change} />} />;
}
