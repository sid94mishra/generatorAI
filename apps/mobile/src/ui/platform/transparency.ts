// Reduce Transparency (iOS; Android reports none): glass becomes the opaque fallback (mobile 02 §8.2, MD-28).
// Like motion (MD-76), the OS switch merges with the app preference (Settings › Appearance: 'system' follows the OS,
// 'reduced' / 'full' override it), pushed by the preferences bridge.
import { useEffect, useSyncExternalStore } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

export type TransparencyPreference = 'system' | 'reduced' | 'full';

let preference: TransparencyPreference = 'system';
let osReduced = false;
const listeners = new Set<() => void>();
const notify = (): void => listeners.forEach((l) => l());

/** Pushed by the preferences bridge (Settings › Appearance › Reduce transparency). */
export function setTransparencyPreference(next: TransparencyPreference): void {
  if (preference === next) return;
  preference = next;
  notify();
}

/** Effective value for a preference and the OS switch (exported for tests). */
export function reduceTransparencyFor(pref: TransparencyPreference, os: boolean): boolean {
  return pref === 'reduced' ? true : pref === 'full' ? false : os;
}

let subscribedToOs = false;
function ensureOsSubscription(): void {
  if (subscribedToOs || Platform.OS !== 'ios') return;
  subscribedToOs = true;
  void AccessibilityInfo.isReduceTransparencyEnabled?.()
    .then((value) => {
      osReduced = value;
      notify();
    })
    .catch(() => undefined);
  AccessibilityInfo.addEventListener?.('reduceTransparencyChanged', (value: boolean) => {
    osReduced = value;
    notify();
  });
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The OS switch alone (Settings › Appearance shows what "System" currently means). */
export function useOsReduceTransparency(): boolean {
  useEffect(ensureOsSubscription, []);
  return useSyncExternalStore(subscribe, () => osReduced);
}

export function useReduceTransparency(): boolean {
  useEffect(ensureOsSubscription, []);
  return useSyncExternalStore(subscribe, () => Platform.OS === 'ios' && reduceTransparencyFor(preference, osReduced));
}
