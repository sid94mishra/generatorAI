// ────────────────────────────────────────────────────────────────
// Stored appearance: the five axes + reduce motion, read from storage
// (D-25; 02-design-system-spec.md §11.1).
//
// One resolution rule for every consumer: the generated pre-paint script
// (emit/prepaint.ts) inlines exactly this logic as ES5, and the web
// ThemeProvider initialises its state with `readStoredAppearance`. A parity
// test runs the emitted script against this function over a matrix of stored
// values, so the first paint and the hydrated app can never disagree (which
// is what a flash is).
// ────────────────────────────────────────────────────────────────

import {
  ACCENT_STORAGE_KEY,
  DEFAULT_DENSITY,
  DEFAULT_FONT_SIZE,
  DEFAULT_MODE,
  DENSITY_STORAGE_KEY,
  FONT_SIZE_STORAGE_KEY,
  MODE_STORAGE_KEY,
  REDUCE_MOTION_STORAGE_KEY,
  THEME_STORAGE_KEY,
  isKnownDensity,
  isKnownFontSize,
  isKnownMode,
  type Density,
  type FontSizeSetting,
  type ThemeMode,
} from './registry.js';
import { DEFAULT_THEME, getThemeDef, isKnownTheme, resolveAccentId } from './themes/index.js';
import type { AccentId } from './themes/types.js';

/** `'on'` = always reduce motion; `'system'` = follow `prefers-reduced-motion` (D-20). */
export type ReduceMotionSetting = 'system' | 'on';

/** Stored value of {@link REDUCE_MOTION_STORAGE_KEY} meaning "always". */
export const REDUCE_MOTION_ON = '1';

export interface StoredAppearance {
  mode: ThemeMode;
  theme: string;
  /** The stored accent, or null when none is stored (the theme's default applies). */
  storedAccent: AccentId | null;
  /** The accent to paint: the stored one, else the theme's own `defaultAccent`. */
  accent: AccentId;
  density: Density;
  fontSize: FontSizeSetting;
  reduceMotion: ReduceMotionSetting;
}

/**
 * Resolve every axis from storage. Unknown or missing values fall back to the
 * defaults (`dark` / `instrument` / theme's accent / `comfortable` / `13`), so
 * a removed theme or a hand-edited value can never paint an unthemed frame.
 */
export function readStoredAppearance(get: (key: string) => string | null): StoredAppearance {
  const mode = get(MODE_STORAGE_KEY);
  const theme = get(THEME_STORAGE_KEY);
  const themeId = isKnownTheme(theme) ? (theme as string) : DEFAULT_THEME;
  const accent = get(ACCENT_STORAGE_KEY);
  const resolvedAccent = resolveAccentId(getThemeDef(themeId), accent);
  const density = get(DENSITY_STORAGE_KEY);
  const fontSize = get(FONT_SIZE_STORAGE_KEY);
  return {
    mode: isKnownMode(mode) ? mode : DEFAULT_MODE,
    theme: themeId,
    storedAccent: resolvedAccent === accent ? resolvedAccent : null,
    accent: resolvedAccent,
    density: isKnownDensity(density) ? density : DEFAULT_DENSITY,
    fontSize: isKnownFontSize(fontSize) ? fontSize : DEFAULT_FONT_SIZE,
    reduceMotion: get(REDUCE_MOTION_STORAGE_KEY) === REDUCE_MOTION_ON ? 'on' : 'system',
  };
}
