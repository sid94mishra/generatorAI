// ────────────────────────────────────────────────────────────────
// KeyboardSticky — keeps its child docked above the keyboard.
//
// The replacement for the `KeyboardAvoidingView` + measured-offset pattern,
// which needed every screen to know its own header height and got it wrong
// the moment a banner appeared above the composer.
//
// Two modes:
//   translate  the child slides up by the keyboard height. Compositor-only,
//              so it stays glued to the keyboard mid-token-stream. The
//              content BEHIND it does not know — a list under a translated
//              composer needs its own bottom inset (pass the same shared
//              value to it, or use `padding`).
//   padding    the container grows a bottom pad instead. Triggers layout on
//              every frame of the keyboard animation, but everything above
//              reflows correctly with no extra wiring.
//
// On Android the window already resizes (`softwareKeyboardLayoutMode:
// 'resize'`), so `useKeyboardHeight` reports 0 and this is a plain wrapper.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import type { ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { useKeyboardHeight, type KeyboardOptions } from './keyboard';

export interface KeyboardStickyProps extends KeyboardOptions {
  children: React.ReactNode;
  /**
   * Height already sitting between the child and the screen's bottom edge
   * (a tab bar, the home indicator when the child is inset for it). The lift
   * is reduced by this so the child lands ON the keyboard, not above a gap.
   */
  offset?: number;
  mode?: 'translate' | 'padding';
  enabled?: boolean;
  className?: string;
  style?: ViewStyle;
}

export function KeyboardSticky({
  children,
  offset = 0,
  mode = 'translate',
  enabled = true,
  androidResizes,
  className,
  style,
}: KeyboardStickyProps): React.ReactElement {
  const keyboard = useKeyboardHeight(androidResizes === undefined ? undefined : { androidResizes });

  const animatedStyle = useAnimatedStyle(() => {
    const lift = enabled ? Math.max(0, keyboard.value - offset) : 0;
    return mode === 'padding' ? { paddingBottom: lift } : { transform: [{ translateY: -lift }] };
  }, [enabled, offset, mode]);

  return (
    <Animated.View className={className} style={[style, animatedStyle]}>
      {children}
    </Animated.View>
  );
}
