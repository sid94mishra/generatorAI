// ────────────────────────────────────────────────────────────────
// Mobile haptic concepts (mobile 02 §7.1, MD-78).
//
// Data only: design-tokens never imports `expo-haptics`. iOS entries name the
// `expo-haptics` call; Android entries are `AndroidHaptics` member names for
// `performAndroidHapticsAsync`, tried in order — the first whose `minApi` ≤
// the device API level is used. Every chain ends at an API ≤ 24 (minSdk).
// ────────────────────────────────────────────────────────────────

export const HAPTIC_CONCEPTS = [
  'selection',
  'threshold',
  'longPress',
  'dragStart',
  'dragTick',
  'success',
  'warning',
  'error',
  'fontStep',
] as const;
export type HapticConcept = (typeof HAPTIC_CONCEPTS)[number];

export type IosHaptic =
  | { kind: 'selection' }
  | { kind: 'impact'; style: 'light' | 'medium' | 'heavy' | 'soft' | 'rigid' }
  | { kind: 'notification'; type: 'success' | 'warning' | 'error' };

export type AndroidHapticMember =
  | 'Segment_Tick'
  | 'Segment_Frequent_Tick'
  | 'Toggle_On'
  | 'Toggle_Off'
  | 'Long_Press'
  | 'Gesture_Start'
  | 'Gesture_End'
  | 'Drag_Start'
  | 'Confirm'
  | 'Reject'
  | 'Clock_Tick'
  | 'Virtual_Key'
  | 'Context_Click';

export interface HapticSpec {
  ios: IosHaptic;
  /** Tried in order. */
  android: ReadonlyArray<{ member: AndroidHapticMember; minApi: number }>;
}

/** The app's minimum Android API level (Expo SDK default minSdkVersion). */
export const ANDROID_MIN_API = 24;

export const HAPTICS: Record<HapticConcept, HapticSpec> = {
  selection: {
    ios: { kind: 'selection' },
    android: [
      { member: 'Segment_Tick', minApi: 34 },
      { member: 'Clock_Tick', minApi: 21 },
    ],
  },
  threshold: {
    ios: { kind: 'impact', style: 'light' },
    android: [
      { member: 'Toggle_On', minApi: 34 },
      { member: 'Virtual_Key', minApi: 5 },
    ],
  },
  longPress: {
    ios: { kind: 'impact', style: 'medium' },
    android: [{ member: 'Long_Press', minApi: 3 }],
  },
  dragStart: {
    ios: { kind: 'impact', style: 'light' },
    android: [
      { member: 'Gesture_Start', minApi: 30 },
      { member: 'Long_Press', minApi: 3 },
    ],
  },
  dragTick: {
    ios: { kind: 'selection' },
    android: [
      { member: 'Segment_Frequent_Tick', minApi: 34 },
      { member: 'Clock_Tick', minApi: 21 },
    ],
  },
  success: {
    ios: { kind: 'notification', type: 'success' },
    android: [
      { member: 'Confirm', minApi: 30 },
      { member: 'Virtual_Key', minApi: 5 },
    ],
  },
  warning: {
    ios: { kind: 'notification', type: 'warning' },
    android: [
      { member: 'Reject', minApi: 30 },
      { member: 'Long_Press', minApi: 3 },
    ],
  },
  error: {
    ios: { kind: 'notification', type: 'error' },
    android: [
      { member: 'Reject', minApi: 30 },
      { member: 'Long_Press', minApi: 3 },
    ],
  },
  fontStep: {
    ios: { kind: 'selection' },
    android: [
      { member: 'Segment_Tick', minApi: 34 },
      { member: 'Clock_Tick', minApi: 21 },
    ],
  },
};
