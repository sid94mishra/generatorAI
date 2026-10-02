// ────────────────────────────────────────────────────────────────
// Theme resolution shared by prepaint and ThemeProvider (mobile 02 §2.5, §9.5).
//
// (theme, appearance, accent | 'system') → the accent triple and the literal
// ThemeColors, from the active theme's generated palette only.
// ────────────────────────────────────────────────────────────────

import {
  ACCENT_STORAGE_KEY,
  getThemeDef,
  resolveAccentFromSeed,
  resolveAccentId,
  type AccentId,
  type AccentTokenTriple,
  type Appearance,
} from '@generatorai/design-tokens';

import { prefs } from '../services/storage/prefs';
import { systemAccentAvailable, type SystemAccentSeeds } from '../ui/platform/accent';
import { resolveThemeColors, type ThemeColors } from '../ui/lib/themeColors';
import { loadPalette } from './palettes';

/** A named accent, or the Android System (Material You) accent (MD-77). */
export type AccentChoice = AccentId | 'system';

/** MMKV cache of the Material You seeds (02 §2.5), so prepaint needs no native read. */
export const SYSTEM_ACCENT_SEED_KEY = 'generatorai-system-accent-seed';

export function readCachedSeeds(): SystemAccentSeeds | null {
  const raw = prefs.getString(SYSTEM_ACCENT_SEED_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SystemAccentSeeds>;
    return typeof parsed.dark === 'string' && typeof parsed.light === 'string' ? { dark: parsed.dark, light: parsed.light } : null;
  } catch {
    return null;
  }
}

export function writeCachedSeeds(seeds: SystemAccentSeeds): void {
  prefs.setString(SYSTEM_ACCENT_SEED_KEY, JSON.stringify({ ...seeds, at: Date.now() }));
}

/**
 * The stored accent: `'system'` first (resolveAccentId would reject it); when this
 * device or client cannot offer it any more (restored backup, older client), the
 * theme's own default (02 §2.5 "Storage of the choice").
 */
export function resolveAccentChoice(themeId: string, stored: string | null | undefined): AccentChoice {
  if (stored === 'system') return systemAccentAvailable ? 'system' : resolveAccentId(getThemeDef(themeId), null);
  return resolveAccentId(getThemeDef(themeId), stored);
}

export function readStoredAccentChoice(themeId: string): AccentChoice {
  return resolveAccentChoice(themeId, prefs.getString(ACCENT_STORAGE_KEY));
}

export interface ResolvedTheme {
  triple: AccentTokenTriple;
  colors: ThemeColors;
}

export function resolveTheme(themeId: string, appearance: Appearance, accent: AccentChoice, seeds: SystemAccentSeeds | null): ResolvedTheme {
  const theme = getThemeDef(themeId);
  const palette = loadPalette(theme.id);
  let triple = palette.accents[appearance][accent === 'system' ? theme.defaultAccent : accent];
  if (accent === 'system' && seeds) {
    try {
      triple = resolveAccentFromSeed(theme, appearance, seeds[appearance]);
    } catch {
      // An unreadable seed keeps the theme default (02 §2.5: callers catch the RangeError).
    }
  }
  return { triple, colors: resolveThemeColors(palette, appearance, triple) };
}
