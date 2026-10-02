// MP-49 Popover (03 MP-49): a JS floating panel above or below its anchor — iOS rounded 24 (glass fallback recipe
// until GlassSurface, M4-08), Android bg-overlay rounded 16; shadow-pop. It is not modal: typing continues, the
// keyboard stays, and its height is capped to half the space above the keyboard. A tap outside or Escape closes it.
// It renders in place (absolute inside its container), so the caller mounts it inside the composer / anchor's
// container; an invisible backdrop over the rest of the window catches outside taps.
import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Pressable as RNPressable, View, useWindowDimensions } from 'react-native';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, { FadeIn, FadeOut, useAnimatedStyle } from 'react-native-reanimated';

import { cn } from '../../lib/cn';
import { nativePlatform } from '../../platform/geometry';
import { useReduceMotion } from '../../platform/motion';
import type { PopoverProps } from './Popover.types';
import { POPOVER_OVERLAY_ID, popoverAnnouncement, popoverMaxHeight, popoverOffsets } from './popoverModel';

export type { PopoverProps } from './Popover.types';

export function Popover({ open, onOpenChange, anchor, placement = 'top', children, accessibilityLabel, resultCount, testID }: PopoverProps): React.ReactElement | null {
  const window = useWindowDimensions();
  const reduced = useReduceMotion();
  const keyboard = useReanimatedKeyboardAnimation();
  const [container, setContainer] = useState<View | null>(null);
  const [size, setSize] = useState({ height: 0 });
  const [rect, setRect] = useState<{ y: number; height: number } | null>(null);
  const close = (): void => onOpenChange(false);

  useEffect(() => {
    if (!open || anchor === 'composer' || !anchor.current || !container) return;
    anchor.current.measureLayout(container, (_x, y, _w, height) => setRect({ y, height }), () => setRect(null));
  }, [open, anchor, container, size.height]);
  const announcement = popoverAnnouncement(accessibilityLabel, resultCount);
  useEffect(() => {
    if (open && nativePlatform === 'ios') AccessibilityInfo.announceForAccessibility?.(announcement);
  }, [open, announcement]);
  const capped = useAnimatedStyle(() => ({ maxHeight: popoverMaxHeight(window.height, keyboard.height.value) }), [window.height]);

  if (!open) return null;
  const offsets = popoverOffsets(anchor === 'composer' ? null : rect, anchor === 'composer' ? 0 : size.height, placement);
  return (
    <View ref={setContainer} onLayout={(e) => setSize({ height: e.nativeEvent.layout.height })} pointerEvents="box-none" className="absolute inset-0" nativeID={POPOVER_OVERLAY_ID}>
      <RNPressable
        accessible={false}
        onPress={close}
        className="absolute"
        style={{ top: -window.height, bottom: -window.height, left: -window.width, right: -window.width }}
      />
      <Animated.View
        testID={testID}
        entering={reduced ? undefined : FadeIn.duration(120)}
        exiting={reduced ? undefined : FadeOut.duration(120)}
        accessibilityViewIsModal={false}
        accessibilityLabel={announcement}
        accessibilityLiveRegion="polite"
        onAccessibilityEscape={close}
        className={cn(
          'absolute inset-x-0 overflow-hidden shadow-pop',
          nativePlatform === 'android' ? 'rounded-card-lg bg-overlay' : 'rounded-toast border border-line bg-overlay',
        )}
        style={[offsets, capped]}
      >
        <Animated.ScrollView keyboardShouldPersistTaps="always" contentContainerClassName="py-1.5">
          {children}
        </Animated.ScrollView>
      </Animated.View>
    </View>
  );
}
