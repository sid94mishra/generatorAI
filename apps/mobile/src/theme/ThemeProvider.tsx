// ────────────────────────────────────────────────────────────────
// ThemeProvider — the mobile counterpart of apps/web's provider.
//
// Both read their palette from `@generatorai/design-tokens`, so the two apps
// cannot drift. The mechanism differs only in delivery: web sets classes and
// data attributes on <html>; here we inject the same variables through
// NativeWind's `vars()`.
//
// Three axes, same as web:
//   mode    'system' | 'light' | 'dark'
//   theme   palette id  (github, graphite, catppuccin, …)
//   accent  accent id
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
  ACCENT_STORAGE_KEY,
  DEFAULT_MODE,
  DEFAULT_THEME,
  MODES,
  MODE_STORAGE_KEY,
  THEMES,
  THEME_STORAGE_KEY,
  getThemeDef,
  isKnownMode,
  isKnownTheme,
  resolveAccentId,
  themeAccents,
  type AccentDef,
  type AccentId,
  type Appearance,
  type ThemeDef,
  type ThemeMode,
} from '@generatorai/design-tokens';

import { themeVars, terminalThemes } from './tokens.generated';
import { prefs } from '../storage/prefs';

interface ThemeContextValue {
  mode: ThemeMode;
  /** Concrete appearance after resolving `system`. */
  appearance: Appearance;
  /** Active palette id. */
  themeId: string;
  /** Full definition of the active palette. */
  theme: ThemeDef;
  /** Accents this theme exposes, already resolved to its own hues. */
  accents: AccentDef[];
  accent: AccentId;
  setMode(mode: ThemeMode): void;
  setThemeId(id: string): void;
  setAccent(accent: string): void;
  /** NativeWind variable bag for the root view. */
  style: Record<string, string>;
  /** Literal colours for consumers that cannot read a CSS variable. */
  colors: Record<string, string>;
  /** xterm ITheme for the terminal WebView. */
  terminal: Record<string, string>;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

function readStoredMode(): ThemeMode {
  const stored = prefs.getString(MODE_STORAGE_KEY);
  return isKnownMode(stored) ? stored : DEFAULT_MODE;
}

function readStoredThemeId(): string {
  // An unknown id (a theme we removed) must not wedge the app on a palette
  // that no longer exists.
  const stored = prefs.getString(THEME_STORAGE_KEY);
  return isKnownTheme(stored) ? (stored as string) : DEFAULT_THEME;
}

export function ThemeProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode);
  const [themeId, setThemeIdState] = useState<string>(readStoredThemeId);

  const theme = useMemo(() => getThemeDef(themeId), [themeId]);
  const [accent, setAccentState] = useState<AccentId>(() =>
    resolveAccentId(getThemeDef(readStoredThemeId()), prefs.getString(ACCENT_STORAGE_KEY)),
  );

  const appearance: Appearance = useMemo(() => {
    if (mode === 'system') return systemScheme === 'light' ? 'light' : 'dark';
    return mode;
  }, [mode, systemScheme]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    prefs.setString(MODE_STORAGE_KEY, next);
  }, []);

  const setThemeId = useCallback((next: string) => {
    const valid = isKnownTheme(next) ? next : DEFAULT_THEME;
    setThemeIdState(valid);
    prefs.setString(THEME_STORAGE_KEY, valid);
  }, []);

  const setAccent = useCallback(
    (next: string) => {
      const valid = resolveAccentId(theme, next);
      setAccentState(valid);
      prefs.setString(ACCENT_STORAGE_KEY, valid);
    },
    [theme],
  );

  // Keep the native chrome in step with the JS palette. Without this the
  // status-bar text and the Android nav bar stay on the OS default and are
  // unreadable against our background half the time.
  //
  // `null` restores "follow the OS", which is exactly what mode='system'
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
      (mode === 'system' ? null : mode) as Parameters<typeof RNAppearance.setColorScheme>[0],
    );
  }, [mode]);

  // The generated module is `as const`, so indexing it with a runtime string
  // widens to `| undefined`. Both lookups are already guarded — `themeId` came
  // from `isKnownTheme` and `accent` from `resolveAccentId` — so the cast
  // narrows back to what the registry guarantees rather than hiding a hole.
  const varsByTheme = themeVars as unknown as Record<
    string,
    Record<Appearance, Record<string, Record<string, string>>>
  >;
  const terminalByTheme = terminalThemes as unknown as Record<
    string,
    Record<Appearance, Record<string, string>>
  >;

  const bag = useMemo(() => {
    const themeBag = varsByTheme[themeId] ?? varsByTheme[DEFAULT_THEME]!;
    return themeBag[appearance][accent] ?? themeBag[appearance][theme.defaultAccent]!;
  }, [themeId, appearance, accent, theme.defaultAccent]);

  // Strip the `--` prefix so consumers read `colors.background`.
  const colors = useMemo(
    () => Object.fromEntries(Object.entries(bag).map(([k, v]) => [k.slice(2), v])),
    [bag],
  );

  const terminal = useMemo(
    () => (terminalByTheme[themeId] ?? terminalByTheme[DEFAULT_THEME]!)[appearance],
    [themeId, appearance],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      appearance,
      themeId,
      theme,
      accents: themeAccents(theme),
      accent,
      setMode,
      setThemeId,
      setAccent,
      style: vars(bag),
      colors,
      terminal,
    }),
    [mode, appearance, themeId, theme, accent, setMode, setThemeId, setAccent, bag, colors, terminal],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export { MODES, THEMES };
