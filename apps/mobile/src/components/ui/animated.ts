// ────────────────────────────────────────────────────────────────
// NativeWind interop for Reanimated components.
//
// NativeWind only translates `className` → `style` for components it has been
// told about. Core primitives (View, Text, Pressable…) are registered by its
// preset; anything produced by `Animated.createAnimatedComponent` is not, and
// on those the className is silently DROPPED.
//
// Registering is not enough on native, though. When the interop wrapper sees a
// Reanimated animated style (`useAnimatedStyle`'s return value) in the same
// `style` prop as a `className`, react-native-css-interop 0.2 with Reanimated 4
// drops the className styles entirely. Found on the Android emulator: every
// `Touchable` lost its `flex-row`/`flex-1`/background (segmented controls
// stacked their labels, the FAB had no fill, swipe-row actions showed through),
// while the web preview — where className is real CSS — looked perfect.
//
// So on native each Reanimated host is routed through a "sink": the className
// is resolved on a plain function component that never sees the animated
// style, and the caller's `style` (animated or not) is appended afterwards,
// matching NativeWind's own "className first, style overrides" order.
//
// Registering here, imported once from the design-system barrel, means a new
// animated component cannot be added without also being registered.
// ────────────────────────────────────────────────────────────────

import React, { forwardRef } from 'react';
import { Platform, Pressable, type StyleProp } from 'react-native';
import Animated from 'react-native-reanimated';
import { cssInterop } from 'nativewind';

export const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type AnyProps = Record<string, unknown> & { style?: StyleProp<unknown>; contentContainerStyle?: StyleProp<unknown> };

/**
 * The interop registry is not part of css-interop's public entry. Resolved
 * defensively so a future layout change degrades to plain registration (the
 * previous behaviour) instead of crashing at startup.
 */
function interopRegistry(): Map<unknown, unknown> | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const api = require('react-native-css-interop/dist/runtime/api') as { interopComponents?: unknown };
    return api.interopComponents instanceof Map ? api.interopComponents : null;
  } catch {
    return null;
  }
}

/** Exported for tests: merge order is class styles first, caller style last. */
export function mergeSinkStyle(classStyle: StyleProp<unknown>, raw: StyleProp<unknown>): StyleProp<unknown> {
  if (raw === undefined || raw === null) return classStyle;
  if (classStyle === undefined || classStyle === null) return raw;
  return [classStyle, raw];
}

function isolateAnimatedStyle(Base: React.ComponentType<AnyProps>, registry: Map<unknown, unknown>): void {
  const Sink = forwardRef<unknown, AnyProps>(function AnimatedStyleSink(props, ref) {
    const { style, contentContainerStyle, __rawStyle, __rawContentStyle, ...rest } = props;
    return React.createElement(Base, {
      ...rest,
      ref,
      // NativeWind's Babel plugin routes createElement through the same
      // registry as JSX; without the opt-out this re-enters `Routed` forever.
      cssInterop: false,
      style: mergeSinkStyle(style, __rawStyle as StyleProp<unknown>),
      contentContainerStyle: mergeSinkStyle(contentContainerStyle, __rawContentStyle as StyleProp<unknown>),
    });
  });
  const InteropSink = cssInterop(Sink, {
    className: 'style',
    contentContainerClassName: 'contentContainerStyle',
  }) as unknown as React.ComponentType<AnyProps>;

  const Routed = forwardRef<unknown, AnyProps>(function AnimatedClassName(props, ref) {
    const { style, contentContainerStyle, ...rest } = props;
    return React.createElement(InteropSink, {
      ...rest,
      ref,
      __rawStyle: style,
      __rawContentStyle: contentContainerStyle,
    });
  });
  Routed.displayName = `AnimatedClassName(${Base.displayName ?? 'Component'})`;
  // `<Animated.View className=…>` anywhere in the app now resolves to `Routed`
  // through NativeWind's JSX runtime; `Sink` renders the real component with
  // `cssInterop: false`, which skips the registry, so there is no loop.
  registry.set(Base, Routed);
}

const hosts = [AnimatedPressable, Animated.View, Animated.Text, Animated.ScrollView] as unknown as Array<
  React.ComponentType<AnyProps>
>;
const registry = Platform.OS === 'web' ? null : interopRegistry();

if (registry) {
  for (const host of hosts) isolateAnimatedStyle(host, registry);
} else {
  // Web (className is real CSS there) or an unknown css-interop layout.
  cssInterop(AnimatedPressable, { className: 'style' });
  cssInterop(Animated.View, { className: 'style' });
  cssInterop(Animated.Text, { className: 'style' });
  cssInterop(Animated.ScrollView, {
    className: 'style',
    contentContainerClassName: 'contentContainerStyle',
  });
}
