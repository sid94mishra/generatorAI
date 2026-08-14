// ────────────────────────────────────────────────────────────────
// ThemeProvider — the single writer of the three appearance axes.
//
//   mode    'light' | 'dark' | 'system'   →  .light / .dark class + data-mode
//   theme   palette id                    →  data-theme
//   accent  accent id                     →  data-accent
//
// All three land on <html>, and CSS does the rest: the generated token layers
// in globals.css key off exactly those selectors, so switching a theme is one
// attribute write and zero re-renders of the tree below. Nothing here reads a
// colour — if a component needs a literal, it reads it from
// `@generatorai/design-tokens`, not from this provider.
//
// The pre-hydration script in index.html mirrors this before first paint.
// Keep the two in sync; that script is the only thing standing between a
// dark-mode user and a white flash on every cold start.
// ────────────────────────────────────────────────────────────────

import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import {
  ACCENT_STORAGE_KEY,
  DEFAULT_MODE,
  DEFAULT_THEME,
  MODE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  getThemeDef,
  isKnownMode,
  isKnownTheme,
  resolveAccentId,
  resolveAppearance,
  type AccentId,
  type Appearance,
  type ThemeDef,
  type ThemeMode,
} from '@generatorai/design-tokens';

interface ThemeContextValue {
  /** The user's light/dark preference, `system` included. */
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  /** What `mode` actually resolved to right now. */
  resolvedTheme: Appearance;
  /** Palette id. */
  themeId: string;
  setThemeId: (id: string) => void;
  /** The full definition of the active palette — label, fonts, radii, hues. */
  theme: ThemeDef;
  accent: AccentId;
  setAccent: (accent: string) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * localStorage throws outright in some privacy modes, so every access is
 * guarded. A theme preference is not worth a blank screen.
 */
function read(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // Swallow QuotaExceededError / SecurityError in private mode.
  }
}

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultMode?: ThemeMode;
}

export function ThemeProvider({ children, defaultMode = DEFAULT_MODE }: ThemeProviderProps) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    const stored = read(MODE_STORAGE_KEY);
    return isKnownMode(stored) ? stored : defaultMode;
  });

  // An unknown id — a theme we removed, or a hand-edited value — must not
  // wedge the app on a palette that no longer has CSS behind it.
  const [themeId, setThemeIdState] = useState<string>(() => {
    const stored = read(THEME_STORAGE_KEY);
    return isKnownTheme(stored) ? (stored as string) : DEFAULT_THEME;
  });

  const theme = useMemo(() => getThemeDef(themeId), [themeId]);

  const [accent, setAccentState] = useState<AccentId>(() =>
    resolveAccentId(getThemeDef(read(THEME_STORAGE_KEY)), read(ACCENT_STORAGE_KEY)),
  );

  const [resolvedTheme, setResolvedTheme] = useState<Appearance>(() =>
    resolveAppearance(mode, systemPrefersDark()),
  );

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    write(MODE_STORAGE_KEY, next);
  }, []);

  const setThemeId = useCallback((next: string) => {
    const valid = isKnownTheme(next) ? next : DEFAULT_THEME;
    setThemeIdState(valid);
    write(THEME_STORAGE_KEY, valid);
  }, []);

  const setAccent = useCallback(
    (next: string) => {
      const valid = resolveAccentId(theme, next);
      setAccentState(valid);
      write(ACCENT_STORAGE_KEY, valid);
    },
    [theme],
  );

  // Mode → class + data-mode.
  useEffect(() => {
    const resolved = resolveAppearance(mode, systemPrefersDark());
    setResolvedTheme(resolved);

    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(resolved);
    root.dataset.mode = mode;
  }, [mode]);

  // Palette + accent → data attributes. Two separate effects so changing the
  // accent does not re-run the (more expensive) style recalculation that a
  // full palette swap triggers.
  useEffect(() => {
    document.documentElement.dataset.theme = themeId;
  }, [themeId]);

  useEffect(() => {
    document.documentElement.dataset.accent = accent;
  }, [accent]);

  // Follow the OS while, and only while, the user has chosen to.
  useEffect(() => {
    if (mode !== 'system') return undefined;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const resolved = resolveAppearance('system', media.matches);
      setResolvedTheme(resolved);
      document.documentElement.classList.remove('light', 'dark');
      document.documentElement.classList.add(resolved);
    };
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, [mode]);

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, setMode, resolvedTheme, themeId, setThemeId, theme, accent, setAccent }),
    [mode, setMode, resolvedTheme, themeId, setThemeId, theme, accent, setAccent],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
