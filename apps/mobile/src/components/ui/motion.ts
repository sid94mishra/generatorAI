// ────────────────────────────────────────────────────────────────
// Motion tokens.
//
// One source for every animation in the app. Durations come from the shared
// design tokens so mobile and web agree on "fast"; the spring configs are
// mobile-only because the web has no equivalent of a sheet being flung.
//
// Everything here is consumed by Reanimated worklets, which run on the UI
// thread. That matters more on this app than most: a chat turn pushes tokens
// into a zustand store dozens of times a second, so any animation driven from
// the JS thread visibly stutters exactly when the user is looking at it.
//
// Reduce Motion has TWO layers, and both are needed:
//
//   1. Every module-level preset carries `ReduceMotion.System`, so Reanimated
//      itself collapses the animation when the OS switch is on — even inside
//      a gesture worklet no React hook can reach.
//   2. `useReducedMotionPreset()` re-issues the same presets with the flag set
//      from the APP preference (`system | reduced | full`), which the OS-level
//      flag cannot know about. A component that wants the user's explicit
//      choice honoured uses the hook's presets instead of the constants.
// ────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { Easing, ReduceMotion, type WithSpringConfig, type WithTimingConfig } from 'react-native-reanimated';

import { motion } from '../../theme/tokens.generated';
import { usePreferences, type MotionPreference } from '../../prefs/preferences';
import { useReduceMotion } from './accessibility';

/** 0 / 120 / 180 / 220 ms — the four steps the plan specifies. */
export const DURATION = {
  instant: motion.instant,
  fast: motion.fast,
  normal: motion.normal,
  slow: motion.slow,
} as const;

/**
 * Every config below carries `reduceMotion: ReduceMotion.System`.
 *
 * Reanimated then collapses the animation to its final value when the OS
 * switch is on, at the worklet level — which covers the animations no
 * component-level `useReduceMotion()` branch can reach, such as the scrim
 * interpolation inside a gesture handler.
 */
const RM = ReduceMotion.System;

/** The standard curve shared with the web's transitions. */
const EASE_STANDARD = Easing.bezier(0.2, 0, 0, 1);
/** Material 3's emphasised-decelerate curve. */
const EASE_EMPHASIZED = Easing.bezier(0.05, 0.7, 0.1, 1);

/** Standard ease for entrances/exits. Matches the web's transition curve. */
export const TIMING: WithTimingConfig = {
  duration: DURATION.normal,
  easing: EASE_STANDARD,
  reduceMotion: RM,
};

export const TIMING_FAST: WithTimingConfig = {
  duration: DURATION.fast,
  easing: EASE_STANDARD,
  reduceMotion: RM,
};

/**
 * Material 3's emphasised-decelerate curve.
 *
 * Used for anything the user *threw* — sheets, swipe actions — where the
 * standard curve reads as sluggish because the finger has already stopped.
 */
export const TIMING_EMPHASIZED: WithTimingConfig = {
  duration: DURATION.slow,
  easing: EASE_EMPHASIZED,
  reduceMotion: RM,
};

/**
 * Press feedback.
 *
 * Critically damped and stiff: the finger is still on the glass, so any
 * overshoot reads as lag rather than as bounce.
 */
export const SPRING_PRESS: WithSpringConfig = {
  damping: 20,
  stiffness: 420,
  mass: 0.6,
  reduceMotion: RM,
};

/** Sheets, segmented indicators, pagers — anything the user "throws". */
export const SPRING_SHEET: WithSpringConfig = {
  damping: 50,
  stiffness: 320,
  mass: 1,
  overshootClamping: false,
  reduceMotion: RM,
};

/** Entering list rows and cards — a touch of overshoot reads as alive. */
export const SPRING_ENTER: WithSpringConfig = {
  damping: 18,
  stiffness: 220,
  mass: 0.9,
  reduceMotion: RM,
};

/** Swipe actions settling back or committing. */
export const SPRING_SWIPE: WithSpringConfig = {
  damping: 30,
  stiffness: 300,
  mass: 0.8,
  reduceMotion: RM,
};

/** How far a pressable scales down. Below 0.94 reads as a glitch. */
export const PRESS_SCALE = 0.97;
export const PRESS_SCALE_LARGE = 0.985;

/**
 * Stagger for a list of entering rows, capped.
 *
 * Past ~8 rows the delay stops reading as sequence and starts reading as the
 * list being slow to load.
 */
export function stagger(index: number, step = 25, cap = 8): number {
  return Math.min(index, cap) * step;
}

// ── Preference-aware presets ────────────────────────────────────

/** The full preset set, every entry carrying the same reduce-motion policy. */
export interface MotionPresets {
  /**
   * Whether motion is effectively reduced right now. Components that cannot
   * express their fallback as "jump to the end" (a shimmer, a typewriter)
   * branch on this; everything else just uses the configs below.
   */
  reduce: boolean;
  timing: WithTimingConfig;
  timingFast: WithTimingConfig;
  timingEmphasized: WithTimingConfig;
  springPress: WithSpringConfig;
  springSheet: WithSpringConfig;
  springEnter: WithSpringConfig;
  springSwipe: WithSpringConfig;
}

/** Map the app preference onto Reanimated's own policy enum. */
export function reduceMotionFor(preference: MotionPreference): ReduceMotion {
  if (preference === 'reduced') return ReduceMotion.Always;
  if (preference === 'full') return ReduceMotion.Never;
  return ReduceMotion.System;
}

/**
 * Presets for a given policy.
 *
 * Under `Always` every spring and timing jumps to its final value: the sheet
 * appears at its detent, the pager lands on its page, the indicator moves —
 * all without a tween. That is the correct reduce-motion behaviour for a
 * user-thrown surface; a crossfade would still be motion.
 */
export function presetsFor(policy: ReduceMotion, reduce: boolean): MotionPresets {
  return {
    reduce,
    timing: { ...TIMING, reduceMotion: policy },
    timingFast: { ...TIMING_FAST, reduceMotion: policy },
    timingEmphasized: { ...TIMING_EMPHASIZED, reduceMotion: policy },
    springPress: { ...SPRING_PRESS, reduceMotion: policy },
    springSheet: { ...SPRING_SHEET, reduceMotion: policy },
    springEnter: { ...SPRING_ENTER, reduceMotion: policy },
    springSwipe: { ...SPRING_SWIPE, reduceMotion: policy },
  };
}

/**
 * The motion presets that honour BOTH the OS switch and the app preference.
 *
 * Safe outside `PreferencesProvider` (a sheet renders in a separate `Modal`
 * host): the fallback preference is `system`, which is exactly what the
 * module-level constants already do.
 */
export function useReducedMotionPreset(): MotionPresets {
  const { motion: preference } = usePreferences();
  const policy = reduceMotionFor(preference);
  // ONE answer for "is motion reduced": the app preference when explicit,
  // otherwise the OS switch (`useReduceMotion`). `reduce` used to mirror only
  // the app preference, so a component branching on it in JS kept animating
  // under the OS switch while every spring beside it had stopped.
  const reduce = useReduceMotion();
  return useMemo(() => presetsFor(policy, reduce), [policy, reduce]);
}
