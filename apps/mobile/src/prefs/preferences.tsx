// ────────────────────────────────────────────────────────────────
// Interaction preferences — motion and haptics.
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
// ────────────────────────────────────────────────────────────────

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

import { prefs, PREF_KEYS } from '../storage/prefs';
import { setHapticsEnabled } from '../components/ui/haptics';

/** `system` follows Reduce Motion; the other two override it either way. */
export type MotionPreference = 'system' | 'reduced' | 'full';

const MOTION_VALUES: readonly MotionPreference[] = ['system', 'reduced', 'full'];

interface PreferencesValue {
  motion: MotionPreference;
  setMotion(next: MotionPreference): void;
  haptics: boolean;
  setHaptics(next: boolean): void;
}

const PreferencesContext = createContext<PreferencesValue | null>(null);

function readMotion(): MotionPreference {
  const stored = prefs.getString(PREF_KEYS.motion);
  return MOTION_VALUES.includes(stored as MotionPreference)
    ? (stored as MotionPreference)
    : 'system';
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

  const setMotion = useCallback((next: MotionPreference) => {
    setMotionState(next);
    prefs.setString(PREF_KEYS.motion, next);
  }, []);

  const setHaptics = useCallback((next: boolean) => {
    setHapticsState(next);
    setHapticsEnabled(next);
    prefs.setBoolean(PREF_KEYS.haptics, next);
  }, []);

  const value = useMemo<PreferencesValue>(
    () => ({ motion, setMotion, haptics, setHaptics }),
    [motion, setMotion, haptics, setHaptics],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

/**
 * Safe outside the provider.
 *
 * Sheets render in a separate `Modal` host and a few components are exercised
 * in isolation; throwing there would turn a preference lookup into a crash.
 */
export function usePreferences(): PreferencesValue {
  return (
    useContext(PreferencesContext) ?? {
      motion: 'system',
      setMotion: () => {},
      haptics: true,
      setHaptics: () => {},
    }
  );
}
