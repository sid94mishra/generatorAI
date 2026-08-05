// ────────────────────────────────────────────────────────────────
// Accessibility utilities.
//
// Three platform facts the app previously ignored entirely:
//
//   1. Reduce Motion is a top-level setting on both iOS and Android, and a
//      spring on every tap is exactly what it exists to suppress.
//   2. The reading size is a system setting, so a 44pt row with `h-14` clips
//      its own text at AX3. Layout has to be told the scale, not just the
//      text.
//   3. A screen reader hears nothing about a streaming transcript, an
//      arriving approval gate, or a failed send unless it is announced.
//
// Everything here is a hook rather than a constant because all three values
// change at runtime while the app is open.
// ────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform, useWindowDimensions } from 'react-native';

import { usePreferences } from '../../prefs/preferences';

/**
 * Caps for text that shares a row with other text.
 *
 * Uncapped scaling is right for body copy and wrong for a tab label or a
 * badge, where the container is bounded by the screen rather than by the
 * content. These are the two values used across the system so the cap is a
 * decision, not a per-component guess.
 */
export const MAX_SCALE = {
  /** Dense chrome: badges, chips, counts, tab labels. */
  chrome: 1.4,
  /** Titles and controls that own their row but must not push it off-screen. */
  control: 1.8,
} as const;

/** Whether the OS Reduce Motion switch is on. Updates live. */
export function useSystemReduceMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (alive) setReduced(value);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  return reduced;
}

/**
 * The effective answer: the app preference wins over the system one, because
 * a user who explicitly asked for full motion here has already made the
 * decision this hook exists to respect.
 */
export function useReduceMotion(): boolean {
  const { motion } = usePreferences();
  const system = useSystemReduceMotion();
  if (motion === 'reduced') return true;
  if (motion === 'full') return false;
  return system;
}

/** Whether VoiceOver / TalkBack is running. */
export function useScreenReader(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isScreenReaderEnabled()
      .then((value) => {
        if (alive) setEnabled(value);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', setEnabled);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  return enabled;
}

/**
 * The user's reading size as a multiplier.
 *
 * Read from `useWindowDimensions` rather than `PixelRatio.getFontScale()`
 * because only the former re-renders when the setting changes while the app
 * is open — which it does, since iOS exposes it in Control Centre.
 */
export function useFontScale(): number {
  const { fontScale } = useWindowDimensions();
  return Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1;
}

/**
 * Grow a fixed dimension with the reading size.
 *
 * Only applied to *heights* — widths stay put, because a wider control on a
 * 393pt screen just gets clipped by the screen instead of by its container.
 */
export function scaled(base: number, fontScale: number, max = 2): number {
  return Math.round(base * Math.min(Math.max(fontScale, 1), max));
}

/** Speak a message. No-op when nothing is listening, so it is free to call. */
export function announce(message: string): void {
  if (!message) return;
  if (Platform.OS === 'web') return;
  AccessibilityInfo.announceForAccessibility(message);
}

/**
 * The platform's minimum touch target.
 *
 * They genuinely differ — 44pt on iOS, 48dp on Material — and rounding both
 * to 44 leaves Android a point short of its own guideline.
 */
export const MIN_TARGET = Platform.OS === 'android' ? 48 : 44;
