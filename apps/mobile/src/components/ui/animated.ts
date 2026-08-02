// ────────────────────────────────────────────────────────────────
// NativeWind interop for Reanimated components.
//
// NativeWind only translates `className` → `style` for components it has been
// told about. Core primitives (View, Text, Pressable…) are registered by its
// preset; anything produced by `Animated.createAnimatedComponent` is not, and
// on those the className is silently DROPPED.
//
// The symptom is not a crash — it is layout that quietly collapses. The
// segmented control rendered all three labels on top of each other because
// `flex-1` never reached the animated pressable, and every animated card lost
// its padding and background.
//
// Registering here, imported once from the design-system barrel, means a new
// animated component cannot be added without also being registered.
// ────────────────────────────────────────────────────────────────

import { Pressable } from 'react-native';
import Animated from 'react-native-reanimated';
import { cssInterop } from 'nativewind';

export const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

cssInterop(AnimatedPressable, { className: 'style' });
cssInterop(Animated.View, { className: 'style' });
cssInterop(Animated.Text, { className: 'style' });
cssInterop(Animated.ScrollView, {
  className: 'style',
  contentContainerClassName: 'contentContainerStyle',
});
