// ML-10 Sheet — the imperative sheet host. TrueSheet is not in the dev clients (MD-131), so this JS host stands in
// for it with the 02 §3.6 JS-fallback geometry: iOS an inset panel (8, rounded-dialog 38) with the 36 × 5 grabber,
// Android edge-attached with 28 top corners and the 32 × 4 handle at 60 %. Detents content / medium / large; drag
// the grabber or header between them, below the smallest dismisses; the grabber also cycles on tap. Scrim tap, Back
// and Escape dismiss; every dismissal is guarded while dirty. `useSheet()` presents one sheet at a time (MD-62).
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Modal, Pressable as RNPressable, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Animated, { FadeIn, SlideInDown, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { cn } from '../../lib/cn';
import { useDirtyGuard } from '../../layout/DirtyGuard/useDirtyGuard';
import { nativePlatform } from '../../platform/geometry';
import { useInsets } from '../../platform/insets';
import { useReduceMotion } from '../../platform/motion';
import { Pressable } from '../../primitives/Pressable';
import { Sheet } from './Sheet';
import type { PresentOptions, SheetController, SheetProps } from './Sheet.types';
import { DEFAULT_DETENTS, detentHeight, dragOutcome } from './sheetModel';

export interface SheetModalProps extends SheetProps {
  open: boolean;
}

export function SheetModal({ open, ...props }: SheetModalProps): React.ReactElement {
  const { detents = DEFAULT_DETENTS, initialDetent = 0, dirty = false, onDismiss } = props;
  const window = useWindowDimensions();
  const insets = useInsets();
  const reduced = useReduceMotion();
  const [index, setIndex] = useState(Math.min(initialDetent, detents.length - 1));
  const [contentHeight, setContentHeight] = useState(0);
  const drag = useSharedValue(0);
  const { guard } = useDirtyGuard(dirty && open);
  const android = nativePlatform === 'android';

  const detent = detents[index] ?? 'large';
  const height = detent === 'content' && contentHeight === 0 ? undefined : detentHeight(detent, window.height - insets.top, contentHeight);
  const close = (): void => void guard(onDismiss);
  const settle = (outcome: ReturnType<typeof dragOutcome>): void => {
    drag.set(withTiming(0, { duration: reduced ? 0 : 200 }));
    if (outcome.kind === 'dismiss') close();
    else setIndex(outcome.index);
  };
  const pan = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetY([-8, 8])
    .onUpdate((e) => drag.set(Math.max(-80, e.translationY)))
    .onEnd((e) => settle(dragOutcome({ translation: e.translationY, velocity: e.velocityY, height: height ?? contentHeight, index, count: detents.length })));
  const dragStyle = useAnimatedStyle(() => ({ transform: [{ translateY: Math.max(0, drag.value) }] }));

  return (
    <Modal visible={open} transparent animationType="none" onRequestClose={close} statusBarTranslucent navigationBarTranslucent>
      <Animated.View entering={reduced ? undefined : FadeIn.duration(180)} className="absolute inset-0 bg-scrim">
        <RNPressable accessibilityRole="button" accessibilityLabel="Close sheet" onPress={close} className="flex-1" />
      </Animated.View>
      <KeyboardAvoidingView behavior="padding" className="flex-1 justify-end" pointerEvents="box-none">
        <Animated.View
          entering={reduced ? FadeIn.duration(120) : SlideInDown.duration(260)}
          className={cn('overflow-hidden bg-overlay', android ? 'rounded-t-dialog' : 'mx-2 mb-2 rounded-dialog')}
          style={[dragStyle, height === undefined ? { maxHeight: window.height - insets.top } : { height }]}
        >
          <GestureDetector gesture={pan}>
            <View>
              <Pressable
                onPress={() => setIndex((i) => (i + 1) % detents.length)}
                frame="none"
                feedback="none"
                accessibilityRole="adjustable"
                accessibilityLabel="Resize sheet"
                accessibilityActions={[{ name: 'increment', label: 'Larger' }, { name: 'decrement', label: 'Smaller' }]}
                onAccessibilityAction={(name) => setIndex((i) => Math.max(0, Math.min(detents.length - 1, i + (name === 'increment' ? 1 : -1))))}
                className="items-center pb-1 pt-1.5"
              >
                <View className={cn('rounded-full bg-fg-3', android ? 'h-1 w-8 opacity-60' : 'h-1.25 w-9')} />
              </Pressable>
            </View>
          </GestureDetector>
          <View onLayout={(e) => detent === 'content' && setContentHeight(e.nativeEvent.layout.height + 16)} className={cn(height !== undefined && 'flex-1')}>
            <Sheet {...props} />
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const SheetContext = createContext<SheetController | null>(null);

/** Mount once (the M5 shell does); `useSheet()` then presents imperative sheets. */
export function SheetProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [current, setCurrent] = useState<{ content: React.ReactNode; options: PresentOptions; key: number } | null>(null);
  const dismiss = useCallback(() => setCurrent(null), []);
  const present = useCallback((content: React.ReactNode, options: PresentOptions) => setCurrent((prev) => ({ content, options, key: (prev?.key ?? 0) + 1 })), []);
  const controller = useMemo(() => ({ present, dismiss }), [present, dismiss]);
  return (
    <SheetContext.Provider value={controller}>
      {children}
      {current ? (
        <SheetModal
          key={current.key}
          open
          {...current.options}
          onDismiss={() => {
            dismiss();
            current.options.onDismiss?.();
          }}
        >
          {current.content}
        </SheetModal>
      ) : null}
    </SheetContext.Provider>
  );
}

export function useSheet(): SheetController {
  const controller = useContext(SheetContext);
  if (!controller) throw new Error('useSheet() needs a SheetProvider above it (mounted by the app shell).');
  return controller;
}
