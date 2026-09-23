// ────────────────────────────────────────────────────────────────
// Collapsible — a body that eases open and closed.
//
// The body is measured in an absolutely positioned inner view, and the outer
// view's HEIGHT animates from 0 to that measurement (and back), with the
// opacity riding along. Only this view's own size changes, so a virtualised
// list around it simply re-measures the row each frame and the rows below
// glide, instead of a layout transition fighting the list's own positioning
// (which is what made neighbouring rows bounce).
//
// Closing plays the animation first and unmounts the body after, so a heavy
// body (a diff, a long step list) costs nothing while closed. Under reduced
// motion (OS switch or app preference) it opens and closes in place.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useState } from 'react';
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { useReduceMotion } from './accessibility';

const OPEN_MS = 240;
const CLOSE_MS = 190;
const EASE = Easing.bezier(0.2, 0, 0, 1);

export function Collapsible({
  open,
  children,
  className,
  style,
}: {
  open: boolean;
  children: React.ReactNode;
  className?: string;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement | null {
  const reduce = useReduceMotion();
  const [mounted, setMounted] = useState(open);
  const progress = useSharedValue(open ? 1 : 0);
  const measured = useSharedValue(0);

  useEffect(() => {
    if (reduce) {
      progress.value = open ? 1 : 0;
      setMounted(open);
      return;
    }
    if (open) {
      setMounted(true);
      progress.value = withTiming(1, { duration: OPEN_MS, easing: EASE });
    } else {
      progress.value = withTiming(0, { duration: CLOSE_MS, easing: EASE }, (finished) => {
        if (finished) runOnJS(setMounted)(false);
      });
    }
  }, [open, reduce, progress]);

  const animated = useAnimatedStyle(() => ({
    height: measured.value * progress.value,
    opacity: progress.value,
  }));

  if (!mounted) return null;
  if (reduce) {
    return (
      <View className={className} style={style}>
        {children}
      </View>
    );
  }
  return (
    <Animated.View style={[{ overflow: 'hidden' }, animated]}>
      <View
        className={className}
        style={[{ position: 'absolute', top: 0, left: 0, right: 0 }, style]}
        onLayout={(e: LayoutChangeEvent) => {
          measured.value = e.nativeEvent.layout.height;
        }}
      >
        {children}
      </View>
    </Animated.View>
  );
}

/** A chevron that turns (right → down) instead of swapping glyphs. */
export function useChevronTurn(open: boolean) {
  const reduce = useReduceMotion();
  const turn = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    turn.value = reduce ? (open ? 1 : 0) : withTiming(open ? 1 : 0, { duration: OPEN_MS, easing: EASE });
  }, [open, reduce, turn]);
  return useAnimatedStyle<ViewStyle>(() => ({ transform: [{ rotate: `${turn.value * 90}deg` }] }));
}
