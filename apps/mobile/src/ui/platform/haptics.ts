// haptic(concept) — the only importer of expo-haptics (lint `hapticsImport`; mobile 02 §7.2, MD-78).
// Fire-and-forget: never throws, never awaited in render. Concepts map through HAPTICS (design-tokens):
// iOS calls the named expo-haptics function; Android tries the AndroidHaptics chain in order and plays the first
// member whose minApi ≤ the device API. Settings › Haptics turns every concept off (setHapticsEnabled).
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { HAPTICS, type AndroidHapticMember, type HapticConcept, type HapticSpec } from '@generatorai/design-tokens';

let enabled = true;
const lastFired = new Map<HapticConcept, number>();
/** The same concept is not fired again within this window (02 §7.2 step 4). */
export const HAPTIC_THROTTLE_MS = 40;

/** Pushed by the preferences bridge (Settings › Haptics). */
export function setHapticsEnabled(next: boolean): void {
  enabled = next;
}

/** The Android chain entry to play on a device API level (exported for tests). */
export function androidMemberFor(spec: HapticSpec, apiLevel: number): AndroidHapticMember | null {
  // An unknown API level takes the chain's most compatible (last) entry.
  if (!Number.isFinite(apiLevel)) return spec.android.at(-1)?.member ?? null;
  return spec.android.find((entry) => entry.minApi <= apiLevel)?.member ?? null;
}

const ANDROID_HAPTIC: Record<AndroidHapticMember, Haptics.AndroidHaptics> = {
  Segment_Tick: Haptics.AndroidHaptics.Segment_Tick,
  Segment_Frequent_Tick: Haptics.AndroidHaptics.Segment_Frequent_Tick,
  Toggle_On: Haptics.AndroidHaptics.Toggle_On,
  Toggle_Off: Haptics.AndroidHaptics.Toggle_Off,
  Long_Press: Haptics.AndroidHaptics.Long_Press,
  Gesture_Start: Haptics.AndroidHaptics.Gesture_Start,
  Gesture_End: Haptics.AndroidHaptics.Gesture_End,
  Drag_Start: Haptics.AndroidHaptics.Drag_Start,
  Confirm: Haptics.AndroidHaptics.Confirm,
  Reject: Haptics.AndroidHaptics.Reject,
  Clock_Tick: Haptics.AndroidHaptics.Clock_Tick,
  Virtual_Key: Haptics.AndroidHaptics.Virtual_Key,
  Context_Click: Haptics.AndroidHaptics.Context_Click,
};

const IMPACT: Record<'light' | 'medium' | 'heavy' | 'soft' | 'rigid', Haptics.ImpactFeedbackStyle> = {
  light: Haptics.ImpactFeedbackStyle.Light,
  medium: Haptics.ImpactFeedbackStyle.Medium,
  heavy: Haptics.ImpactFeedbackStyle.Heavy,
  soft: Haptics.ImpactFeedbackStyle.Soft,
  rigid: Haptics.ImpactFeedbackStyle.Rigid,
};

const NOTIFICATION: Record<'success' | 'warning' | 'error', Haptics.NotificationFeedbackType> = {
  success: Haptics.NotificationFeedbackType.Success,
  warning: Haptics.NotificationFeedbackType.Warning,
  error: Haptics.NotificationFeedbackType.Error,
};

function play(spec: HapticSpec): Promise<void> | undefined {
  if (Platform.OS === 'android') {
    const member = androidMemberFor(spec, Number(Platform.Version));
    return member ? Haptics.performAndroidHapticsAsync(ANDROID_HAPTIC[member]) : undefined;
  }
  if (Platform.OS !== 'ios') return undefined;
  const ios = spec.ios;
  if (ios.kind === 'selection') return Haptics.selectionAsync();
  if (ios.kind === 'impact') return Haptics.impactAsync(IMPACT[ios.style]);
  return Haptics.notificationAsync(NOTIFICATION[ios.type]);
}

export function haptic(concept: HapticConcept, now: number = Date.now()): void {
  if (!enabled) return;
  const spec = HAPTICS[concept];
  if (!spec) return;
  const last = lastFired.get(concept);
  if (last !== undefined && now - last < HAPTIC_THROTTLE_MS) return;
  lastFired.set(concept, now);
  try {
    void play(spec)?.catch(() => undefined);
  } catch {
    // A missing native module or an unsupported constant never breaks a tap.
  }
}
