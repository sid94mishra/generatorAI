// ────────────────────────────────────────────────────────────────
// Interaction preferences — motion, haptics, app lock, large titles.
//
// Separate from ThemeProvider on purpose: the theme decides what the app
// looks like, this decides how it *behaves*. Both read MMKV synchronously so
// the first frame is already correct.
//
// Text size is deliberately NOT here. On both platforms the reading size is
// an OS-level setting, and an app that adds a second, competing multiplier
// ends up disagreeing with every other app on the device. What we owe the
// user instead is a layout that survives their existing choice — see
// `useFontScale` and the min-height sizing across the design system — plus a
// direct route into the system setting from Appearance.
//
// Every value here has a UI (Settings → Accessibility) and a consumer:
//
//   motion              ui/motion.ts `useReducedMotionPreset`, ui/accessibility.ts `useReduceMotion`
//   haptics             ui/haptics.ts `setHapticsEnabled` (pushed from here)
//   biometricLock       src/auth/AppLock.tsx `AppLockGate`
//   lockGraceSeconds    src/auth/AppLock.tsx `AppLockGate`
//   largeTitleCollapse  ui/Screen.tsx (see the note on `largeTitleCollapse` below)
// ────────────────────────────────────────────────────────────────

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

import { prefs, PREF_KEYS } from '../storage/prefs';
import { setHapticsEnabled } from '../components/ui/haptics';

/** `system` follows Reduce Motion; the other two override it either way. */
export type MotionPreference = 'system' | 'reduced' | 'full';

const MOTION_VALUES: readonly MotionPreference[] = ['system', 'reduced', 'full'];

/**
 * How long the app may sit in the background before the lock re-arms.
 *
 * `0` is "immediately": the lock arms the moment the app leaves the
 * foreground. The other steps match the OS's own auto-lock options so the
 * picker reads as familiar rather than invented.
 */
export const LOCK_GRACE_OPTIONS = [
  { seconds: 0, label: 'Immediately' },
  { seconds: 60, label: '1 minute' },
  { seconds: 300, label: '5 minutes' },
  { seconds: 900, label: '15 minutes' },
] as const;

export type LockGraceSeconds = (typeof LOCK_GRACE_OPTIONS)[number]['seconds'];

export const DEFAULT_LOCK_GRACE_SECONDS: LockGraceSeconds = 60;

export interface PreferencesValue {
  motion: MotionPreference;
  setMotion(next: MotionPreference): void;
  haptics: boolean;
  setHaptics(next: boolean): void;
  /** Require biometrics / device passcode on cold start and after the grace. */
  biometricLock: boolean;
  setBiometricLock(next: boolean): void;
  lockGraceSeconds: LockGraceSeconds;
  setLockGraceSeconds(next: LockGraceSeconds): void;
  /**
   * Whether `<Screen>`'s large title collapses into the compact bar on scroll.
   *
   * Persisted and exposed here; the design-system `ScreenHeader` is the
   * consumer and is expected to read this and skip the collapse interpolation
   * when it is false.
   */
  largeTitleCollapse: boolean;
  setLargeTitleCollapse(next: boolean): void;
}

const PreferencesContext = createContext<PreferencesValue | null>(null);

function readMotion(): MotionPreference {
  const stored = prefs.getString(PREF_KEYS.motion);
  return MOTION_VALUES.includes(stored as MotionPreference)
    ? (stored as MotionPreference)
    : 'system';
}

/** Coerce whatever is stored onto one of the picker's steps. */
export function coerceLockGrace(value: number): LockGraceSeconds {
  const match = LOCK_GRACE_OPTIONS.find((option) => option.seconds === value);
  return match ? match.seconds : DEFAULT_LOCK_GRACE_SECONDS;
}

/**
 * Synchronous reads for code that runs before or outside React.
 *
 * `AppLockGate` decides whether to show the lock on the very first frame,
 * before the provider has rendered anything the user could see — so it
 * cannot wait for context.
 */
export function readLockPreferences(): {
  biometricLock: boolean;
  lockGraceSeconds: LockGraceSeconds;
} {
  return {
    biometricLock: prefs.getBoolean(PREF_KEYS.biometricLock, false),
    lockGraceSeconds: coerceLockGrace(
      prefs.getNumber(PREF_KEYS.lockGraceSeconds, DEFAULT_LOCK_GRACE_SECONDS),
    ),
  };
}

export function PreferencesProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [motion, setMotionState] = useState<MotionPreference>(readMotion);
  const [haptics, setHapticsState] = useState<boolean>(() => {
    const enabled = prefs.getBoolean(PREF_KEYS.haptics, true);
    // The haptics module is a plain singleton so call sites stay a one-liner;
    // it therefore has to be told the stored value before the first tap.
    setHapticsEnabled(enabled);
    return enabled;
  });
  const [biometricLock, setBiometricLockState] = useState<boolean>(
    () => readLockPreferences().biometricLock,
  );
  const [lockGraceSeconds, setLockGraceState] = useState<LockGraceSeconds>(
    () => readLockPreferences().lockGraceSeconds,
  );
  const [largeTitleCollapse, setLargeTitleCollapseState] = useState<boolean>(() =>
    prefs.getBoolean(PREF_KEYS.largeTitleCollapse, true),
  );

  const setMotion = useCallback((next: MotionPreference) => {
    setMotionState(next);
    prefs.setString(PREF_KEYS.motion, next);
  }, []);

  const setHaptics = useCallback((next: boolean) => {
    setHapticsState(next);
    setHapticsEnabled(next);
    prefs.setBoolean(PREF_KEYS.haptics, next);
  }, []);

  const setBiometricLock = useCallback((next: boolean) => {
    setBiometricLockState(next);
    prefs.setBoolean(PREF_KEYS.biometricLock, next);
  }, []);

  const setLockGraceSeconds = useCallback((next: LockGraceSeconds) => {
    const coerced = coerceLockGrace(next);
    setLockGraceState(coerced);
    prefs.setNumber(PREF_KEYS.lockGraceSeconds, coerced);
  }, []);

  const setLargeTitleCollapse = useCallback((next: boolean) => {
    setLargeTitleCollapseState(next);
    prefs.setBoolean(PREF_KEYS.largeTitleCollapse, next);
  }, []);

  const value = useMemo<PreferencesValue>(
    () => ({
      motion,
      setMotion,
      haptics,
      setHaptics,
      biometricLock,
      setBiometricLock,
      lockGraceSeconds,
      setLockGraceSeconds,
      largeTitleCollapse,
      setLargeTitleCollapse,
    }),
    [
      motion,
      setMotion,
      haptics,
      setHaptics,
      biometricLock,
      setBiometricLock,
      lockGraceSeconds,
      setLockGraceSeconds,
      largeTitleCollapse,
      setLargeTitleCollapse,
    ],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

const OUTSIDE_PROVIDER: PreferencesValue = {
  motion: 'system',
  setMotion: () => {},
  haptics: true,
  setHaptics: () => {},
  biometricLock: false,
  setBiometricLock: () => {},
  lockGraceSeconds: DEFAULT_LOCK_GRACE_SECONDS,
  setLockGraceSeconds: () => {},
  largeTitleCollapse: true,
  setLargeTitleCollapse: () => {},
};

/**
 * Safe outside the provider.
 *
 * Sheets render in a separate `Modal` host and a few components are exercised
 * in isolation; throwing there would turn a preference lookup into a crash.
 */
export function usePreferences(): PreferencesValue {
  return useContext(PreferencesContext) ?? OUTSIDE_PROVIDER;
}
