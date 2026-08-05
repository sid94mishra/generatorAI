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
//
// `swipeable` attaches a horizontal pan so the *content* below can be swiped
// between peers, which is what a fluent user tries first on both platforms.
// The gesture is exposed rather than owned because only the screen knows
// which view is underneath.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useState } from 'react';
import { Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { Touchable } from './Touchable';
import { SPRING_SHEET } from './motion';
import { MAX_SCALE, useFontScale } from './accessibility';
import { haptics } from './haptics';

export interface Segment<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
  /** Small count shown after the label — e.g. "Runs 12". */
  count?: number;
}

/**
 * Move to the neighbouring segment.
 *
 * Exported so a screen can bind a swipe on its content to the same
 * transition the control performs, without reimplementing wrap-avoidance.
 */
export function stepSegment<T extends string>(
  segments: ReadonlyArray<Segment<T>>,
  value: T,
  direction: 1 | -1,
): T | null {
  const index = segments.findIndex((s) => s.value === value);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= segments.length) return null;
  return segments[next]!.value;
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
  const fontScale = useFontScale();

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

  // Past ~1.3× the labels stop fitting three-across. Dropping to icons is
  // worse than dropping the counts, so the counts go first.
  const showCounts = fontScale <= 1.3;

  return (
    <View
      className={`min-h-10 rounded-full bg-subtle p-1 ${className}`}
      accessibilityRole="tablist"
    >
      {/* The measured box must be the CONTENT box, not the padded one: sizing
          the indicator from the outer width made the last slot overhang the
          container by exactly the horizontal padding. */}
      <View onLayout={onLayout} className="flex-row">
        {slot > 0 ? (
          <Animated.View
            pointerEvents="none"
            className="absolute bottom-0 top-0 rounded-full bg-card"
            style={indicatorStyle}
          />
        ) : null}

      {segments.map((segment) => {
        const selected = segment.value === value;
        const count = segment.count;
        return (
          <Touchable
            key={segment.value}
            a11yRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={
              count !== undefined && count > 0 ? `${segment.label}, ${count}` : segment.label
            }
            haptic="select"
            ripple={false}
            scale="none"
            onPress={() => onChange(segment.value)}
            className="min-h-8 flex-1 flex-row items-center justify-center gap-1.5 rounded-full py-1"
          >
            {segment.icon}
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={MAX_SCALE.chrome}
              className={`text-sm font-semibold ${selected ? 'text-foreground' : 'text-muted-foreground'}`}
            >
              {segment.label}
            </Text>
            {showCounts && count !== undefined && count > 0 ? (
              <View className="min-w-5 items-center rounded-full bg-emphasis px-1">
                <Text
                  maxFontSizeMultiplier={MAX_SCALE.chrome}
                  className="text-xs font-semibold text-muted-foreground"
                >
                  {count}
                </Text>
              </View>
            ) : null}
          </Touchable>
        );
      })}
      </View>
    </View>
  );
}

/**
 * Bind horizontal swipes on a content area to a segmented control.
 *
 * Returns the handler pair for a `Gesture.Pan()` built by the caller, so the
 * screen keeps control of gesture composition (a transcript, for instance,
 * must not lose its vertical scroll to this).
 */
export function useSegmentSwipe<T extends string>(
  segments: ReadonlyArray<Segment<T>>,
  value: T,
  onChange: (next: T) => void,
): (translationX: number) => void {
  return useCallback(
    (translationX: number) => {
      const direction = translationX < 0 ? 1 : -1;
      const next = stepSegment(segments, value, direction);
      if (!next) return;
      haptics.select();
      onChange(next);
    },
    [segments, value, onChange],
  );
}
