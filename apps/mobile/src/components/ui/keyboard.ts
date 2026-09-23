// ────────────────────────────────────────────────────────────────
// Keyboard geometry, shared by the chat composer and sheets.
//
// v3 — built on react-native-keyboard-controller.
//
// The previous version listened to React Native's own `Keyboard` events and
// reconstructed the overlap from them. That was wrong in the two ways users
// actually saw:
//
//   • Android only emits `keyboardDidShow` — AFTER the keyboard has finished
//     rising — so the composer sat under the keyboard for the length of the
//     animation and then jumped. The reported height also excludes the bottom
//     system bar on some configurations and includes it on others (gesture
//     pill vs 3-button bar, OEM skins), so adding the safe-area inset back
//     was right on one phone and left the input half covered on the next.
//   • iOS `keyboardWillChangeFrame` gives an end frame and a duration, not
//     the curve; re-creating it with a bezier is close, never exact, and the
//     interactive (drag-to-dismiss) keyboard does not report through it.
//
// The controller reads the IME inset from the platform's own animation
// callback (`WindowInsetsAnimation` on Android, the keyboard layout guide on
// iOS) on every frame, on the UI thread. The value below is therefore the
// keyboard's true overlap with the bottom of the window at that instant, on
// both platforms, edge-to-edge or not — no per-platform arithmetic left here.
//
// On web (the Expo preview) the controller's bindings are inert and the value
// stays 0: the browser resizes the visual viewport itself.
// ────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import { KeyboardEvents, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { useDerivedValue, type DerivedValue } from 'react-native-reanimated';

/** Kept so existing callers compile; the controller needs no options. */
export interface KeyboardOptions {
  /** @deprecated No longer used — the controller measures the real inset. */
  androidResizes?: boolean;
}

/**
 * How much of the window's bottom the keyboard covers right now, in points,
 * as a UI-thread value that follows the keyboard frame by frame (including an
 * interactive dismiss). 0 when hidden, floating or undocked.
 *
 * It measures from the bottom EDGE of the window, so a view already inset for
 * the home indicator / gesture bar should lift by `max(value, bottomInset)`,
 * not by their sum.
 */
export function useKeyboardHeight(_options?: KeyboardOptions): DerivedValue<number> {
  const { height } = useReanimatedKeyboardAnimation();
  // The controller reports a negative translation (−height when open).
  return useDerivedValue(() => Math.max(0, -height.value));
}

/** JS-side "is the keyboard up", for layout that cannot read a shared value. */
export function useKeyboardShown(): boolean {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const show = KeyboardEvents.addListener('keyboardWillShow', () => setShown(true));
    const hide = KeyboardEvents.addListener('keyboardDidHide', () => setShown(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return shown;
}
