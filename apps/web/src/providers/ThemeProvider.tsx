// ────────────────────────────────────────────────────────────────
// ThemeProvider — the single writer of the appearance axes (D-25).
//
//   mode        'light' | 'dark' | 'system'   →  .light / .dark class + data-mode
//   theme       palette id                    →  data-theme
//   accent      accent id                     →  data-accent
//   density     comfortable | compact         →  data-density
//   font size   12 | 13 | 14                  →  data-font-size
//   reduce      'system' | 'on'               →  data-motion="reduce"
//
// All land on <html> through `applyAppearance` (ui/lib/appearance.ts), and CSS
// does the rest: the generated token layers key off exactly those selectors,
// so switching an axis is attribute writes and zero re-renders below. Nothing
// here reads a colour — a component that needs a literal reads it from
// `@generatorai/design-tokens`.
//
// First paint is the generated pre-paint script in index.html, which resolves
// storage with the same rule (`readStoredAppearance`) — a test runs both.
//
// Desktop: the native View ▸ Appearance menu only ASKS (appearanceRequest →
// setMode); after every change this provider pushes the mode and the theme's
// chrome colours to the shell (`setAppearance`), which persists them, mirrors
// `nativeTheme.themeSource` and repaints the window background and caption
// glyphs. No other code writes these attributes or that IPC.
// ────────────────────────────────────────────────────────────────

import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  ACCENT_IDS,
  ACCENT_STORAGE_KEY,
  DENSITY_STORAGE_KEY,
  FONT_SIZE_STORAGE_KEY,
  MODE_STORAGE_KEY,
  REDUCE_MOTION_ON,
  REDUCE_MOTION_STORAGE_KEY,
  THEME_STORAGE_KEY,
  DEFAULT_THEME,
  chromeColors,
  getThemeDef,
  isKnownTheme,
  readStoredAppearance,
  resolveAccentId,
  resolveAppearance,
  type AccentId,
  type Appearance,
  type Density,
  type FontSizeSetting,
  type ReduceMotionSetting,
  type ThemeDef,
  type ThemeMode,
} from '@generatorai/design-tokens';
import { applyAppearance } from '@/ui/lib/appearance.js';
import { onDesktopAppearanceRequest, pushDesktopAppearance } from '@/lib/desktop.js';

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
  /** The accent in effect: the stored choice, else the theme's own default. */
  accent: AccentId;
  setAccent: (accent: string) => void;
  density: Density;
  setDensity: (density: Density) => void;
  fontSize: FontSizeSetting;
  setFontSize: (size: FontSizeSetting) => void;
  /** `'on'` = always; `'system'` = follow `prefers-reduced-motion`. */
  reduceMotion: ReduceMotionSetting;
  setReduceMotion: (setting: ReduceMotionSetting) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

const DARK_QUERY = '(prefers-color-scheme: dark)';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function matches(query: string, fallback: boolean): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return fallback;
  try {
    return window.matchMedia(query).matches;
  } catch {
    return fallback;
  }
}

/** Follow one media query; returns the unsubscribe. */
function watch(query: string, onChange: (matches: boolean) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
  const media = window.matchMedia(query);
  const handler = () => onChange(media.matches);
  media.addEventListener('change', handler);
  return () => media.removeEventListener('change', handler);
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

function isAccentId(value: string): value is AccentId {
  return (ACCENT_IDS as readonly string[]).includes(value);
}

function write(key: string, value: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Swallow QuotaExceededError / SecurityError in private mode.
  }
}

/** How long a burst of changes (dragging through themes) waits before one desktop push. */
const DESKTOP_PUSH_DEBOUNCE_MS = 50;

interface ThemeProviderProps {
  children: React.ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  // One read of storage, with the pre-paint script's own rule, so the first
  // render agrees with the first paint.
  const [initial] = useState(() => readStoredAppearance(read));

  const [mode, setModeState] = useState<ThemeMode>(initial.mode);
  const [themeId, setThemeIdState] = useState<string>(initial.theme);
  // Null = no explicit choice: the accent follows the theme's own default, so
  // switching GitHub → Nord moves blue → teal exactly as the next cold start
  // (pre-paint) would.
  const [storedAccent, setStoredAccent] = useState<AccentId | null>(initial.storedAccent);
  const [density, setDensityState] = useState<Density>(initial.density);
  const [fontSize, setFontSizeState] = useState<FontSizeSetting>(initial.fontSize);
  const [reduceMotion, setReduceMotionState] = useState<ReduceMotionSetting>(initial.reduceMotion);
  const [systemDark, setSystemDark] = useState(() => matches(DARK_QUERY, true));
  const [systemReducedMotion, setSystemReducedMotion] = useState(() => matches(REDUCED_MOTION_QUERY, false));

  const theme = useMemo(() => getThemeDef(themeId), [themeId]);
  const accent = useMemo(() => resolveAccentId(theme, storedAccent), [theme, storedAccent]);
  const resolvedTheme = resolveAppearance(mode, systemDark);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    write(MODE_STORAGE_KEY, next);
  }, []);

  const setThemeId = useCallback((next: string) => {
    const valid = isKnownTheme(next) ? next : DEFAULT_THEME;
    setThemeIdState(valid);
    write(THEME_STORAGE_KEY, valid);
  }, []);

  // An unknown id is ignored rather than coerced: storing the theme's default
  // as an explicit choice would stop an unchosen accent following the theme.
  const setAccent = useCallback((next: string) => {
    if (!isAccentId(next)) return;
    setStoredAccent(next);
    write(ACCENT_STORAGE_KEY, next);
  }, []);

  const setDensity = useCallback((next: Density) => {
    setDensityState(next);
    write(DENSITY_STORAGE_KEY, next);
  }, []);

  const setFontSize = useCallback((next: FontSizeSetting) => {
    setFontSizeState(next);
    write(FONT_SIZE_STORAGE_KEY, next);
  }, []);

  const setReduceMotion = useCallback((next: ReduceMotionSetting) => {
    setReduceMotionState(next);
    write(REDUCE_MOTION_STORAGE_KEY, next === 'on' ? REDUCE_MOTION_ON : null);
  }, []);

  // The one DOM write. Layout effect: an axis change repaints in the same
  // frame as the React commit that caused it, never a frame later.
  useLayoutEffect(() => {
    applyAppearance({
      mode,
      resolved: resolvedTheme,
      theme: themeId,
      accent,
      density,
      fontSize,
      reduceMotion: reduceMotion === 'on' || systemReducedMotion,
    });
  }, [mode, resolvedTheme, themeId, accent, density, fontSize, reduceMotion, systemReducedMotion]);

  // Follow the OS light/dark while, and only while, the user has chosen to.
  useEffect(() => {
    if (mode !== 'system') return undefined;
    setSystemDark(matches(DARK_QUERY, true));
    return watch(DARK_QUERY, setSystemDark);
  }, [mode]);

  // The OS reduced-motion preference always counts (D-20).
  useEffect(() => watch(REDUCED_MOTION_QUERY, setSystemReducedMotion), []);

  // Desktop: View ▸ Appearance asks; this provider applies.
  useEffect(() => onDesktopAppearanceRequest(setMode), [setMode]);

  // Desktop: mirror mode + the theme's chrome colours (hex literals from the
  // token package, both appearances — never getComputedStyle, which can return
  // a CSS colour function that setBackgroundColor rejects). No-op in a browser tab.
  useEffect(() => {
    const timer = setTimeout(() => {
      const light = chromeColors(themeId, 'light');
      const dark = chromeColors(themeId, 'dark');
      pushDesktopAppearance({
        mode,
        themeId,
        groundLight: light.ground,
        groundDark: dark.ground,
        fgLight: light.fg,
        fgDark: dark.fg,
      });
    }, DESKTOP_PUSH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [mode, themeId]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      setMode,
      resolvedTheme,
      themeId,
      setThemeId,
      theme,
      accent,
      setAccent,
      density,
      setDensity,
      fontSize,
      setFontSize,
      reduceMotion,
      setReduceMotion,
    }),
    [
      mode,
      setMode,
      resolvedTheme,
      themeId,
      setThemeId,
      theme,
      accent,
      setAccent,
      density,
      setDensity,
      fontSize,
      setFontSize,
      reduceMotion,
      setReduceMotion,
    ],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
