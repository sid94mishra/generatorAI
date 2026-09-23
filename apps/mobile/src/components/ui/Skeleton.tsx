// ────────────────────────────────────────────────────────────────
// Skeleton — the loading state.
//
// A spinner tells the user to wait; a skeleton tells them what is coming and
// stops the layout jumping when it does.
//
// ONE clock drives every skeleton in the app. The previous version started an
// independent `withRepeat` per element, so a six-row list ran eighteen
// unsynchronised loops that visibly beat against each other — the effect read
// as flickering rather than as breathing. A single module-level shared value
// also means Reduce Motion is honoured in one place.
// ────────────────────────────────────────────────────────────────

import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  makeMutable,
  useAnimatedStyle,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useReduceMotion } from './accessibility';

const pulse = makeMutable(0.45);
let subscribers = 0;

function retain(): void {
  subscribers += 1;
  if (subscribers > 1) return;
  pulse.value = withRepeat(
    withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
    -1,
    true,
  );
}

function release(): void {
  subscribers = Math.max(0, subscribers - 1);
  if (subscribers > 0) return;
  cancelAnimation(pulse);
  pulse.value = 0.45;
}

export function Skeleton({
  width,
  height = 12,
  radius = 6,
  className = '',
}: {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  className?: string;
}): React.ReactElement {
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    if (reduceMotion) return;
    retain();
    return release;
  }, [reduceMotion]);

  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={`bg-emphasis ${className}`}
      style={[
        reduceMotion ? { opacity: 0.6 } : style,
        { width: width ?? '100%', height, borderRadius: radius },
      ]}
    />
  );
}

/** Matches the geometry of a `ListRow` so nothing shifts on load. */
export function SkeletonRow(): React.ReactElement {
  return (
    <View className="min-h-14 flex-row items-center gap-3 px-4 py-2.5">
      <Skeleton width={36} height={36} radius={12} />
      <View className="flex-1 gap-2">
        <Skeleton width="55%" height={13} />
        <Skeleton width="80%" height={11} />
      </View>
    </View>
  );
}

/** Matches a flat `ListItem` (64pt, 16pt gutter, 64pt-inset hairline). */
export function SkeletonListItem(): React.ReactElement {
  return (
    <View>
      <View className="min-h-16 flex-row items-center gap-3 px-4 py-2.5">
        <Skeleton width={36} height={36} radius={12} />
        <View className="flex-1 gap-2">
          <Skeleton width="55%" height={14} />
          <Skeleton width="80%" height={12} />
        </View>
      </View>
      <View className="ml-[52px] h-px bg-border-muted" />
    </View>
  );
}

export function SkeletonList({
  rows = 5,
  variant = 'grouped',
}: {
  rows?: number;
  /** `flat` matches the tab lists' `ListItem`; `grouped` a `ListGroup` card. */
  variant?: 'grouped' | 'flat';
}): React.ReactElement {
  if (variant === 'flat') {
    return (
      <View accessible accessibilityLabel="Loading" accessibilityRole="progressbar">
        {Array.from({ length: rows }, (_, i) => (
          <SkeletonListItem key={i} />
        ))}
      </View>
    );
  }
  return (
    <View
      accessible
      accessibilityLabel="Loading"
      accessibilityRole="progressbar"
      className="overflow-hidden rounded-3xl border border-border bg-card"
    >
      {Array.from({ length: rows }, (_, i) => (
        <View key={i}>
          {i > 0 ? <View className="ml-4 h-px bg-border-muted" /> : null}
          <SkeletonRow />
        </View>
      ))}
    </View>
  );
}

/** Card-shaped placeholder for the Activity stat rail. */
export function SkeletonCard({ height = 84 }: { height?: number }): React.ReactElement {
  return <Skeleton height={height} radius={16} />;
}
