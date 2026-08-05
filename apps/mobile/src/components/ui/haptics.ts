// ────────────────────────────────────────────────────────────────
// Haptics — one vocabulary, used everywhere.
//
// Wrapped rather than called directly for two reasons:
//   1. expo-haptics throws on web (`react-native-web` has no Taptic Engine),
//      and the mobile app is developed in a browser preview.
//   2. Having exactly five verbs stops the codebase from drifting into
//      "impactHeavy on a list row", which is what makes an app feel cheap.
// ────────────────────────────────────────────────────────────────

import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

const supported = Platform.OS === 'ios' || Platform.OS === 'android';

// A module-level flag rather than a hook so every call site stays
// `haptics.tap()`. `PreferencesProvider` owns the value and pushes it here on
// mount and on every change.
let userEnabled = true;

export function setHapticsEnabled(enabled: boolean): void {
  userEnabled = enabled;
}

function safe(run: () => Promise<unknown>): void {
  if (!supported || !userEnabled) return;
  // Fire and forget: a failed haptic must never reject into a render path.
  void run().catch(() => {});
}

export const haptics = {
  /** Moving between options — segmented control, picker row, chip. */
  select: () => safe(() => Haptics.selectionAsync()),
  /** Tapping something that navigates or opens. */
  tap: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** Committing — send, approve, submit. */
  commit: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  /** Crossing a gesture threshold — swipe action armed, sheet detent caught. */
  threshold: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid)),
  /** A terminal good outcome. */
  success: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  /** A caution — a destructive confirmation opening. */
  warn: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  /** A refusal or a failure. */
  error: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
} as const;
