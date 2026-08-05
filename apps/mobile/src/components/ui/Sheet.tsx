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
// detents, drag-by-header as well as by the grabber, velocity-aware
// dismissal, a scrim whose opacity tracks position, keyboard avoidance, and
// modal accessibility semantics. All of it runs on the UI thread, which
// matters because most sheets are opened mid-token-stream.
// ──────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedKeyboard,
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
import { MAX_SCALE } from './accessibility';
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
  /**
   * Size to the content instead of to the detent.
   *
   * For menus and confirmations, where a half-screen sheet holding four rows
   * is a wall of empty card rather than a considered proportion.
   */
  fitContent?: boolean;
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
  fitContent = false,
  children,
}: SheetProps): React.ReactElement | null {
  const { colors, style: themeVars } = useTheme();
  const { height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const keyboard = useAnimatedKeyboard();
  const [contentHeight, setContentHeight] = useState(0);

  // Sorted ascending so index 0 is always the shortest rest height.
  const stops = useMemo(() => [...detents].sort((a, b) => a - b), [detents]);
  const tallest = stops[stops.length - 1] ?? 0.92;
  // Callers pass `detents={[0.28, 0.6, 0.92]}` inline, so `stops` is a NEW
  // array on every render. Depending on its identity re-ran the settle effect
  // on every parent re-render and yanked the sheet back to `initialDetent` —
  // which is why resizing it and then tapping anything collapsed it again.
  const stopsKey = stops.join(',');

  const maxHeight = screenHeight * tallest;
  const sheetHeight = fitContent
    ? Math.min(maxHeight, contentHeight + insets.bottom + 24 || maxHeight)
    : maxHeight;

  /** Offset from fully-open for a given detent. */
  const offsetFor = useCallback(
    (fraction: number) => Math.max(0, sheetHeight - screenHeight * fraction),
    [sheetHeight, screenHeight],
  );

  const closedOffset = sheetHeight;
  const openIndex = initialDetent ?? stops.length - 1;

  const translateY = useSharedValue(closedOffset);
  const dragStart = useSharedValue(0);
  const stopIndex = useRef(openIndex);
  const wasVisible = useRef(false);

  // Geometry changes (rotation, keyboard) must re-settle the sheet, but only
  // an OPEN transition may choose the detent. While it is already open the
  // user's own choice wins, so re-settling keeps `stopIndex.current`.
  useEffect(() => {
    if (visible) {
      if (!wasVisible.current) stopIndex.current = Math.min(openIndex, stops.length - 1);
      wasVisible.current = true;
      translateY.value = withSpring(
        fitContent ? 0 : offsetFor(stops[stopIndex.current] ?? tallest),
        SPRING_SHEET,
      );
    } else {
      wasVisible.current = false;
      translateY.value = withTiming(closedOffset, TIMING_FAST);
    }
    // `stopsKey` stands in for `stops`, whose identity changes every render.
  }, [visible, openIndex, stopsKey, tallest, offsetFor, closedOffset, translateY, fitContent]);

  const close = useCallback(() => {
    if (persistent) return;
    haptics.tap();
    onClose();
  }, [persistent, onClose]);

  const rememberStop = useCallback((index: number) => {
    stopIndex.current = index;
  }, []);

  // Android hardware / predictive back closes the sheet rather than the
  // screen behind it. `Modal`'s `onRequestClose` covers the classic button;
  // this covers the gesture.
  useEffect(() => {
    if (!visible || Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (persistent) return true;
      close();
      return true;
    });
    return () => sub.remove();
  }, [visible, persistent, close]);

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
      const lowest = fitContent ? 0 : offsetFor(stops[0] ?? tallest);

      if (!persistent && (velocity > DISMISS_VELOCITY || offset > lowest + sheetHeight * DISMISS_FRACTION)) {
        translateY.value = withTiming(closedOffset, TIMING_FAST, () => {
          runOnJS(onClose)();
        });
        return;
      }

      if (fitContent) {
        translateY.value = withSpring(0, SPRING_SHEET);
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
      // Record it, or a later re-settle would spring back to the detent the
      // sheet was opened at rather than the one the user dragged it to.
      runOnJS(rememberStop)(best);
      translateY.value = withSpring(offsetFor(stops[best]!), SPRING_SHEET);
    },
    [
      offsetFor,
      stops,
      tallest,
      persistent,
      sheetHeight,
      closedOffset,
      translateY,
      onClose,
      fitContent,
      rememberStop,
    ],
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
    if (stops.length < 2 || fitContent) return;
    stopIndex.current = (stopIndex.current + 1) % stops.length;
    translateY.value = withSpring(offsetFor(stops[stopIndex.current]!), SPRING_SHEET);
  }, [stops, offsetFor, translateY, fitContent]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateY.value, [closedOffset, 0], [0, 0.5], 'clamp'),
  }));

  // Lifting the whole sheet is correct here rather than padding its content:
  // the sheet is anchored to the bottom edge, so the keyboard would otherwise
  // cover its primary action no matter how the body scrolls.
  const liftStyle = useAnimatedStyle(() => ({
    paddingBottom: keyboard.height.value,
  }));

  const onContentLayout = useCallback(
    (event: LayoutChangeEvent) => {
      if (fitContent) setContentHeight(event.nativeEvent.layout.height);
    },
    [fitContent],
  );

  if (!visible) return null;

  const Body = scrollable ? ScrollView : View;

  return (
    <Modal visible transparent animationType="none" onRequestClose={close} statusBarTranslucent>
      {/* `themeVars` is re-applied here because the modal host is a separate
          subtree: without it every themed class inside resolves to nothing
          and the whole sheet paints transparent. `zIndex` is explicit because
          react-native-web lands the modal host at z-index 0. */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          themeVars,
          liftStyle,
          { justifyContent: 'flex-end', zIndex: 50 },
        ]}
      >
        <Touchable
          a11yRole="none"
          accessibilityLabel="Dismiss"
          disabled={persistent}
          haptic="none"
          ripple={false}
          scale="none"
          onPress={close}
          style={StyleSheet.absoluteFill as ViewStyle}
        >
          <Animated.View
            style={[StyleSheet.absoluteFill, scrimStyle, { backgroundColor: 'rgb(0,0,0)' }]}
          />
        </Touchable>

        <Animated.View
          // Modal semantics: without these the content behind the sheet stays
          // in the accessibility tree, so a screen-reader swipe walks straight
          // out of the sheet into the screen it is covering.
          accessibilityViewIsModal
          onAccessibilityEscape={close}
          className="overflow-hidden rounded-t-4xl border-t border-border bg-card"
          style={[
            sheetStyle,
            {
              height: sheetHeight,
              paddingBottom: insets.bottom,
              shadowColor: 'rgb(0,0,0)',
              shadowOpacity: 0.3,
              shadowRadius: 24,
              shadowOffset: { width: 0, height: -4 },
              elevation: 24,
            },
          ]}
        >
          {/* The whole header block drags, not just the grabber. Every native
              sheet does; dragging by a 9pt bar was the one interaction users
              had to be taught. */}
          <GestureDetector gesture={pan}>
            <View>
              <View className="items-center pb-1 pt-2.5">
                <Touchable
                  a11yRole="adjustable"
                  accessibilityLabel={stops.length > 1 ? 'Sheet size' : 'Grabber'}
                  accessibilityHint={
                    stops.length > 1 ? 'Double tap to change the sheet height' : undefined
                  }
                  disabled={stops.length < 2 || fitContent}
                  haptic="select"
                  ripple={false}
                  scale="none"
                  onPress={cycleDetent}
                  className="px-8 py-1.5"
                >
                  <View className="h-1 w-9 rounded-full bg-border-muted" />
                </Touchable>
              </View>

              {title || action || leading ? (
                <View className="flex-row items-center gap-2 border-b border-border-muted px-4 pb-3">
                  {leading}
                  <Text
                    accessibilityRole="header"
                    numberOfLines={1}
                    maxFontSizeMultiplier={MAX_SCALE.control}
                    className="flex-1 text-lg font-semibold text-foreground"
                  >
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
            </View>
          </GestureDetector>

          <Body
            style={{ flex: fitContent ? 0 : 1 }}
            onLayout={onContentLayout}
            {...(scrollable
              ? {
                  contentContainerStyle: { paddingBottom: 24 },
                  keyboardShouldPersistTaps: 'handled' as const,
                  keyboardDismissMode: 'interactive' as const,
                }
              : {})}
          >
            {children}
          </Body>
        </Animated.View>
      </Animated.View>
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
      accessibilityHint={subtitle ?? undefined}
      accessibilityState={{ selected }}
      disabled={disabled}
      haptic="select"
      scale="large"
      onPress={onPress}
      className={`min-h-14 flex-row items-center gap-3 px-4 py-2.5 ${selected ? 'bg-accent' : ''}`}
    >
      {left}
      <View className="flex-1 gap-0.5">
        <Text numberOfLines={2} className="text-md font-medium text-foreground">
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={3} className="text-sm text-muted-foreground">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      {selected ? <Check size={18} color={colors.primary} /> : null}
    </Touchable>
  );
}

/**
 * Section header inside a sheet.
 *
 * Sentence case, matching `SectionHeader`. The previous all-caps treatment
 * was a third competing header style in a system that already had two.
 */
export function SheetSection({
  title,
  right,
}: {
  title: string;
  right?: React.ReactNode;
}): React.ReactElement {
  return (
    <View className="flex-row items-center justify-between bg-background px-4 py-2">
      <Text
        accessibilityRole="header"
        maxFontSizeMultiplier={MAX_SCALE.chrome}
        className="text-sm font-semibold text-muted-foreground"
      >
        {title}
      </Text>
      {right}
    </View>
  );
}
