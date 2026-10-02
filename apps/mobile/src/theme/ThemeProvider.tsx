// ────────────────────────────────────────────────────────────────
// ThemeProvider — the mobile counterpart of apps/web's provider.
//
// Both read their palette from `@generatorai/design-tokens`, so the two apps
// cannot drift. The mechanism differs only in delivery: web sets classes and
// data attributes on <html>; here the generated Uniwind themes
// (uniwind-themes.css) are switched with `Uniwind.setTheme` and the accent is
// written with `Uniwind.updateCSSVariables` (applyTheme.ts, MD-10). Views read
// CSS variables, so a theme change re-renders only `useTheme()` consumers.
//
// Three axes, same as web:
//   mode    'system' | 'light' | 'dark'
//   theme   palette id  (github, graphite, catppuccin, …)
//   accent  accent id
//
// Preference is applied BEFORE the first paint by prepaint.ts (module
// evaluation, synchronous MMKV), the mobile equivalent of the web's
// pre-hydration script — otherwise a dark-mode user gets a white flash on
// every cold start. A provider with `persist={false}` is a preview (Storybook,
// tests): it never touches the app theme and scopes its subtree instead
// (ScopedTheme + ScopedVariables).
// ────────────────────────────────────────────────────────────────

import React, { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { ScopedTheme, ScopedVariables, type ThemeName } from 'uniwind';
import {
  ACCENT_STORAGE_KEY,
  DEFAULT_MODE,
  DEFAULT_THEME,
  MODES,
  MODE_STORAGE_KEY,
  THEMES,
  THEME_STORAGE_KEY,
  accentVars,
  getThemeDef,
  isKnownMode,
  isKnownTheme,
  resolveAccentId,
  resolveTerminalPalette,
  themeAccents,
  uniwindThemeName,
  type AccentDef,
  type AccentId,
  type Appearance,
  type ThemeDef,
  type ThemeMode,
} from '@generatorai/design-tokens';

import { prefs } from '../services/storage/prefs';
import { applyTheme } from './applyTheme';
import { legacyColors } from './legacyColors';

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
  /** Legacy literal colours for consumers that cannot read a CSS variable (useThemeColors() replaces it in M3-08). */
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

export function ThemeProvider({ children, initialTheme, initialMode, initialAccent, persist = true }: {
  children: React.ReactNode;
  initialTheme?: string;
  initialMode?: ThemeMode;
  initialAccent?: string;
  /** Development previews can change appearance without overwriting app preferences. */
  persist?: boolean;
}): React.ReactElement {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>(() => initialMode ?? readStoredMode());
  const [themeId, setThemeIdState] = useState<string>(() => initialTheme && isKnownTheme(initialTheme) ? initialTheme : readStoredThemeId());

  const theme = useMemo(() => getThemeDef(themeId), [themeId]);
  const [accent, setAccentState] = useState<AccentId>(() =>
    resolveAccentId(getThemeDef(themeId), initialAccent ?? prefs.getString(ACCENT_STORAGE_KEY)),
  );

  const appearance: Appearance = useMemo(() => {
    if (mode === 'system') return systemScheme === 'light' ? 'light' : 'dark';
    return mode;
  }, [mode, systemScheme]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    if (persist) prefs.setString(MODE_STORAGE_KEY, next);
  }, [persist]);

  const setThemeId = useCallback((next: string) => {
    const valid = isKnownTheme(next) ? next : DEFAULT_THEME;
    setThemeIdState(valid);
    if (persist) prefs.setString(THEME_STORAGE_KEY, valid);
  }, [persist]);

  const setAccent = useCallback(
    (next: string) => {
      const valid = resolveAccentId(theme, next);
      setAccentState(valid);
      if (persist) prefs.setString(ACCENT_STORAGE_KEY, valid);
    },
    [theme, persist],
  );

  // The app provider owns the global Uniwind theme and the native colour
  // scheme (applyTheme.ts); a layout effect so the switch lands before paint.
  useLayoutEffect(() => {
    if (persist) applyTheme({ themeId, mode, appearance, accent });
  }, [persist, themeId, mode, appearance, accent]);

  const colors = useMemo(() => legacyColors(themeId, appearance, accent), [themeId, appearance, accent]);
  const terminal = useMemo(
    () => resolveTerminalPalette(theme, appearance) as unknown as Record<string, string>,
    [theme, appearance],
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
      colors,
      terminal,
    }),
    [mode, appearance, themeId, theme, accent, setMode, setThemeId, setAccent, colors, terminal],
  );

  const scopedAccent = useMemo(() => ({ ...accentVars(theme, appearance, accent) }), [theme, appearance, accent]);

  if (persist) return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
  return (
    <ThemeContext.Provider value={value}>
      <ScopedTheme theme={uniwindThemeName(themeId, appearance) as ThemeName}>
        <ScopedVariables variables={scopedAccent}>{children}</ScopedVariables>
      </ScopedTheme>
    </ThemeContext.Provider>
  );
}

export { MODES, THEMES };
