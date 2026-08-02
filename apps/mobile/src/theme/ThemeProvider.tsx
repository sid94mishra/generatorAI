// ────────────────────────────────────────────────────────────────
// ThemeProvider — the mobile counterpart of apps/web's provider.
//
// Both read their palette from `@generatorai/design-tokens`, so the two apps
// cannot drift. The mechanism differs only in delivery: web sets classes and
// data attributes on <html>; here we inject the same variables through
// NativeWind's `vars()`.
//
// Preference is read BEFORE the first paint (the splash screen is held until
// hydration finishes), which is the mobile equivalent of the web's
// pre-hydration script — otherwise a dark-mode user gets a white flash on
// every cold start.
// ────────────────────────────────────────────────────────────────

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance as RNAppearance, useColorScheme } from 'react-native';
import { vars } from 'nativewind';
import {
  ACCENTS,
  ACCENT_STORAGE_KEY,
  DEFAULT_ACCENT,
  DEFAULT_THEME,
  THEMES,
  THEME_STORAGE_KEY,
  getAccent,
  getTheme,
  type Appearance,
} from '@generatorai/design-tokens';

import { themeVars } from './tokens.generated';
import { prefs } from '../storage/prefs';

type ThemeId = 'system' | 'light' | 'dark';

interface ThemeContextValue {
  theme: ThemeId;
  /** Concrete appearance after resolving `system`. */
  appearance: Appearance;
  accent: string;
  setTheme(theme: ThemeId): void;
  setAccent(accent: string): void;
  /** NativeWind variable bag for the root view. */
  style: Record<string, string>;
  /** Literal colours for consumers that cannot read a CSS variable. */
  colors: Record<string, string>;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

function readStoredTheme(): ThemeId {
  const stored = prefs.getString(THEME_STORAGE_KEY);
  // An unknown id (a theme we removed) must not wedge the app on a palette
  // that no longer exists.
  return stored && getTheme(stored) ? (stored as ThemeId) : (DEFAULT_THEME as ThemeId);
}

function readStoredAccent(): string {
  const stored = prefs.getString(ACCENT_STORAGE_KEY);
  return stored && getAccent(stored) ? stored : DEFAULT_ACCENT;
}

export function ThemeProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const systemScheme = useColorScheme();
  const [theme, setThemeState] = useState<ThemeId>(readStoredTheme);
  const [accent, setAccentState] = useState<string>(readStoredAccent);

  const appearance: Appearance = useMemo(() => {
    if (theme === 'system') return systemScheme === 'light' ? 'light' : 'dark';
    return theme;
  }, [theme, systemScheme]);

  const setTheme = useCallback((next: ThemeId) => {
    setThemeState(next);
    prefs.setString(THEME_STORAGE_KEY, next);
  }, []);

  const setAccent = useCallback((next: string) => {
    if (!getAccent(next)) return;
    setAccentState(next);
    prefs.setString(ACCENT_STORAGE_KEY, next);
  }, []);

  // Keep the native chrome in step with the JS palette. Without this the
  // status-bar text and the Android nav bar stay on the OS default and are
  // unreadable against our background half the time.
  //
  // `null` restores "follow the OS", which is exactly what theme='system'
  // means. The RN types omit it, so the cast is narrowing reality back to
  // what the platform actually accepts.
  //
  // Feature-detected because `setColorScheme` is iOS/Android-only: there is no
  // native chrome to tint under react-native-web, and calling it there throws
  // "RNAppearance.default.setColorScheme is not a function". The palette
  // itself is applied through `vars()` below, so skipping this loses nothing
  // on web.
  useEffect(() => {
    if (typeof RNAppearance.setColorScheme !== 'function') return;
    RNAppearance.setColorScheme(
      (theme === 'system' ? null : theme) as Parameters<typeof RNAppearance.setColorScheme>[0],
    );
  }, [theme]);

  const colors = useMemo(() => {
    const bag = themeVars[appearance][accent as keyof (typeof themeVars)['dark']];
    // Strip the `--` prefix so consumers read `colors.background`.
    return Object.fromEntries(Object.entries(bag).map(([k, v]) => [k.slice(2), v as string]));
  }, [appearance, accent]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      appearance,
      accent,
      setTheme,
      setAccent,
      style: vars(themeVars[appearance][accent as keyof (typeof themeVars)['dark']]),
      colors,
    }),
    [theme, appearance, accent, setTheme, setAccent, colors],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export { ACCENTS, THEMES };
