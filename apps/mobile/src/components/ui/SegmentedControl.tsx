// ────────────────────────────────────────────────────────────────
// SegmentedControl — peer views inside one screen.
//
// The selected indicator is a single absolutely-positioned view that springs
// between slots, rather than each segment animating its own background. That
// is what produces the continuous "the pill moved" reading instead of "one
// thing faded out while another faded in".
//
// Measured from the container's own layout rather than from a fixed width,
// because the Workbench header and the Activity filter have different widths
// and neither knows the screen size at build time.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useState } from 'react';
import { Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { Touchable } from './Touchable';
import { SPRING_SHEET } from './motion';

export interface Segment<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
  /** Small count shown after the label — e.g. "Runs 12". */
  count?: number;
}

export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  className = '',
}: {
  segments: ReadonlyArray<Segment<T>>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
}): React.ReactElement {
  const [width, setWidth] = useState(0);
  const offset = useSharedValue(0);

  const index = Math.max(
    0,
    segments.findIndex((s) => s.value === value),
  );
  const slot = width > 0 ? width / segments.length : 0;

  useEffect(() => {
    if (slot === 0) return;
    offset.value = withSpring(index * slot, SPRING_SHEET);
  }, [index, slot, offset]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setWidth(e.nativeEvent.layout.width);
  }, []);

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
    width: slot,
  }));

  return (
    <View
      onLayout={onLayout}
      className={`h-10 flex-row rounded-full bg-subtle p-1 ${className}`}
      accessibilityRole="tablist"
    >
      {slot > 0 ? (
        <Animated.View
          pointerEvents="none"
          className="absolute bottom-1 top-1 rounded-full bg-card"
          style={indicatorStyle}
        />
      ) : null}

      {segments.map((segment) => {
        const selected = segment.value === value;
        return (
          <Touchable
            key={segment.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={segment.label}
            haptic="select"
            scale="none"
            onPress={() => onChange(segment.value)}
            className="flex-1 flex-row items-center justify-center gap-1.5"
          >
            {segment.icon}
            <Text
              numberOfLines={1}
              className={`text-sm font-semibold ${selected ? 'text-foreground' : 'text-muted-foreground'}`}
            >
              {segment.label}
            </Text>
            {segment.count !== undefined && segment.count > 0 ? (
              <View className="min-w-5 items-center rounded-full bg-emphasis px-1">
                <Text className="text-xs font-semibold text-muted-foreground">{segment.count}</Text>
              </View>
            ) : null}
          </Touchable>
        );
      })}
    </View>
  );
}
