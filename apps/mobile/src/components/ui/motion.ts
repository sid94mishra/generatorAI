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
// ────────────────────────────────────────────────────────────────

import { Easing, type WithSpringConfig, type WithTimingConfig } from 'react-native-reanimated';

import { motion } from '../../theme/tokens.generated';

export const DURATION = {
  instant: motion.instant,
  fast: motion.fast,
  normal: motion.normal,
  slow: motion.slow,
} as const;

/** Standard ease for entrances/exits. Matches the web's transition curve. */
export const TIMING: WithTimingConfig = {
  duration: DURATION.normal,
  easing: Easing.bezier(0.2, 0, 0, 1),
};

export const TIMING_FAST: WithTimingConfig = {
  duration: DURATION.fast,
  easing: Easing.bezier(0.2, 0, 0, 1),
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
};

/** Sheets, segmented indicators, anything the user "throws". */
export const SPRING_SHEET: WithSpringConfig = {
  damping: 50,
  stiffness: 320,
  mass: 1,
  overshootClamping: false,
};

/** Entering list rows and cards — a touch of overshoot reads as alive. */
export const SPRING_ENTER: WithSpringConfig = {
  damping: 18,
  stiffness: 220,
  mass: 0.9,
};

/** How far a pressable scales down. Below 0.94 reads as a glitch. */
export const PRESS_SCALE = 0.97;
export const PRESS_SCALE_LARGE = 0.985;
