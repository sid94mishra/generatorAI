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
// On iOS nothing resizes, so the overlap is animated with the duration the
// OS reports, which is what keeps a docked composer glued to the keyboard's
// top edge instead of arriving a beat after it. iOS listens to
// `keyboardWillChangeFrame` (not just will-show/hide): it is the only event
// that fires when the predictive bar appears, the keyboard is undocked or
// floated on iPad, or a hardware keyboard swaps it for the shortcut bar. The
// value is the OVERLAP with the window (`keyboardMath.keyboardOverlap`), not
// the reported height, which is wrong for every one of those cases.
//
// Android keeps `did*` and the reported height: RN reports Android's
// `screenY` in root-view coordinates, which do not line up with the window
// dimensions under edge-to-edge, and the height path is the one verified on
// device. That is the one genuine platform difference here.
// ────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import { Dimensions, Keyboard, Platform, type KeyboardEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Easing, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

import { DURATION } from './motion';
import { androidKeyboardOverlap, keyboardOverlap } from './keyboardMath';

/**
 * A close fit for UIKit's keyboard curve. Apple does not publish it; this is
 * the widely-used approximation and the difference is not visible.
 */
const IOS_KEYBOARD_EASING = Easing.bezier(0.38, 0.7, 0.125, 1);

export interface KeyboardOptions {
  /**
   * On Android, whether the window already resizes for the keyboard. It does
   * NOT: Expo SDK 57 enforces edge-to-edge, under which
   * `softwareKeyboardLayoutMode: 'resize'` (adjustResize) is ignored, so with
   * the old default of `true` nothing lifted the chat composer or a sheet and
   * the keyboard covered the field being typed into (found on an API 35
   * emulator). Pass `true` only inside a window that genuinely resizes.
   */
  androidResizes?: boolean;
}

const DEFAULTS: Required<KeyboardOptions> = { androidResizes: false };

/** How much of the window the keyboard in `event` covers. */
function reportedOverlap(event: KeyboardEvent | null, options: Required<KeyboardOptions>, bottomInset = 0): number {
  if (!event) return 0;
  if (Platform.OS === 'android') {
    return androidKeyboardOverlap(event.endCoordinates?.height ?? 0, bottomInset, options.androidResizes);
  }
  return keyboardOverlap(event.endCoordinates, Dimensions.get('window').height);
}

/** Subscribe to every keyboard geometry change; `null` means hidden. */
function subscribeKeyboard(listener: (event: KeyboardEvent | null, hiding: boolean) => void): () => void {
  if (Platform.OS === 'web') return () => undefined;
  const subs =
    Platform.OS === 'ios'
      ? [
          // Show, resize, undock/float and hide all arrive here, in order.
          Keyboard.addListener('keyboardWillChangeFrame', (event) => listener(event, false)),
          // Belt and braces: some iPad transitions end with only a will-hide.
          Keyboard.addListener('keyboardWillHide', (event) => listener(event, true)),
        ]
      : [
          // `will*` never fires on Android; `did*` arrives after the fact.
          Keyboard.addListener('keyboardDidShow', (event) => listener(event, false)),
          Keyboard.addListener('keyboardDidHide', (event) => listener(event, true)),
        ];
  return () => {
    for (const sub of subs) sub.remove();
  };
}

/**
 * The keyboard's overlap with the window as a shared value, animated on iOS,
 * stepped on Android, always 0 on web.
 *
 * Read it in a `useAnimatedStyle`; never on the JS thread per frame.
 */
export function useKeyboardHeight(options?: KeyboardOptions): SharedValue<number> {
  const { bottom } = useSafeAreaInsets();
  const height = useSharedValue(0);
  const androidResizes = options?.androidResizes ?? DEFAULTS.androidResizes;

  useEffect(() => {
    const resolved = { androidResizes };
    return subscribeKeyboard((event, hiding) => {
      const next = hiding ? 0 : reportedOverlap(event, resolved, bottom);
      if (Platform.OS === 'ios') {
        const duration = event && event.duration > 0 ? event.duration : DURATION.slow;
        height.value = withTiming(next, { duration, easing: IOS_KEYBOARD_EASING });
      } else {
        height.value = next;
      }
    });
  }, [height, androidResizes, bottom]);

  return height;
}

/**
 * Whether the keyboard covers any of the window, as React state.
 *
 * For the rare JS decision (hide a FAB, swap a footer) — not for layout,
 * which belongs to `useKeyboardHeight` on the UI thread. A floating iPad
 * keyboard counts as not shown: it covers nothing anchored to the bottom.
 */
export function useKeyboardShown(): boolean {
  const [shown, setShown] = useState(false);

  useEffect(
    () =>
      subscribeKeyboard((event, hiding) => {
        setShown(!hiding && reportedOverlap(event, DEFAULTS) > 0);
      }),
    [],
  );

  return shown;
}
