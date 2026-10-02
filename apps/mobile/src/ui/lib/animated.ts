// ────────────────────────────────────────────────────────────────
// Uniwind and Reanimated components (MD-10, MD-115; mobile 02 §9.5).
//
// Uniwind's Metro resolver swaps every `react-native` component import —
// including the ones inside react-native-reanimated — for its className-aware
// version, so `<Animated.View className=…>` needs no registration (the
// NativeWind-era `cssInterop` registry and its animated-style "sink" are gone).
//
// `AnimatedPressable` is wrapped with `withUniwind` so its className resolves
// in front of the Reanimated wrapper and merges with the animated `style`
// (className first, style last) — the combination the M1-08 spike verified.
// ────────────────────────────────────────────────────────────────

import { Pressable } from 'react-native';
import Animated from 'react-native-reanimated';
import { withUniwind } from 'uniwind';

export const AnimatedPressable = withUniwind(Animated.createAnimatedComponent(Pressable));
