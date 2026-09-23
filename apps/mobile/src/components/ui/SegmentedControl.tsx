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
// `useSegmentSwipe` binds a horizontal pan on the *content* below so it can
// be swiped between peers, which is what a fluent user tries first on both
// platforms. The gesture is exposed rather than owned because only the screen
// knows which view is underneath; a screen that uses `Pager` can instead
// hand it `progress` and let the indicator track the pages 1:1.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';

import { Touchable } from './Touchable';
import { useReducedMotionPreset } from './motion';
import { MAX_SCALE, MIN_TARGET, useFontScale, useReduceMotion } from './accessibility';
import { haptics } from './haptics';
import { segmentLayout } from './segmentLayout';
import { useTheme } from '../../theme/ThemeProvider';

export interface Segment<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
  /** Small count shown after the label — e.g. "Runs 12". */
  count?: number;
  /** A live dot after the label, for state that has no useful number. */
  live?: boolean;
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
  haptic = true,
  progress,
  accessibilityLabel,
}: {
  segments: ReadonlyArray<Segment<T>>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
  /** Selection haptic on tap. Off when the parent already fires one. */
  haptic?: boolean;
  /**
   * A continuous 0..n-1 position (from `Pager`) that the indicator follows
   * on the UI thread. When supplied, the indicator tracks the finger during a
   * page drag instead of jumping once the page settles.
   */
  progress?: SharedValue<number>;
  accessibilityLabel?: string;
}): React.ReactElement {
  const [width, setWidth] = useState(0);
  const offset = useSharedValue(0);
  const scroller = useRef<ScrollView>(null);
  const reduceMotion = useReduceMotion();
  const fontScale = useFontScale();
  const presets = useReducedMotionPreset();
  const { colors } = useTheme();
  // Desktop's FilterTabs: a hairline-bordered track and a solid
  // `primary-emphasis` pill with `primary-foreground` text. Token-driven, so
  // every theme and appearance gets its own accent rather than a grey pill.
  const indicatorColor = colors['primary-emphasis'] ?? colors.primary;

  const index = Math.max(
    0,
    segments.findIndex((s) => s.value === value),
  );
  const { slot, contentWidth, scrollable } = segmentLayout(segments, width, fontScale);
  useEffect(() => {
    scroller.current?.scrollTo({
      x: Math.max(0, Math.min(index * slot - (width - slot) / 2, contentWidth - width)),
      animated: !reduceMotion,
    });
  }, [index, slot, width, contentWidth, reduceMotion]);

  useEffect(() => {
    if (slot === 0 || progress) return;
    offset.value = withSpring(index * slot, presets.springSheet);
  }, [index, slot, offset, presets, progress]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setWidth(e.nativeEvent.layout.width);
  }, []);

  // Width is plain layout (it changes only when the control is measured), so
  // it lives in the regular style below. Inside the animated style it stayed
  // at its first value, 0, on native — the pill rendered as a 2px sliver.
  const indicatorStyle = useAnimatedStyle(
    () => ({
      transform: [{ translateX: progress ? progress.value * slot : offset.value }],
    }),
    [slot, progress],
  );


  return (
    <View
      // 44pt tall, not 40: this is a primary control on the chat screen and
      // it shares the row with nothing else, so the platform minimum is the
      // right floor rather than the desktop segmented-control's 32.
      className={`min-h-11 rounded-xl border border-border p-1 ${className}`}
      accessibilityRole="tablist"
      {...(accessibilityLabel ? { accessibilityLabel } : {})}
    >
      {/* The measured box must be the CONTENT box, not the padded one: sizing
          the indicator from the outer width made the last slot overhang the
          container by exactly the horizontal padding. */}
      <ScrollView
        ref={scroller}
        horizontal
        style={{ flexGrow: 0 }}
        onLayout={onLayout}
        scrollEnabled={scrollable}
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ width: contentWidth }}
      >
      <View style={{ width: contentWidth, flexDirection: 'row' }}>
        {slot > 0 ? (
          <Animated.View
            pointerEvents="none"
            className="absolute bottom-0 top-0 rounded-lg"
            style={[indicatorStyle, { backgroundColor: indicatorColor, width: slot }]}
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
                count !== undefined && count > 0
                  ? `${segment.label}, ${count}`
                  : segment.live
                    ? `${segment.label}, running`
                    : segment.label
              }
              haptic={haptic ? 'select' : 'none'}
              ripple={false}
              scale="none"
              onPress={() => onChange(segment.value)}
              hitSlop={0}
              style={{ width: slot, minHeight: MIN_TARGET }}
              className="flex-row items-center justify-center gap-1.5 rounded-lg px-3 py-1"
            >
              {segment.icon}
              <Text
                numberOfLines={1}
                maxFontSizeMultiplier={MAX_SCALE.chrome}
                className={`text-sm font-semibold ${selected ? 'text-primary-foreground' : 'text-muted-foreground'}`}
              >
                {segment.label}
              </Text>
              {segment.live ? (
                <View accessible={false} className="h-1.5 w-1.5 rounded-full bg-success" />
              ) : null}
              {count !== undefined && count > 0 ? (
                // Desktop's FilterTabs: the count is plain text after the label.
                <Text
                  maxFontSizeMultiplier={MAX_SCALE.chrome}
                  className={`text-xs font-semibold ${selected ? 'text-primary-foreground opacity-80' : 'text-muted-foreground opacity-80'}`}
                >
                  {count}
                </Text>
              ) : null}
            </Touchable>
          );
        })}
      </View>
      </ScrollView>
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
