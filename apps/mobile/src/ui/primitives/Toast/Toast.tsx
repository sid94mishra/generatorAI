// MP-30 Toast (03 MP-30; MD-26, MD-58): iOS a floating capsule (h48, rounded-toast 24, glass via GlassSurface's
// fallback recipe until M4-08) with a 600 action; Android the M3 inverse snackbar (bg-fg / text-surface, radius 8).
// ToastHost shows the store's one toast bottom-centred 16 above the safe area (+ bottomOffset), times it out (never
// while a screen reader is on), announces it, and dismisses on swipe (iOS down, Android sideways) or the "Dismiss"
// accessibility action.
import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeInDown, FadeOut, FadeOutDown } from 'react-native-reanimated';

import { cn } from '../../lib/cn';
import { nativePlatform } from '../../platform/geometry';
import { useInsets } from '../../platform/insets';
import { useReduceMotion } from '../../platform/motion';
import { Icon } from '../Icon';
import { Pressable } from '../Pressable';
import { Text } from '../Text';
import type { ToastHostProps, ToastOptions } from './Toast.types';
import { closeToast, pressToastAction, toastActionLabel, toastDuration, useCurrentToast } from './toastModel';

export type { ToastHandle, ToastHostProps, ToastKind, ToastOptions } from './Toast.types';

/** The drawn toast (exported for stories); interactive parts call back into the store through the host. */
export function Toast({ options, onAction }: { options: ToastOptions; onAction?: () => void }): React.ReactElement {
  const android = nativePlatform === 'android';
  const action = toastActionLabel(options);
  const icon = options.icon ?? (options.kind === 'error' ? 'status-failed' : undefined);
  return (
    <View
      className={cn(
        'min-h-toast flex-row items-center gap-2.5 rounded-toast',
        android ? 'bg-fg ps-4 pe-1 shadow-float' : 'border border-line bg-overlay ps-4.5 pe-1.5 shadow-float',
      )}
    >
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
    </View>
  );
}

export function ToastHost({ bottomOffset = 0 }: ToastHostProps): React.ReactElement | null {
  const entry = useCurrentToast();
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
          entering={reduced ? FadeIn.duration(120) : FadeInDown.duration(220)}
          exiting={reduced ? FadeOut.duration(120) : FadeOutDown.duration(180)}
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
