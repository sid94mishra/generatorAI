// ────────────────────────────────────────────────────────────────
// Skeleton — the loading state.
//
// A spinner tells the user to wait; a skeleton tells them what is coming and
// stops the layout jumping when it does. Every list in the app replaces its
// spinner with a skeleton shaped like its own rows.
//
// One shared looping opacity animation per skeleton element, on the UI
// thread. The loop is cheap, but screens still cap themselves at ~6 rows —
// beyond that the shimmer is noise, not information.
// ────────────────────────────────────────────────────────────────

import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

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
  const pulse = useSharedValue(0.45);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [pulse]);

  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={`bg-emphasis ${className}`}
      style={[style, { width: width ?? '100%', height, borderRadius: radius }]}
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

export function SkeletonList({ rows = 5 }: { rows?: number }): React.ReactElement {
  return (
    <View className="overflow-hidden rounded-3xl border border-border bg-card">
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
