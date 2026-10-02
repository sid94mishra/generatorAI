// Hardware keyboard presence (iPad, Android tablets). The device-key module reports it from M5-09;
// until then it stays false, so keyboard-only affordances (KbdHint) are hidden.
import { useSyncExternalStore } from 'react';

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
