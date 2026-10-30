// MP-30 Toast (03 MP-30; MD-26, MD-58): iOS a Liquid Glass capsule (GlassSurface `toast`: h48, radius 24) with a 600
// action — it slides (never fades: opacity kills glass, 02 §8.2); Android the M3 inverse snackbar (bg-fg / text-surface, radius 8).
// ToastHost shows the store's one toast bottom-centred 16 above the safe area (+ bottomOffset), times it out (never
// while a screen reader is on), announces it, and dismisses on swipe (iOS down, Android sideways) or the "Dismiss"
// accessibility action.
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeInDown, FadeOut, FadeOutDown, SlideInDown, SlideOutDown } from 'react-native-reanimated';

import { cn } from '../../lib/cn';
import { GlassSurface } from '../../native/GlassSurface';
import { nativePlatform } from '../../platform/geometry';
import { useInsets } from '../../platform/insets';
import { useReduceMotion } from '../../platform/motion';
import { Icon } from '../Icon';
import { Pressable } from '../Pressable';
import { Text } from '../Text';
import type { ToastHostProps, ToastOptions } from './Toast.types';
import { closeToast, pressToastAction, nextToastHostId, registerToastHost, subscribeToastHosts, toastActionLabel, toastDuration, topToastHost, useCurrentToast } from './toastModel';

export type { ToastHandle, ToastHostProps, ToastKind, ToastOptions } from './Toast.types';

/** The drawn toast (exported for stories); interactive parts call back into the store through the host. */
export function Toast({ options, onAction }: { options: ToastOptions; onAction?: () => void }): React.ReactElement {
  const android = nativePlatform === 'android';
  const action = toastActionLabel(options);
  const icon = options.icon ?? (options.kind === 'error' ? 'status-failed' : undefined);
  const content = (
    <>
      {icon ? <Icon concept={icon} size={18} tone={android ? 'surface' : options.kind === 'error' ? 'err' : 'fg-2'} /> : null}
      <Text role="subhead" tone={android ? 'surface' : 'fg'} numberOfLines={2} className="shrink py-3">
        {options.message}
      </Text>
      {action ? (
        <Pressable onPress={onAction} feedback="none" accessibilityRole="button" accessibilityLabel={action} className="px-3">
          <Text role="subhead" weight={600} tone={android ? 'surface' : 'fg'}>
            {action}
          </Text>
        </Pressable>
      ) : null}
    </>
  );
  if (!android) {
    return (
      <GlassSurface radiusStep="toast" className="min-h-toast flex-row items-center gap-2.5 pe-1.5 ps-4.5">
        {content}
      </GlassSurface>
    );
  }
  return <View className="min-h-toast flex-row items-center gap-2.5 rounded-toast bg-fg pe-1 ps-4 shadow-float">{content}</View>;
}

export function ToastHost({ bottomOffset = 0 }: ToastHostProps): React.ReactElement | null {
  const [host] = useState(nextToastHostId);
  useEffect(() => registerToastHost(host), [host]);
  const top = useSyncExternalStore(subscribeToastHosts, topToastHost);
  const current = useCurrentToast();
  const entry = host === top ? current : null;
  const insets = useInsets();
  const reduced = useReduceMotion();
  const [screenReader, setScreenReader] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isScreenReaderEnabled?.()
      .then(setScreenReader)
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener?.('screenReaderChanged', setScreenReader);
    return () => sub?.remove();
  }, []);
  useEffect(() => {
    if (!entry) return undefined;
    if (nativePlatform === 'ios') AccessibilityInfo.announceForAccessibility?.(entry.options.message);
    if (screenReader) return undefined;
    const timer = setTimeout(() => closeToast(entry.id, 'expired'), toastDuration(entry.options));
    return () => clearTimeout(timer);
  }, [entry, screenReader]);
  if (!entry) return null;

  const android = nativePlatform === 'android';
  const swipe = Gesture.Pan()
    .runOnJS(true)
    .onEnd((e) => {
      const far = android ? Math.abs(e.translationX) > 80 : e.translationY > 24;
      if (far) closeToast(entry.id, 'dismissed');
    });
  const action = toastActionLabel(entry.options);
  return (
    <View pointerEvents="box-none" className="absolute inset-x-4 items-center" style={{ bottom: insets.bottom + 16 + bottomOffset }}>
      <GestureDetector gesture={swipe}>
        <Animated.View
          key={entry.id}
          testID={entry.options.testID}
          entering={android ? (reduced ? FadeIn.duration(120) : FadeInDown.duration(220)) : reduced ? undefined : SlideInDown.duration(220)}
          exiting={android ? (reduced ? FadeOut.duration(120) : FadeOutDown.duration(180)) : reduced ? undefined : SlideOutDown.duration(180)}
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          accessibilityActions={[{ name: 'dismiss', label: 'Dismiss' }, ...(action ? [{ name: 'activate', label: action }] : [])]}
          onAccessibilityAction={(e) => (e.nativeEvent.actionName === 'dismiss' ? closeToast(entry.id, 'dismissed') : pressToastAction(entry.id))}
          className={cn('max-w-full', android && 'self-stretch')}
        >
          <Toast options={entry.options} onAction={() => pressToastAction(entry.id)} />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
