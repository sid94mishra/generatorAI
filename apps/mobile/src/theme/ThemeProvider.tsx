// ────────────────────────────────────────────────────────────────
// ThemeProvider — the mobile counterpart of apps/web's provider.
//
// Both read their palette from `@generatorai/design-tokens`, so the two apps
// cannot drift. The mechanism differs only in delivery: web sets classes and
// data attributes on <html>; here the generated Uniwind themes
// (uniwind-themes.css) are switched with `Uniwind.setTheme` and the accent is
// written with `Uniwind.updateCSSVariables` (applyTheme.ts, MD-10). Views read
// CSS variables, so a theme change re-renders only `useTheme()` /
// `useThemeColors()` consumers.
//
// Three axes, same as web:
//   mode    'system' | 'light' | 'dark'
//   theme   palette id  (github, graphite, catppuccin, …)
//   accent  accent id, or 'system' — the Android Material You accent (MD-08)
//
// Preference is applied BEFORE the first paint by prepaint.ts (module
// evaluation, synchronous MMKV), the mobile equivalent of the web's
// pre-hydration script. A provider with `persist={false}` is a preview
// (Storybook, tests): it never touches the app theme and scopes its subtree
// instead (ScopedTheme + ScopedVariables + its own ThemeColors).
// ────────────────────────────────────────────────────────────────

import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { AppState, useColorScheme } from 'react-native';
import { ScopedTheme, ScopedVariables, type ThemeName } from 'uniwind';
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
  themeAccents,
  toAccentVars,
  uniwindThemeName,
  type AccentDef,
  type Appearance,
  type ThemeDef,
  type ThemeMode,
} from '@generatorai/design-tokens';

import { prefs } from '../services/storage/prefs';
import { ThemeColorsContext, type ThemeColors } from '../ui/lib/themeColors';
import { readSystemAccentSeeds, systemAccentAvailable, type SystemAccentSeeds } from '../ui/platform/accent';
import { applyTheme } from './applyTheme';
import {
  readCachedSeeds,
  readStoredAccentChoice,
  resolveAccentChoice,
  resolveTheme,
  writeCachedSeeds,
  type AccentChoice,
} from './themeState';

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
  accent: AccentChoice;
  /** Whether the Android System (Material You) accent can be offered (02 §2.5). */
  systemAccentAvailable: boolean;
  /** The System accent as it would paint now (for its swatch); null when unavailable. */
  systemAccentSwatch: string | null;
  setMode(mode: ThemeMode): void;
  setThemeId(id: string): void;
  setAccent(accent: string): void;
  /** Literal colours for native hosts (§2.6); useThemeColors() reads the same object. */
  colors: ThemeColors;
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

const sameSeeds = (a: SystemAccentSeeds | null, b: SystemAccentSeeds | null): boolean =>
  a?.dark === b?.dark && a?.light === b?.light;

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
  const [accent, setAccentState] = useState<AccentChoice>(() =>
    initialAccent !== undefined ? resolveAccentChoice(themeId, initialAccent) : readStoredAccentChoice(themeId),
  );
  // Material You seeds: the MMKV cache paints the first frame; a fresh read follows (02 §2.5).
  const [seeds, setSeeds] = useState<SystemAccentSeeds | null>(() => readCachedSeeds());

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
      const valid = resolveAccentChoice(theme.id, next);
      setAccentState(valid);
      if (persist) prefs.setString(ACCENT_STORAGE_KEY, valid);
    },
    [theme, persist],
  );

  // Refresh the System accent seeds on mount, on return to the foreground and on an
  // appearance change (wallpaper / configuration changes land there); cache when they differ.
  useEffect(() => {
    if (!persist || accent !== 'system') return undefined;
    const refresh = (): void => {
      const fresh = readSystemAccentSeeds();
      if (!fresh) return;
      setSeeds((prev) => {
        if (sameSeeds(prev, fresh)) return prev;
        writeCachedSeeds(fresh);
        return fresh;
      });
    };
    refresh();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, [persist, accent, appearance]);

  const resolved = useMemo(() => resolveTheme(themeId, appearance, accent, seeds), [themeId, appearance, accent, seeds]);

  // The app provider owns the global Uniwind theme, the native colour scheme and the
  // published colours (applyTheme.ts); a layout effect so the switch lands before paint.
  useLayoutEffect(() => {
    if (persist) applyTheme({ themeId, mode, appearance, resolved });
  }, [persist, themeId, mode, appearance, resolved]);

  const systemAccentSwatch = useMemo(() => {
    if (!systemAccentAvailable) return null;
    const source = seeds ?? readSystemAccentSeeds();
    return source ? resolveTheme(themeId, appearance, 'system', source).triple.accent : null;
  }, [themeId, appearance, seeds]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      appearance,
      themeId,
      theme,
      accents: themeAccents(theme),
      accent,
      systemAccentAvailable,
      systemAccentSwatch,
      setMode,
      setThemeId,
      setAccent,
      colors: resolved.colors,
    }),
    [mode, appearance, themeId, theme, accent, systemAccentSwatch, setMode, setThemeId, setAccent, resolved],
  );

  const scopedAccent = useMemo(() => ({ ...toAccentVars(resolved.triple) }), [resolved]);

  if (persist) return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
  return (
    <ThemeContext.Provider value={value}>
      <ThemeColorsContext.Provider value={resolved.colors}>
        <ScopedTheme theme={uniwindThemeName(themeId, appearance) as ThemeName}>
          <ScopedVariables variables={scopedAccent}>{children}</ScopedVariables>
        </ScopedTheme>
      </ThemeColorsContext.Provider>
    </ThemeContext.Provider>
  );
}

export { MODES, THEMES };
