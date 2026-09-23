// ────────────────────────────────────────────────────────────────
// SidePanel — an edge-anchored panel that slides over (or pushes) the content.
//
// Two surfaces are built on it: the app's navigation drawer (left) and the
// chat / run workbench index (right). Both platforms get their own idiom from
// the one component, because the difference is presentation, not behaviour:
//
//   • iOS `push`: the content slides aside and the panel is revealed beneath
//     it with a slight parallax — the pattern every iOS chat client settled
//     on. The pushed content dims and keeps a rounded leading corner.
//   • `overlay` (Android always, and the right-hand panel everywhere): the
//     Material 3 modal drawer — the panel travels over the content, a scrim
//     blocks it, the trailing corners are rounded.
//
// The panel follows the finger on the UI thread. Open/close state crosses to
// JS only when it settles, so a drag never re-renders the tree under it.
//
// Opening by swipe is limited to a strip along the panel's edge. A full-width
// pan competes with horizontally scrolling content (code blocks, tables,
// segment swipes, swipeable rows) and loses unpredictably; a strip does not,
// and the button remains the primary affordance on both platforms.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { useReduceMotion } from './accessibility';
import { SPRING_SHEET } from './motion';
import { haptics } from './haptics';
import { useTheme } from '../../theme/ThemeProvider';
import { GlassSurface } from './GlassSurface';
import { edgeStripWidth, settleOpen, sidePanelWidth } from './sidePanelMath';

export { sidePanelWidth } from './sidePanelMath';

export type SidePanelSide = 'left' | 'right';
export type SidePanelPresentation = 'push' | 'overlay';

/** See `edgeStripWidth`. Screens with their own horizontal pans keep out of it. */
export const DEFAULT_EDGE_WIDTH = edgeStripWidth(Platform.OS);

/**
 * For a screen's own full-width horizontal pan (segment swipe, swipeable row):
 * ignore drags that START in the navigation drawer's edge strip, so that strip
 * belongs to the drawer alone. Two pans racing for the same drag resolve by
 * whichever crosses its threshold first, which a fast flick makes arbitrary.
 */
export const DRAWER_EDGE_HIT_SLOP = { left: -DEFAULT_EDGE_WIDTH } as const;

export interface SidePanelHostProps {
  side: SidePanelSide;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Rendered inside the panel. Mounted lazily, then kept. */
  renderPanel: () => React.ReactNode;
  /** `push` is honoured on iOS for the left panel; everything else overlays. */
  presentation?: SidePanelPresentation;
  /** Allow the closed panel to be dragged open from its edge. */
  swipeToOpen?: boolean;
  /** Width of the edge strip that starts an opening drag. */
  edgeWidth?: number;
  accessibilityLabel: string;
  children: React.ReactNode;
  /** Shared progress (0 closed → 1 open), for callers that animate with it. */
  progress?: SharedValue<number>;
}

export function SidePanelHost({
  side,
  open,
  onOpenChange,
  renderPanel,
  presentation = 'overlay',
  swipeToOpen = true,
  edgeWidth = DEFAULT_EDGE_WIDTH,
  accessibilityLabel,
  children,
  progress: externalProgress,
}: SidePanelHostProps): React.ReactElement {
  const { colors } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const width = sidePanelWidth(windowWidth);
  const internal = useSharedValue(0);
  const progress = externalProgress ?? internal;
  const dragStart = useSharedValue(0);
  // The panel's tree is not built until it is first needed; after that it
  // stays mounted so reopening is instant and scroll position survives.
  const [mounted, setMounted] = useState(open);
  // True while the panel is on screen at all — drives pointer events and
  // accessibility, which cannot read a shared value.
  const [engaged, setEngaged] = useState(open);

  const sign = side === 'left' ? 1 : -1;
  const push = presentation === 'push' && side === 'left' && Platform.OS === 'ios';

  const animateTo = useCallback(
    (target: 0 | 1) => {
      if (reduceMotion) {
        progress.value = withTiming(target, { duration: 0 });
      } else {
        progress.value = withSpring(target, SPRING_SHEET);
      }
    },
    [progress, reduceMotion],
  );

  useEffect(() => {
    if (open) {
      setMounted(true);
      setEngaged(true);
    }
    animateTo(open ? 1 : 0);
    if (!open) {
      const t = setTimeout(() => setEngaged(false), reduceMotion ? 0 : 260);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open, animateTo, reduceMotion]);

  // Android hardware / gesture back closes the panel before it leaves the screen.
  useEffect(() => {
    if (!open) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onOpenChange(false);
      return true;
    });
    return () => sub.remove();
  }, [open, onOpenChange]);

  const settle = useCallback(
    (next: boolean) => {
      if (next !== open) {
        haptics.select();
        if (next) {
          setMounted(true);
          setEngaged(true);
        }
        onOpenChange(next);
      } else {
        animateTo(next ? 1 : 0);
      }
    },
    [open, onOpenChange, animateTo],
  );

  const prepare = useCallback(() => {
    setMounted(true);
    setEngaged(true);
  }, []);

  const pan = useMemo(() => {
    const g = Gesture.Pan()
      .enabled(open || swipeToOpen)
      // Closed, the strip claims a horizontal drag a little EARLIER than the
      // default pan distance (10) so a screen's own horizontal gesture — a
      // segment swipe, a swipeable row — does not beat it to the drag that
      // started on the edge. Vertical scrolling still fails it first.
      .activeOffsetX(open ? [-14, 14] : side === 'left' ? [-1000, 8] : [-8, 1000])
      .failOffsetY([-12, 12])
      .onStart(() => {
        dragStart.value = progress.value;
        runOnJS(prepare)();
      })
      .onUpdate((event) => {
        const next = dragStart.value + (event.translationX * sign) / width;
        progress.value = Math.min(1, Math.max(0, next));
      })
      .onEnd((event) => {
        const next = settleOpen(progress.value, event.velocityX * sign);
        progress.value = withSpring(next ? 1 : 0, { ...SPRING_SHEET, velocity: (event.velocityX * sign) / width });
        runOnJS(settle)(next);
      });
    if (!open) {
      // Closed: only a strip along the panel's edge starts the drag.
      g.hitSlop(side === 'left' ? { left: 0, width: edgeWidth } : { right: 0, width: edgeWidth });
    }
    return g;
  }, [open, swipeToOpen, side, sign, width, edgeWidth, progress, dragStart, prepare, settle]);

  const panelStyle = useAnimatedStyle(() => {
    const hidden = push ? -width * 0.28 : -width;
    const x = interpolate(progress.value, [0, 1], [hidden, 0]);
    return { transform: [{ translateX: x * sign }] };
  }, [push, width, sign]);

  const contentStyle = useAnimatedStyle(() => {
    if (!push) return {};
    return {
      transform: [{ translateX: progress.value * width }],
      borderTopLeftRadius: interpolate(progress.value, [0, 1], [0, 22]),
      borderBottomLeftRadius: interpolate(progress.value, [0, 1], [0, 22]),
    };
  }, [push, width]);

  const scrimStyle = useAnimatedStyle(
    () => ({ opacity: interpolate(progress.value, [0, 1], [0, push ? 0.28 : 0.5]) }),
    [push],
  );

  const panel = (
    <Animated.View
      // A modal region: VoiceOver / TalkBack stay inside while it is open.
      accessibilityViewIsModal={engaged}
      accessibilityLabel={accessibilityLabel}
      importantForAccessibility={engaged ? 'yes' : 'no-hide-descendants'}
      accessibilityElementsHidden={!engaged}
      pointerEvents={engaged ? 'auto' : 'none'}
      style={[
        styles.panel,
        side === 'left' ? { left: 0 } : { right: 0 },
        { width },
        push || Platform.OS !== 'ios' ? { backgroundColor: colors.sidebar ?? colors.background } : null,
        push
          ? null
          : side === 'left'
            ? { borderTopRightRadius: 20, borderBottomRightRadius: 20 }
            : { borderTopLeftRadius: 20, borderBottomLeftRadius: 20 },
        // The shadow is only drawn while the panel is on screen: parked
        // off-edge it still bled a few points of shade into the content,
        // visible as a dark strip down the side in every light theme.
        push || !engaged ? null : styles.elevated,
        panelStyle,
      ]}
    >
      {/* An overlay panel is a control layer floating over content, which is
          exactly where iOS 26 puts Liquid Glass; `GlassSurface` is the opaque
          themed surface on Android, the web preview, older iOS and whenever
          Reduce Transparency is on. The pushed drawer sits BENEATH the content,
          so it stays a plain surface. */}
      {push ? (
        mounted ? renderPanel() : null
      ) : (
        <GlassSurface
          style={[
            StyleSheet.absoluteFill,
            // iOS: leave the material to the glass view (or its own opaque fallback).
            Platform.OS === 'ios' ? null : { backgroundColor: colors.sidebar ?? colors.background },
          ]}
        >
          {mounted ? renderPanel() : null}
        </GlassSurface>
      )}
    </Animated.View>
  );

  const scrim = (
    <Animated.View
      pointerEvents={engaged && open ? 'auto' : 'none'}
      style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, scrimStyle]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Dismiss ${accessibilityLabel.toLowerCase()}`}
        style={StyleSheet.absoluteFill}
        onPress={() => onOpenChange(false)}
      />
    </Animated.View>
  );

  return (
    <GestureDetector gesture={pan}>
      <View style={styles.root}>
        {push ? panel : null}
        <Animated.View
          style={[styles.content, { backgroundColor: colors.background }, contentStyle]}
          importantForAccessibility={engaged && open ? 'no-hide-descendants' : 'auto'}
          accessibilityElementsHidden={engaged && open}
        >
          {children}
          {push ? scrim : null}
        </Animated.View>
        {push ? null : scrim}
        {push ? null : panel}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  content: { flex: 1, overflow: 'hidden' },
  panel: { position: 'absolute', top: 0, bottom: 0, overflow: 'hidden' },
  elevated: {
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
    elevation: 16,
  },
});
