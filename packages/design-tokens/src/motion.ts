// ────────────────────────────────────────────────────────────────
// Mobile motion concepts (mobile 02 §6, MD-76).
//
// `MOTION` (tokens.ts) and web's `MOTION_CSS` are untouched; this is the
// additive spring vocabulary the mobile kit reads through
// `apps/mobile/src/ui/platform/motion.ts` (`useMotion(concept)`).
//
// Physics springs, mass 1, from the two sources of §6.1:
//   iOS SwiftUI `.smooth` / `.snappy`: stiffness = (2π / duration)²,
//     dampingRatio = 1 − bounce, damping = 2 × ζ × √stiffness;
//   Android M3 Expressive standard scheme: (ζ, stiffness) pairs,
//     damping = 2 × ζ × √stiffness.
// No spring overshoots: every ζ ∈ [0.85, 1] (MD-76).
// ────────────────────────────────────────────────────────────────

export type MotionConcept = 'press' | 'toggle' | 'panel' | 'sheet' | 'reveal' | 'listInsert' | 'swipe' | 'spinner';

export interface SpringSpec {
  kind: 'spring';
  stiffness: number;
  damping: number;
  mass: 1;
}
export interface TimingSpec {
  kind: 'timing';
  duration: number;
  easing: 'standard' | 'linear';
}
export interface NativeSpec {
  kind: 'native';
}
export interface NoneSpec {
  kind: 'none';
}
export interface FadeSpec {
  kind: 'fade';
  duration: number;
}
export type MotionSpec = SpringSpec | TimingSpec | NativeSpec | NoneSpec;
export type ReducedSpec = FadeSpec | TimingSpec | NoneSpec | NativeSpec;

export interface PlatformMotion {
  /** Position / size / transform. */
  spatial: MotionSpec;
  /** Opacity / colour. */
  effects: MotionSpec;
}

export interface MotionConceptSpec {
  ios: PlatformMotion;
  android: PlatformMotion;
  reduced: ReducedSpec;
  /** press only */
  pressScale?: { default: 0.97; large: 0.985 };
}

export const SPRINGS = {
  ios: {
    smooth500: { kind: 'spring', stiffness: 157.91, damping: 25.13, mass: 1 },
    smooth350: { kind: 'spring', stiffness: 322.27, damping: 35.9, mass: 1 },
    smooth300: { kind: 'spring', stiffness: 438.65, damping: 41.89, mass: 1 },
    snappy350: { kind: 'spring', stiffness: 322.27, damping: 30.52, mass: 1 },
  },
  m3: {
    spatialDefault: { kind: 'spring', stiffness: 700, damping: 47.62, mass: 1 },
    spatialFast: { kind: 'spring', stiffness: 1400, damping: 67.35, mass: 1 },
    spatialSlow: { kind: 'spring', stiffness: 300, damping: 31.18, mass: 1 },
    effectsDefault: { kind: 'spring', stiffness: 1600, damping: 80, mass: 1 },
    effectsFast: { kind: 'spring', stiffness: 3800, damping: 123.29, mass: 1 },
    effectsSlow: { kind: 'spring', stiffness: 800, damping: 56.57, mass: 1 },
  },
} as const satisfies Record<'ios' | 'm3', Record<string, SpringSpec>>;

const T = (duration: number, easing: TimingSpec['easing'] = 'standard'): TimingSpec => ({ kind: 'timing', duration, easing });
const NONE: NoneSpec = { kind: 'none' };
const NATIVE: NativeSpec = { kind: 'native' };

export const MOTION_CONCEPTS: Record<MotionConcept, MotionConceptSpec> = {
  press: {
    ios: { spatial: SPRINGS.ios.smooth300, effects: NONE },
    android: { spatial: NONE, effects: SPRINGS.m3.effectsFast },
    reduced: NONE,
    pressScale: { default: 0.97, large: 0.985 },
  },
  toggle: {
    ios: { spatial: SPRINGS.ios.snappy350, effects: T(120) },
    android: { spatial: SPRINGS.m3.spatialFast, effects: SPRINGS.m3.effectsFast },
    reduced: T(0),
  },
  panel: {
    ios: { spatial: SPRINGS.ios.smooth500, effects: T(180) },
    android: { spatial: SPRINGS.m3.spatialDefault, effects: SPRINGS.m3.effectsDefault },
    reduced: { kind: 'fade', duration: 180 },
  },
  sheet: {
    ios: { spatial: NATIVE, effects: NATIVE },
    android: { spatial: NATIVE, effects: NATIVE },
    reduced: NATIVE,
  },
  reveal: {
    ios: { spatial: SPRINGS.ios.smooth350, effects: T(180) },
    android: { spatial: SPRINGS.m3.spatialDefault, effects: SPRINGS.m3.effectsDefault },
    reduced: { kind: 'fade', duration: 120 },
  },
  listInsert: {
    ios: { spatial: SPRINGS.ios.smooth350, effects: T(180) },
    android: { spatial: SPRINGS.m3.spatialDefault, effects: SPRINGS.m3.effectsDefault },
    reduced: NONE,
  },
  swipe: {
    ios: { spatial: SPRINGS.ios.smooth300, effects: NONE },
    android: { spatial: SPRINGS.m3.spatialFast, effects: NONE },
    reduced: T(0),
  },
  spinner: {
    ios: { spatial: T(1000, 'linear'), effects: NONE },
    android: { spatial: T(1000, 'linear'), effects: NONE },
    reduced: NONE,
  },
};
