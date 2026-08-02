// ────────────────────────────────────────────────────────────────
// Sheet — every secondary surface in the app.
//
// Built directly on RN `Modal` + Reanimated + gesture-handler rather than on
// a sheet library, after two of those were tried and failed:
//
//   • `@gorhom/bottom-sheet` (v5, `BottomSheetModal`) presents nothing at all
//     under react-native-web — no container is added to the DOM, with no
//     error. Its `enableDynamicSizing` default also fights explicit detents.
//   • `@gorhom/portal` — `PortalHost` collapses to zero height inside a flex
//     column, so content never appears.
//   • an absolutely-positioned overlay declared inline — RN views are all
//     `position: relative`, so a sheet declared in the composer was CLIPPED
//     to the composer's box.
//
// `Modal` is the one primitive that reliably escapes the layout tree on both
// platforms. Its cost is that it renders in a SEPARATE host subtree, so the
// NativeWind `vars()` bag applied at the app root does not reach inside and
// every themed class resolves to nothing — the surface paints fully
// transparent, in both light and dark. Re-applying `useTheme().style` on the
// modal's root view is therefore load-bearing, not decoration.
//
// What we implement ourselves, because the library was meant to provide it:
// detents, a draggable grabber that snaps, velocity-aware dismissal, and a
// scrim whose opacity tracks the sheet's position. All of it runs on the UI
// thread, which matters because most sheets are opened mid-token-stream.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, X } from 'lucide-react-native';

import { IconButton } from './Button';
import { Touchable } from './Touchable';
import { SPRING_SHEET, TIMING_FAST } from './motion';
import { haptics } from './haptics';
import { useTheme } from '../../theme/ThemeProvider';

/** Rest heights as a fraction of the screen. */
export type Detent = 0.28 | 0.4 | 0.5 | 0.6 | 0.75 | 0.92;

/** Past this much of a drag downward from the lowest detent, dismiss. */
const DISMISS_FRACTION = 0.35;
/** Or past this downward velocity, regardless of distance. */
const DISMISS_VELOCITY = 900;

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** Trailing header slot — a Done button, a refresh action, a count. */
  action?: React.ReactNode;
  /** Leading header slot — typically Back in a multi-page sheet. */
  leading?: React.ReactNode;
  /**
   * Rest heights, smallest first. HIG: include a grabber whenever there is
   * more than one, because that is the only affordance that says "resizable".
   */
  detents?: Detent[];
  /** Which detent to open at. Defaults to the last (tallest). */
  initialDetent?: number;
  /** Set false when the content manages its own scrolling (a nested list). */
  scrollable?: boolean;
  /** Blocks scrim-tap and swipe dismissal — for destructive confirmations. */
  persistent?: boolean;
  children: React.ReactNode;
}

export function Sheet({
  visible,
  onClose,
  title,
  action,
  leading,
  detents = [0.92],
  initialDetent,
  scrollable = true,
  persistent = false,
  children,
}: SheetProps): React.ReactElement | null {
  const { colors, style: themeVars } = useTheme();
  const { height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  // Sorted ascending so index 0 is always the shortest rest height.
  const stops = useMemo(() => [...detents].sort((a, b) => a - b), [detents]);
  const tallest = stops[stops.length - 1] ?? 0.92;
  const sheetHeight = screenHeight * tallest;

  /** Offset from fully-open for a given detent. */
  const offsetFor = useCallback(
    (fraction: number) => (tallest - fraction) * screenHeight,
    [tallest, screenHeight],
  );

  const closedOffset = sheetHeight;
  const openIndex = initialDetent ?? stops.length - 1;

  const translateY = useSharedValue(closedOffset);
  const dragStart = useSharedValue(0);
  const stopIndex = useRef(openIndex);

  useEffect(() => {
    if (visible) {
      stopIndex.current = openIndex;
      translateY.value = withSpring(offsetFor(stops[openIndex] ?? tallest), SPRING_SHEET);
    } else {
      translateY.value = withTiming(closedOffset, TIMING_FAST);
    }
  }, [visible, openIndex, stops, tallest, offsetFor, closedOffset, translateY]);

  const close = useCallback(() => {
    if (persistent) return;
    haptics.tap();
    onClose();
  }, [persistent, onClose]);

  /**
   * Snap to the nearest detent, or dismiss.
   *
   * Velocity is consulted before distance so a quick flick closes even when
   * the finger barely moved — that is what makes a sheet feel like a sheet
   * rather than a panel that has to be dragged all the way down.
   */
  const settle = useCallback(
    (offset: number, velocity: number) => {
      'worklet';
      const lowest = offsetFor(stops[0] ?? tallest);

      if (!persistent && (velocity > DISMISS_VELOCITY || offset > lowest + sheetHeight * DISMISS_FRACTION)) {
        translateY.value = withTiming(closedOffset, TIMING_FAST, () => {
          runOnJS(onClose)();
        });
        return;
      }

      let best = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let i = 0; i < stops.length; i += 1) {
        // Project the throw a little so a fast drag lands on the next detent
        // rather than snapping back to where it started.
        const target = offsetFor(stops[i]!);
        const distance = Math.abs(offset + velocity * 0.08 - target);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = i;
        }
      }
      translateY.value = withSpring(offsetFor(stops[best]!), SPRING_SHEET);
    },
    [offsetFor, stops, tallest, persistent, sheetHeight, closedOffset, translateY, onClose],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .onBegin(() => {
          dragStart.value = translateY.value;
        })
        .onUpdate((event) => {
          // Rubber-band upward past the tallest detent instead of allowing the
          // sheet to detach from the top of the screen.
          const next = dragStart.value + event.translationY;
          translateY.value = next < 0 ? next * 0.25 : next;
        })
        .onEnd((event) => {
          settle(translateY.value, event.velocityY);
        }),
    [dragStart, translateY, settle],
  );

  /** Tapping the grabber cycles detents — HIG, and the only non-drag route. */
  const cycleDetent = useCallback(() => {
    if (stops.length < 2) return;
    stopIndex.current = (stopIndex.current + 1) % stops.length;
    translateY.value = withSpring(offsetFor(stops[stopIndex.current]!), SPRING_SHEET);
  }, [stops, offsetFor, translateY]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateY.value, [closedOffset, 0], [0, 0.5], 'clamp'),
  }));

  if (!visible) return null;

  const Body = scrollable ? ScrollView : View;

  return (
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={close}
      statusBarTranslucent
    >
      {/* `themeVars` is re-applied here because the modal host is a separate
          subtree: without it every themed class inside resolves to nothing
          and the whole sheet paints transparent. `zIndex` is explicit because
          react-native-web lands the modal host at z-index 0. */}
      <View style={[StyleSheet.absoluteFill, themeVars, { justifyContent: 'flex-end', zIndex: 50 }]}>
        <Touchable
          accessibilityLabel="Dismiss"
          disabled={persistent}
          haptic="none"
          scale="none"
          onPress={close}
          style={StyleSheet.absoluteFill as ViewStyle}
        >
          <Animated.View style={[StyleSheet.absoluteFill, scrimStyle, { backgroundColor: '#000' }]} />
        </Touchable>

        <Animated.View
          className="overflow-hidden rounded-t-4xl border-t border-border bg-card"
          style={[
            sheetStyle,
            {
              height: sheetHeight,
              paddingBottom: insets.bottom,
              shadowColor: '#000',
              shadowOpacity: 0.3,
              shadowRadius: 24,
              shadowOffset: { width: 0, height: -4 },
              elevation: 24,
            },
          ]}
        >
          <GestureDetector gesture={pan}>
            <View className="items-center pb-1 pt-2.5">
              <Touchable
                accessibilityLabel={stops.length > 1 ? 'Resize sheet' : 'Grabber'}
                disabled={stops.length < 2}
                haptic="select"
                scale="none"
                onPress={cycleDetent}
                className="px-8 py-1.5"
              >
                <View className="h-1 w-9 rounded-full bg-border-muted" />
              </Touchable>
            </View>
          </GestureDetector>

          {title || action || leading ? (
            <View className="flex-row items-center gap-2 border-b border-border-muted px-4 pb-3">
              {leading}
              <Text numberOfLines={1} className="flex-1 text-lg font-semibold text-foreground">
                {title}
              </Text>
              {action ?? (
                <IconButton
                  accessibilityLabel="Close"
                  icon={<X size={20} color={colors['muted-foreground']} />}
                  onPress={close}
                />
              )}
            </View>
          ) : null}

          <Body
            style={{ flex: 1 }}
            {...(scrollable
              ? {
                  contentContainerStyle: { paddingBottom: 24 },
                  keyboardShouldPersistTaps: 'handled' as const,
                }
              : {})}
          >
            {children}
          </Body>
        </Animated.View>
      </View>
    </Modal>
  );
}

/** A selectable row inside a picker sheet. */
export function SheetRow({
  title,
  subtitle,
  selected = false,
  onPress,
  left,
  right,
  disabled = false,
}: {
  title: string;
  subtitle?: string | null;
  selected?: boolean;
  onPress: () => void;
  left?: React.ReactNode;
  right?: React.ReactNode;
  disabled?: boolean;
}): React.ReactElement {
  const { colors } = useTheme();

  return (
    <Touchable
      accessibilityLabel={title}
      accessibilityState={{ selected }}
      disabled={disabled}
      haptic="select"
      scale="large"
      onPress={onPress}
      className={`min-h-14 flex-row items-center gap-3 px-4 py-2.5 ${selected ? 'bg-accent' : ''}`}
    >
      {left}
      <View className="flex-1 gap-0.5">
        <Text numberOfLines={1} className="text-md font-medium text-foreground">
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={2} className="text-sm text-muted-foreground">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      {selected ? <Check size={18} color={colors.primary} /> : null}
    </Touchable>
  );
}

export function SheetSection({
  title,
  right,
}: {
  title: string;
  right?: React.ReactNode;
}): React.ReactElement {
  return (
    <View className="flex-row items-center justify-between bg-background px-4 py-2">
      <Text className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </Text>
      {right}
    </View>
  );
}
