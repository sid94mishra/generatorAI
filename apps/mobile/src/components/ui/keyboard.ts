// ────────────────────────────────────────────────────────────────
// Keyboard tracking — RN `Keyboard` events into a Reanimated shared value.
//
// Why not `useAnimatedKeyboard`: on Android it rewrites the window's soft
// input mode behind the app's back, and this app relies on
// `softwareKeyboardLayoutMode: 'resize'` (app.config) — the window itself
// shrinks, so anything that ALSO lifts by the keyboard height ends up twice
// as high as it should be. RN's own `Modal` on Android does the same
// (`SOFT_INPUT_ADJUST_RESIZE`, `ReactModalHostView`). The honest answer is
// therefore: on Android the keyboard is a layout event, not an animation.
//
// On iOS nothing resizes, so the height is animated with the duration the
// OS reports in `keyboardWillShow`, which is what keeps a docked composer
// glued to the keyboard's top edge instead of arriving a beat after it.
// ────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import { Keyboard, Platform, type KeyboardEvent } from 'react-native';
import { Easing, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

import { DURATION } from './motion';

/**
 * A close fit for UIKit's keyboard curve. Apple does not publish it; this is
 * the widely-used approximation and the difference is not visible.
 */
const IOS_KEYBOARD_EASING = Easing.bezier(0.38, 0.7, 0.125, 1);

export interface KeyboardOptions {
  /**
   * On Android, whether the window already resizes for the keyboard. True
   * here (see app.config), so the reported height is 0 and any consumer is
   * a no-op. Pass false only inside a window that uses `pan` or `nothing`.
   */
  androidResizes?: boolean;
}

const DEFAULTS: Required<KeyboardOptions> = { androidResizes: true };

function reportedHeight(event: KeyboardEvent, options: Required<KeyboardOptions>): number {
  if (Platform.OS === 'android' && options.androidResizes) return 0;
  return Math.max(0, event.endCoordinates?.height ?? 0);
}

/**
 * The keyboard's height as a shared value, animated on iOS, stepped on
 * Android, always 0 on web.
 *
 * Read it in a `useAnimatedStyle`; never on the JS thread per frame.
 */
export function useKeyboardHeight(options?: KeyboardOptions): SharedValue<number> {
  const height = useSharedValue(0);
  const androidResizes = options?.androidResizes ?? DEFAULTS.androidResizes;

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const resolved = { androidResizes };

    const show = (event: KeyboardEvent) => {
      const next = reportedHeight(event, resolved);
      if (Platform.OS === 'ios') {
        height.value = withTiming(next, {
          duration: event.duration > 0 ? event.duration : DURATION.slow,
          easing: IOS_KEYBOARD_EASING,
        });
      } else {
        height.value = next;
      }
    };

    const hide = (event: KeyboardEvent) => {
      if (Platform.OS === 'ios') {
        height.value = withTiming(0, {
          duration: event.duration > 0 ? event.duration : DURATION.slow,
          easing: IOS_KEYBOARD_EASING,
        });
      } else {
        height.value = 0;
      }
    };

    // `will*` fires only on iOS; Android delivers `did*` after the fact.
    const showName = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideName = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showName, show);
    const hideSub = Keyboard.addListener(hideName, hide);
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [height, androidResizes]);

  return height;
}

/**
 * Whether the keyboard is up, as React state.
 *
 * For the rare JS decision (hide a FAB, swap a footer) — not for layout,
 * which belongs to `useKeyboardHeight` on the UI thread.
 */
export function useKeyboardShown(): boolean {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const showName = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideName = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showName, () => setShown(true));
    const hideSub = Keyboard.addListener(hideName, () => setShown(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  return shown;
}
