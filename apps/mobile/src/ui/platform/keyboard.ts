// Hardware keyboard presence (iPad, Android tablets). The device-key module reports it from M5-09;
// until then it stays false, so keyboard-only affordances (KbdHint) are hidden.
import { useSyncExternalStore } from 'react';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { useDerivedValue, type DerivedValue } from 'react-native-reanimated';

let attached = false;
const listeners = new Set<() => void>();

export function setHardwareKeyboardAttached(next: boolean): void {
  if (attached === next) return;
  attached = next;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useHardwareKeyboard(): boolean {
  return useSyncExternalStore(subscribe, () => attached);
}

/**
 * How much of the window's bottom the software keyboard covers right now, as a UI-thread value that follows the
 * keyboard frame by frame (react-native-keyboard-controller; includes the interactive dismiss). 0 when hidden,
 * floating or undocked. A view already inset for the home indicator / gesture bar lifts by `max(value, bottomInset)`.
 */
export function useKeyboardOverlap(): DerivedValue<number> {
  const { height } = useReanimatedKeyboardAnimation();
  // The controller reports a negative translation (−height when open).
  return useDerivedValue(() => Math.max(0, -height.value));
}
