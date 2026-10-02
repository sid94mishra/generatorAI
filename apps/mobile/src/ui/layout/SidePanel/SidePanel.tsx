// ML-05 SidePanel (03 ML-05; 06 §1.4, §1.5; MD-18, MD-19, MD-24, MD-28): one component for both edges — the drawer
// / sidebar (start) and the workspace pane (end). Presentation is style, never structure (MD-24): the container,
// scrim and panel are always the same three elements, so switching overlay ↔ persistent ↔ fullscreen never remounts
// the content. The content mounts on first open and stays mounted. Overlay panels open from their toggle (and, start
// side only, from a 28 pt iOS edge strip on root screens), close by dragging toward their edge, a scrim tap, Back or
// the VoiceOver escape, and trap focus while open. Motion is the `panel` concept (a 180 ms cross-fade at the final
// position under Reduce Motion). The panel's close pan is exposed to horizontal scrollers inside it through
// PanelGestureContext (HorizontalScrollGuard), so a sideways scroll never closes the panel.
import React, { createContext, useContext, useEffect, useState } from 'react';
import { Pressable as RNPressable, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, type PanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { cn } from '../../lib/cn';
import { useBackHandler } from '../../platform/back';
import { geometry, nativePlatform } from '../../platform/geometry';
import { DRAWER_EDGE_WIDTH, PANEL_PAN } from '../../platform/gestures';
import { useInsets } from '../../platform/insets';
import { useMotion, type MotionConfig } from '../../platform/motion';
import type { SidePanelProps } from './SidePanel.types';
import { dragProgress, panelSurface, panelWidth, settleOpen, type PanelSurface } from './sidePanelModel';

export type { SidePanelPresentation, SidePanelProps, SidePanelSide } from './SidePanel.types';

/** The enclosing panel's close pan, for scrollers that must block it (HorizontalScrollGuard). */
export const PanelGestureContext = createContext<PanGesture | null>(null);

const SURFACE: Record<PanelSurface, string> = {
  'ios-drawer': 'bg-surface border-e border-line-soft rounded-e-panel',
  'ios-pane': 'bg-surface rounded-s-panel',
  'ios-card': 'm-2 bg-raised border border-line-soft rounded-group',
  'android-modal': 'bg-overlay',
  'android-tablet-drawer': 'bg-raised border-e border-line-soft',
  'android-tablet-pane': 'bg-overlay border-s border-line-soft',
};
const ANDROID_MODAL_CORNERS = { start: 'rounded-e-panel', end: 'rounded-s-panel' } as const;

function animateTo(target: number, motion: MotionConfig): number {
  'worklet';
  if (motion?.type === 'spring') return withSpring(target, motion.config);
  if (motion?.type === 'timing') return withTiming(target, motion.config);
  return target;
}

export function SidePanel({
  side,
  open,
  onOpenChange,
  presentation,
  edgeOpenEnabled = false,
  dragToCloseEnabled = true,
  width: widthProp,
  accessibilityLabel,
  children,
  testID,
}: SidePanelProps): React.ReactElement {
  const window = useWindowDimensions();
  const insets = useInsets();
  const motion = useMotion('panel');
  const persistent = presentation === 'persistent';
  const modal = !persistent;
  const shown = persistent || open;
  const width = widthProp ?? panelWidth(geometry(), side, presentation, window.width);
  const sign = side === 'start' ? 1 : -1;
  const reduced = motion.reduced;

  const progress = useSharedValue(shown ? 1 : 0);
  const dragStart = useSharedValue(0);
  // Mounted on first open, then kept (MD-24); `engaged` = on screen at all (drives pointer events and a11y).
  const [mounted, setMounted] = useState(shown);
  const [engaged, setEngaged] = useState(shown);
  if (shown && !mounted) setMounted(true);
  if (shown && !engaged) setEngaged(true);

  useEffect(() => {
    progress.set(animateTo(shown ? 1 : 0, motion.spatial));
    if (shown) return undefined;
    const t = setTimeout(() => setEngaged(false), reduced ? 180 : 320);
    return () => clearTimeout(t);
  }, [shown, progress, motion.spatial, reduced]);

  useBackHandler(modal && open, () => {
    onOpenChange(false);
    return true;
  });

  const settle = (next: boolean): void => {
    if (next) {
      setMounted(true);
      setEngaged(true);
    }
    if (next !== open) onOpenChange(next);
    else progress.set(animateTo(next ? 1 : 0, motion.spatial));
  };
  const prepare = (): void => {
    setMounted(true);
    setEngaged(true);
  };
  const spatial = motion.spatial;
  const pan = Gesture.Pan()
    .enabled(modal && open && dragToCloseEnabled)
    .activeOffsetX(PANEL_PAN.activeOffsetX)
    .failOffsetY(PANEL_PAN.failOffsetY)
    .onBegin(() => {
      dragStart.set(progress.get());
    })
    .onUpdate((e) => {
      progress.set(dragProgress(dragStart.get(), e.translationX, sign, width));
    })
    .onEnd((e) => {
      const next = settleOpen(progress.get(), sign * e.velocityX);
      progress.set(animateTo(next ? 1 : 0, spatial));
      scheduleOnRN(settle, next);
    });
  // Opening drag from the iOS edge strip (root screens only; the shell's gesture policy decides, MD-19).
  const edgePan = Gesture.Pan()
    .enabled(modal && !open && edgeOpenEnabled && side === 'start')
    .activeOffsetX([-1000, 8])
    .failOffsetY(PANEL_PAN.failOffsetY)
    .onBegin(() => {
      dragStart.set(progress.get());
    })
    .onStart(() => {
      scheduleOnRN(prepare);
    })
    .onUpdate((e) => {
      progress.set(dragProgress(dragStart.get(), e.translationX, 1, width));
    })
    .onEnd((e) => {
      const next = settleOpen(progress.get(), e.velocityX);
      progress.set(animateTo(next ? 1 : 0, spatial));
      scheduleOnRN(settle, next);
    });

  const panelStyle = useAnimatedStyle(() => {
    if (persistent) return { opacity: 1, transform: [{ translateX: 0 }] };
    const p = progress.get();
    if (reduced) return { opacity: p, transform: [{ translateX: p > 0 ? 0 : -sign * width }] };
    return { opacity: 1, transform: [{ translateX: -sign * width * (1 - p) }] };
  }, [persistent, reduced, sign, width]);
  const scrimStyle = useAnimatedStyle(() => ({ opacity: persistent || presentation === 'fullscreen' ? 0 : progress.get() }), [persistent, presentation]);

  const surface = panelSurface(nativePlatform, side, presentation);
  const scrimActive = modal && open && presentation !== 'fullscreen';
  return (
    <View
      testID={testID ? `${testID}-host` : undefined}
      pointerEvents="box-none"
      className={cn(persistent ? 'h-full' : 'absolute inset-0', modal && (side === 'start' ? 'z-sidebar' : 'z-dock'))}
      style={persistent ? { width } : undefined}
    >
      <Animated.View pointerEvents={scrimActive ? 'auto' : 'none'} className="absolute inset-0 bg-scrim" style={scrimStyle}>
        <RNPressable
          accessibilityRole="button"
          accessibilityLabel={`Close ${accessibilityLabel.toLowerCase()}`}
          accessibilityElementsHidden={!scrimActive}
          importantForAccessibility={scrimActive ? 'auto' : 'no-hide-descendants'}
          onPress={() => onOpenChange(false)}
          className="flex-1"
        />
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View
          testID={testID}
          accessibilityLabel={accessibilityLabel}
          accessibilityViewIsModal={modal && engaged}
          accessibilityElementsHidden={!engaged}
          importantForAccessibility={engaged ? 'auto' : 'no-hide-descendants'}
          onAccessibilityEscape={modal ? () => onOpenChange(false) : undefined}
          pointerEvents={engaged ? 'auto' : 'none'}
          className={cn(
            'overflow-hidden',
            persistent ? 'flex-1' : cn('absolute bottom-0 top-0', side === 'start' ? 'start-0' : 'end-0'),
            modal && presentation === 'overlay' && 'shadow-pop',
            SURFACE[surface],
            surface === 'android-modal' && presentation === 'overlay' && ANDROID_MODAL_CORNERS[side],
          )}
          style={[persistent ? undefined : { width }, panelStyle]}
        >
          <PanelGestureContext.Provider value={pan}>{mounted ? children : null}</PanelGestureContext.Provider>
        </Animated.View>
      </GestureDetector>
      {side === 'start' && modal && edgeOpenEnabled && !open ? (
        <GestureDetector gesture={edgePan}>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            className="absolute bottom-0 start-0"
            style={{ top: insets.top + geometry().heights.comfortable.bar, width: DRAWER_EDGE_WIDTH }}
          />
        </GestureDetector>
      ) : null}
    </View>
  );
}

/**
 * Wrap a horizontal scroller inside a panel (pane tab row, chip strips, code, diff): while it scrolls, the panel's
 * close pan is blocked (06 §3.4 rule 2). Outside a panel it renders its child unchanged.
 */
export function HorizontalScrollGuard({ children }: { children: React.ReactElement }): React.ReactElement {
  const panel = useContext(PanelGestureContext);
  if (!panel) return children;
  return <GestureDetector gesture={Gesture.Native().blocksExternalGesture(panel)}>{children}</GestureDetector>;
}
