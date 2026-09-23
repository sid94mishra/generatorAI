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
// v2 — what changed and why:
//   • Drag ANYWHERE. The header drags as before; the body drags too, the way
//     every native sheet does: downward when its content is scrolled to the
//     top, upward whenever the sheet is below its tallest detent. Content
//     scrolling is only enabled AT the tallest detent, which is what stops
//     a list and the sheet from moving together. A body that manages its own
//     scrolling (`scrollable={false}`) drags from its left/right 20pt edges.
//   • Snapping is velocity-aware (`sheetMath.snapDetent`): a flick reaches
//     the next detent in its direction even when "nearest" is behind it.
//   • Keyboard lift uses RN `Keyboard` events through `useKeyboardHeight`
//     (the keyboard's overlap with the window; see keyboard.ts for Android).
//   • Reduce Motion (OS switch OR app preference) jumps between positions
//     instead of springing.
//
// v3 (iOS readiness):
//   • With the keyboard up the card's HEIGHT is capped on the UI thread
//     (`sheetMath.keyboardCappedHeight`) instead of the whole fixed-height
//     card being pushed up past the status bar; detent math is unchanged
//     and only the rendered offset is adjusted (`renderedOffset`).
//   • Real window insets (`useWindowInsets`) for the status bar clamp, the
//     home indicator and landscape side insets; width capped on iPad.
// ──────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  Modal,
  Platform,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useWindowInsets, READABLE_MAX_WIDTH } from './windowInsets';
import { Check, X } from 'lucide-react-native';

import { IconButton } from './Button';
import { Touchable } from './Touchable';
import { useReducedMotionPreset } from './motion';
import { MAX_SCALE } from './accessibility';
import { haptics } from './haptics';
import { useKeyboardHeight } from './keyboard';
import {
  SHEET_TOP_GAP,
  detentOffsets,
  keyboardCappedHeight,
  sheetBottomPadding,
  renderedOffset,
  rubberBand,
  snapDetent,
} from './sheetMath';
import { useTheme } from '../../theme/ThemeProvider';

/**
 * Rest height as a fraction of the screen. The plan's three canonical stops
 * are 0.28 / 0.6 / 0.92; any fraction in (0, 1] is accepted.
 */
export type Detent = number;

/** Width of the strip on each side of a self-scrolling body that drags the sheet. */
const BODY_EDGE = 20;

/**
 * Body sizing. `flex: 0` is NOT the same on every renderer: react-native-web
 * resolves it to `flex: 0 1 0%`, so a fit-to-content ScrollView collapsed to
 * zero height and every action sheet / confirmation rendered as an empty
 * card in the web preview (Sept 7 2026 live run). Spelling out grow/shrink/
 * basis gives the same "size to content, shrink if the sheet is capped"
 * behaviour on native and web.
 */
const FIT_BODY = { flexGrow: 0, flexShrink: 1, flexBasis: 'auto' } as const;
const FILL_BODY = { flex: 1 } as const;

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
  /**
   * Lift the sheet with the keyboard (iOS; Android's modal window resizes on
   * its own). On by default — off for a sheet that hosts no text input and
   * must not move when one elsewhere opens.
   */
  keyboardAware?: boolean;
  /** Fires after the sheet settles on a detent the user dragged it to. */
  onDetentChange?: (index: number) => void;
  /** Pinned primary action. Use a single detent for forms with a footer. */
  footer?: React.ReactNode;
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
  keyboardAware = true,
  onDetentChange,
  children,
  footer,
}: SheetProps): React.ReactElement | null {
  const { colors, style: themeVars } = useTheme();
  const { height: screenHeight } = useWindowDimensions();
  // The Modal spans the whole window, outside `ConnectionStripHost`, so it
  // needs the REAL insets rather than the consumed ones the tree carries.
  const insets = useWindowInsets();
  const presets = useReducedMotionPreset();
  const keyboard = useKeyboardHeight();
  const [contentHeight, setContentHeight] = useState(0);
  // The grabber + title block sits OUTSIDE the measured body. Sizing a
  // fit-to-content sheet from the body alone made it overflow by exactly the
  // header height, pushing its primary button below the screen edge (the
  // Rename sheet's Save in the Sept 7 run).
  const [headerHeight, setHeaderHeight] = useState(0);
  const [footerHeight, setFooterHeight] = useState(0);

  // Callers pass `detents={[0.28, 0.6, 0.92]}` inline, so the prop is a NEW
  // array on every render. Keying on its CONTENTS is what stops the settle
  // effect re-running on every parent re-render and yanking the sheet back
  // to `initialDetent` — which is why resizing it and then tapping anything
  // used to collapse it again.
  const stopsKey = [...detents].sort((a, b) => a - b).join(',');
  // Sorted ascending so index 0 is always the shortest rest height.
  const stops = useMemo(() => stopsKey.split(',').map(Number), [stopsKey]);
  const tallest = stops[stops.length - 1] ?? 0.92;

  // Never taller than the space below the status bar. The Modal is
  // `statusBarTranslucent`, so a 0.92 detent slid its title under the clock
  // on Android when the consumed (0) top inset was used. `useWindowInsets`
  // carries the live value, correct after rotation.
  const statusBarTop = insets.top;
  const maxHeight = Math.min(screenHeight * tallest, screenHeight - statusBarTop - SHEET_TOP_GAP);
  const sheetHeight = fitContent
    ? Math.min(maxHeight, contentHeight > 0 ? contentHeight + headerHeight + (footer ? footerHeight : 0) + insets.bottom + 24 : maxHeight)
    : maxHeight;

  /** translateY of each detent, index-aligned with `stops`. */
  const offsets = useMemo(
    () => (fitContent ? [0] : detentOffsets(stops, screenHeight, sheetHeight)),
    [stops, screenHeight, sheetHeight, fitContent],
  );

  const closedOffset = sheetHeight;
  const openIndex = initialDetent ?? stops.length - 1;
  const lastIndex = offsets.length - 1;

  const translateY = useSharedValue(closedOffset);
  const dragStart = useSharedValue(0);
  const dragOrigin = useSharedValue(0);
  const dragging = useSharedValue(0);
  const bodyScrollY = useSharedValue(0);
  const bodyWidth = useSharedValue(0);
  const stopIndex = useRef(Math.min(openIndex, lastIndex));
  const wasVisible = useRef(false);

  // Content scrolls only at the tallest detent. Below it, a drag on the
  // body moves the sheet, which is what the finger meant.
  const [atTallest, setAtTallest] = useState(stopIndex.current >= lastIndex);

  const rememberStop = useCallback(
    (index: number) => {
      const changed = stopIndex.current !== index;
      stopIndex.current = index;
      setAtTallest(index >= lastIndex);
      if (changed) {
        haptics.threshold();
        onDetentChange?.(index);
      }
    },
    [lastIndex, onDetentChange],
  );

  // Geometry changes (rotation, keyboard) must re-settle the sheet, but only
  // an OPEN transition may choose the detent. While it is already open the
  // user's own choice wins, so re-settling keeps `stopIndex.current`.
  useEffect(() => {
    if (visible) {
      if (!wasVisible.current) {
        stopIndex.current = Math.min(openIndex, lastIndex);
        setAtTallest(stopIndex.current >= lastIndex);
      }
      wasVisible.current = true;
      translateY.value = withSpring(offsets[stopIndex.current] ?? 0, presets.springSheet);
    } else {
      wasVisible.current = false;
      translateY.value = withTiming(closedOffset, presets.timingFast);
    }
  }, [visible, openIndex, lastIndex, offsets, closedOffset, translateY, presets]);

  const close = useCallback(() => {
    if (persistent) return;
    haptics.tap();
    onClose();
  }, [persistent, onClose]);

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

  /** Snap to a detent, or dismiss. See `sheetMath.snapDetent` for the rules. */
  const settle = useCallback(
    (offset: number, velocity: number) => {
      'worklet';
      const result = snapDetent({ offset, velocity, offsets, sheetHeight, persistent });
      if (result.kind === 'dismiss') {
        translateY.value = withTiming(closedOffset, presets.timingFast, () => {
          runOnJS(onClose)();
        });
        return;
      }
      // Record it, or a later re-settle would spring back to the detent the
      // sheet was opened at rather than the one the user dragged it to.
      runOnJS(rememberStop)(result.index);
      translateY.value = withSpring(offsets[result.index] ?? 0, presets.springSheet);
    },
    [offsets, sheetHeight, persistent, translateY, closedOffset, presets, onClose, rememberStop],
  );

  /** The header (grabber + title row) drags unconditionally. */
  const headerPan = useMemo(
    () =>
      Gesture.Pan()
        .onBegin(() => {
          dragStart.value = translateY.value;
        })
        .onUpdate((event) => {
          // Rubber-band upward past the tallest detent instead of allowing the
          // sheet to detach from the top of the screen.
          translateY.value = rubberBand(dragStart.value + event.translationY);
        })
        .onEnd((event) => {
          settle(translateY.value, event.velocityY);
        }),
    [dragStart, translateY, settle],
  );

  // The body's own scroll, declared as a gesture so the body pan can be
  // told to run alongside it instead of fighting it for the touch.
  const scrollGesture = useMemo(() => Gesture.Native(), []);

  /**
   * The body drags the sheet when the finger's intent is unambiguous:
   * downward with the content at its top, or upward while the sheet is not
   * yet at its tallest. Otherwise the touch belongs to the content.
   */
  const bodyPan = useMemo(() => {
    const gesture = Gesture.Pan()
      .activeOffsetY([-10, 10])
      .failOffsetX([-16, 16])
      .onTouchesDown((event, state) => {
        // A self-scrolling body (a nested list) keeps its interior: only the
        // edge strips drag the sheet, so the list never loses a scroll.
        if (scrollable) return;
        const x = event.allTouches[0]?.x ?? 0;
        if (x > BODY_EDGE && x < bodyWidth.value - BODY_EDGE) state.fail();
      })
      .onBegin(() => {
        dragging.value = 0;
      })
      .onUpdate((event) => {
        if (!dragging.value) {
          const down = event.translationY > 0;
          const canDown = bodyScrollY.value <= 0;
          const canUp = translateY.value > 0.5;
          if (!((down && canDown) || (!down && canUp))) return;
          dragging.value = 1;
          dragStart.value = translateY.value;
          dragOrigin.value = event.translationY;
        }
        translateY.value = rubberBand(dragStart.value + event.translationY - dragOrigin.value);
      })
      .onEnd((event) => {
        if (!dragging.value) return;
        dragging.value = 0;
        settle(translateY.value, event.velocityY);
      })
      .onFinalize(() => {
        dragging.value = 0;
      });
    if (scrollable) gesture.simultaneousWithExternalGesture(scrollGesture);
    return gesture;
  }, [scrollable, bodyWidth, dragging, bodyScrollY, translateY, dragStart, dragOrigin, settle, scrollGesture]);

  const onBodyScroll = useAnimatedScrollHandler((event) => {
    bodyScrollY.value = event.contentOffset.y;
  });

  /** Tapping the grabber cycles detents — HIG, and the only non-drag route. */
  const cycleDetent = useCallback(() => {
    if (stops.length < 2 || fitContent) return;
    const next = (stopIndex.current + 1) % stops.length;
    rememberStop(next);
    translateY.value = withSpring(offsets[next] ?? 0, presets.springSheet);
  }, [stops.length, offsets, translateY, fitContent, presets, rememberStop]);

  // Keyboard handling, all on the UI thread. The container is padded by the
  // keyboard (see `liftStyle`), so the card is capped to the space left
  // below the status bar — a fixed height pushed a tall sheet's title and
  // grabber off the top of the screen. The home-indicator padding is dropped
  // while the keyboard is up: the keyboard already covers that strip.
  const sheetStyle = useAnimatedStyle(() => {
    const kb = keyboardAware ? keyboard.value : 0;
    const height = keyboardCappedHeight(sheetHeight, screenHeight, statusBarTop, kb);
    const offset = renderedOffset(translateY.value, sheetHeight, height);
    return {
      height,
      // At a shorter detent the card extends below the window. Exclude that
      // region from layout so nested scroll views and footers remain usable.
      paddingBottom: sheetBottomPadding(offset, kb > 0 ? 0 : insets.bottom),
      transform: [{ translateY: offset }],
    };
  }, [keyboardAware, sheetHeight, screenHeight, statusBarTop, insets.bottom]);

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateY.value, [closedOffset, 0], [0, 0.5], 'clamp'),
  }));

  // Lifting the whole sheet is correct here rather than padding its content:
  // the sheet is anchored to the bottom edge, so the keyboard would otherwise
  // cover its primary action no matter how the body scrolls.
  const liftStyle = useAnimatedStyle(() => ({ paddingBottom: keyboardAware ? keyboard.value : 0 }), [keyboardAware]);

  const onContentLayout = useCallback(
    (event: LayoutChangeEvent) => {
      if (fitContent) setContentHeight(event.nativeEvent.layout.height);
    },
    [fitContent],
  );

  if (!visible) return null;

  const scrollEnabled = scrollable && (fitContent || atTallest);

  return (
    <Modal visible transparent animationType="none" onRequestClose={close} statusBarTranslucent>
      {/* A Modal is its own native window on Android, outside the app's
          `GestureHandlerRootView` — so without a gesture root of its own NONE
          of the pans below ever fire there: the sheet could not be dragged
          between its detents or swiped away, only closed by the X or the
          scrim. iOS presents inside the same root and was unaffected, which is
          how this went unnoticed. */}
      <GestureHandlerRootView style={styles.gestureRoot}>
      {/* `themeVars` is re-applied here because the modal host is a separate
          subtree: without it every themed class inside resolves to nothing
          and the whole sheet paints transparent. `zIndex` is explicit because
          react-native-web lands the modal host at z-index 0. */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          themeVars,
          liftStyle,
          // Landscape: keep the card clear of the notch / Dynamic Island. The
          // scrim is absolutely positioned, so it still covers the edges.
          { justifyContent: 'flex-end', zIndex: 50, paddingLeft: insets.left, paddingRight: insets.right },
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
          <Animated.View style={[StyleSheet.absoluteFill, scrimStyle, { backgroundColor: 'rgb(0,0,0)' }]} />
        </Touchable>

        <Animated.View
          // Modal semantics: without these the content behind the sheet stays
          // in the accessibility tree, so a screen-reader swipe walks straight
          // out of the sheet into the screen it is covering.
          accessibilityViewIsModal
          onAccessibilityEscape={close}
          className="overflow-hidden rounded-t-4xl border-t border-border bg-card"
          style={[
            {
              // iPad / landscape: a centred column instead of a 1200pt-wide
              // card; phones in portrait are narrower than the cap.
              width: '100%',
              maxWidth: READABLE_MAX_WIDTH,
              alignSelf: 'center',
              shadowColor: 'rgb(0,0,0)',
              shadowOpacity: 0.3,
              shadowRadius: 24,
              shadowOffset: { width: 0, height: -4 },
              elevation: 24,
            },
            sheetStyle,
          ]}
        >
          {/* The whole header block drags, not just the grabber. Every native
              sheet does; dragging by a 9pt bar was the one interaction users
              had to be taught. */}
          <GestureDetector gesture={headerPan}>
            <View onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height)}>
              <View className="items-center pb-1 pt-2.5">
                <Touchable
                  a11yRole="adjustable"
                  accessibilityLabel={stops.length > 1 ? 'Sheet size' : 'Grabber'}
                  accessibilityHint={stops.length > 1 ? 'Double tap to change the sheet height' : undefined}
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

          <GestureDetector gesture={bodyPan}>
            <View
              style={fitContent ? FIT_BODY : FILL_BODY}
              onLayout={(event) => {
                bodyWidth.value = event.nativeEvent.layout.width;
              }}
            >
              {scrollable ? (
                <GestureDetector gesture={scrollGesture}>
                  <Animated.ScrollView
                    style={fitContent ? FIT_BODY : FILL_BODY}
                    onScroll={onBodyScroll}
                    scrollEventThrottle={16}
                    scrollEnabled={scrollEnabled}
                    // No overscroll: when the content is at its top a downward
                    // drag moves the SHEET, and a bounce underneath it would
                    // read as two things moving.
                    bounces={false}
                    overScrollMode="never"
                    contentContainerStyle={{ paddingBottom: 24 }}
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode="interactive"
                  >
                    <View onLayout={onContentLayout}>{children}</View>
                  </Animated.ScrollView>
                </GestureDetector>
              ) : (
                <View style={fitContent ? FIT_BODY : FILL_BODY} onLayout={onContentLayout}>
                  {children}
                </View>
              )}
            </View>
          </GestureDetector>
          {footer ? (
            <View onLayout={(event) => setFooterHeight(event.nativeEvent.layout.height)} className="border-t border-border-muted bg-card px-4 py-3">
              {footer}
            </View>
          ) : null}
        </Animated.View>
      </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  gestureRoot: { flex: 1 },
});

/** A selectable row inside a picker sheet. */
export function SheetRow({
  title,
  subtitle,
  selected = false,
  onPress,
  onLongPress,
  left,
  right,
  disabled = false,
  testID,
}: {
  title: string;
  subtitle?: string | null;
  selected?: boolean;
  onPress: () => void;
  /** Open a context menu for this row (see `useContextMenu`). */
  onLongPress?: () => void;
  left?: React.ReactNode;
  right?: React.ReactNode;
  disabled?: boolean;
  /** For E2E: the rows of a decision sheet have to be addressable by name. */
  testID?: string;
}): React.ReactElement {
  const { colors } = useTheme();

  return (
    <Touchable
      accessibilityLabel={title}
      accessibilityHint={subtitle ?? undefined}
      accessibilityState={{ selected }}
      disabled={disabled}
      {...(testID ? { testID } : {})}
      haptic="select"
      scale="large"
      onPress={onPress}
      {...(onLongPress ? { onLongPress } : {})}
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
export function SheetSection({ title, right }: { title: string; right?: React.ReactNode }): React.ReactElement {
  return (
    // No band of its own: a `bg-background` strip on the `bg-card` sheet read
    // as a stripe between sections. Spacing, not colour, separates them.
    <View className="flex-row items-center justify-between px-4 pb-2 pt-4">
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
