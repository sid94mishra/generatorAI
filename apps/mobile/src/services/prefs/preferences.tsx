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
//   motion, transparency, haptics   pushed into the kit's platform layer by app/_layout.tsx `KitPreferencesBridge`
//   biometricLock, lockGraceSeconds blocks/shell/AppLockGate.tsx
//   largeTitleCollapse              the kit Header (see the note on `largeTitleCollapse` below)
// ────────────────────────────────────────────────────────────────

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

import { prefs, PREF_KEYS } from '../storage/prefs';

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
  /** iOS glass: 'system' follows Reduce Transparency; the other two override it. */
  transparency: MotionPreference;
  setTransparency(next: MotionPreference): void;
  haptics: boolean;
  setHaptics(next: boolean): void;
  /** Require biometrics / device passcode on cold start and after the grace. */
  biometricLock: boolean;
  setBiometricLock(next: boolean): void;
  lockGraceSeconds: LockGraceSeconds;
  setLockGraceSeconds(next: LockGraceSeconds): void;
  /** Cover content in the app switcher even with the lock off (with the lock on it always is). */
  hideInSwitcher: boolean;
  setHideInSwitcher(next: boolean): void;
  /** iOS: notification titles and bodies become the lock-screen-safe copy (MD-33; with the lock on they always are). */
  hideNotificationPreviews: boolean;
  setHideNotificationPreviews(next: boolean): void;
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

function readTransparency(): MotionPreference {
  const stored = prefs.getString(PREF_KEYS.transparency);
  return MOTION_VALUES.includes(stored as MotionPreference) ? (stored as MotionPreference) : 'system';
}

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
  const [transparency, setTransparencyState] = useState<MotionPreference>(readTransparency);
  const [haptics, setHapticsState] = useState<boolean>(() => prefs.getBoolean(PREF_KEYS.haptics, true));
  const [biometricLock, setBiometricLockState] = useState<boolean>(
    () => readLockPreferences().biometricLock,
  );
  const [lockGraceSeconds, setLockGraceState] = useState<LockGraceSeconds>(
    () => readLockPreferences().lockGraceSeconds,
  );
  const [hideInSwitcher, setHideInSwitcherState] = useState<boolean>(() => prefs.getBoolean(PREF_KEYS.hideInSwitcher, false));
  const [hideNotificationPreviews, setHideNotificationPreviewsState] = useState<boolean>(() =>
    prefs.getBoolean(PREF_KEYS.hideNotificationPreviews, false),
  );
  const [largeTitleCollapse, setLargeTitleCollapseState] = useState<boolean>(() =>
    prefs.getBoolean(PREF_KEYS.largeTitleCollapse, true),
  );

  const setMotion = useCallback((next: MotionPreference) => {
    setMotionState(next);
    prefs.setString(PREF_KEYS.motion, next);
  }, []);

  const setTransparency = useCallback((next: MotionPreference) => {
    setTransparencyState(next);
    prefs.setString(PREF_KEYS.transparency, next);
  }, []);

  const setHaptics = useCallback((next: boolean) => {
    setHapticsState(next);
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

  const setHideInSwitcher = useCallback((next: boolean) => {
    setHideInSwitcherState(next);
    prefs.setBoolean(PREF_KEYS.hideInSwitcher, next);
  }, []);

  const setHideNotificationPreviews = useCallback((next: boolean) => {
    setHideNotificationPreviewsState(next);
    prefs.setBoolean(PREF_KEYS.hideNotificationPreviews, next);
  }, []);

  const setLargeTitleCollapse = useCallback((next: boolean) => {
    setLargeTitleCollapseState(next);
    prefs.setBoolean(PREF_KEYS.largeTitleCollapse, next);
  }, []);

  const value = useMemo<PreferencesValue>(
    () => ({
      motion,
      setMotion,
      transparency,
      setTransparency,
      haptics,
      setHaptics,
      biometricLock,
      setBiometricLock,
      lockGraceSeconds,
      setLockGraceSeconds,
      hideInSwitcher,
      setHideInSwitcher,
      hideNotificationPreviews,
      setHideNotificationPreviews,
      largeTitleCollapse,
      setLargeTitleCollapse,
    }),
    [
      motion,
      setMotion,
      transparency,
      setTransparency,
      haptics,
      setHaptics,
      biometricLock,
      setBiometricLock,
      lockGraceSeconds,
      setLockGraceSeconds,
      hideInSwitcher,
      setHideInSwitcher,
      hideNotificationPreviews,
      setHideNotificationPreviews,
      largeTitleCollapse,
      setLargeTitleCollapse,
    ],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

const OUTSIDE_PROVIDER: PreferencesValue = {
  motion: 'system',
  setMotion: () => {},
  transparency: 'system',
  setTransparency: () => {},
  haptics: true,
  setHaptics: () => {},
  biometricLock: false,
  setBiometricLock: () => {},
  lockGraceSeconds: DEFAULT_LOCK_GRACE_SECONDS,
  setLockGraceSeconds: () => {},
  hideInSwitcher: false,
  setHideInSwitcher: () => {},
  hideNotificationPreviews: false,
  setHideNotificationPreviews: () => {},
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
