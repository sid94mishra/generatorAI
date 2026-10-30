// ────────────────────────────────────────────────────────────────
// Appearance MODE registry — light / dark / follow the OS.
//
// This is one of three orthogonal axes, and the smallest:
//
//   mode    (here)           which variant of the theme is active
//   theme   (themes/)        the palette itself — surfaces, hues, type, radius
//   accent  (themes/types)   interactive colour only
//
// Any mode × any theme × any accent is valid, and each is persisted
// separately. Splitting mode from theme is what lets "System" keep working
// when the user is on Catppuccin: the OS tells us *which* variant, the theme
// tells us what that variant looks like.
// ────────────────────────────────────────────────────────────────

import type { AccentId, Appearance } from './themes/types.js';

export type ThemeMode = 'system' | 'light' | 'dark';

export interface ModeDef {
  id: ThemeMode;
  label: string;
  /** lucide icon name, resolved by each platform's icon package. */
  icon: 'Sun' | 'Moon' | 'Monitor';
  description: string;
}

export const MODES: ModeDef[] = [
  { id: 'system', label: 'System', icon: 'Monitor', description: 'Follow your operating system.' },
  { id: 'light', label: 'Light', icon: 'Sun', description: 'Always use the light variant.' },
  { id: 'dark', label: 'Dark', icon: 'Moon', description: 'Always use the dark variant.' },
];

export const DEFAULT_MODE: ThemeMode = 'dark';

export function isKnownMode(id: string | null | undefined): id is ThemeMode {
  return MODES.some((m) => m.id === id);
}

/** Resolve a mode to the concrete appearance the tokens are keyed on. */
export function resolveAppearance(mode: string | null | undefined, systemPrefersDark: boolean): Appearance {
  if (mode === 'light' || mode === 'dark') return mode;
  return systemPrefersDark ? 'dark' : 'light';
}

// ── Storage keys ────────────────────────────────────────────────
//
// Shared so web and mobile agree on what they persist. `generatorai-theme`
// keeps its original meaning (the MODE) rather than being repurposed: users
// upgrading into the theme system keep their light/dark preference and simply
// gain a palette, instead of silently being reset.

export const MODE_STORAGE_KEY = 'generatorai-theme';
export const THEME_STORAGE_KEY = 'generatorai-theme-palette';
export const ACCENT_STORAGE_KEY = 'generatorai-accent';
export const DENSITY_STORAGE_KEY = 'generatorai-density';
export const FONT_SIZE_STORAGE_KEY = 'generatorai-font-size';
/** `'1'` = always reduce motion; absent = follow the OS (02 §11.1). */
export const REDUCE_MOTION_STORAGE_KEY = 'generatorai-reduce-motion';

// ── Defaults for the remaining axes (02 §4.3) ───────────────────

/**
 * The accent of the default theme. A user on another theme with no stored
 * accent gets THAT theme's `defaultAccent` (`resolveAccentId`), not this.
 */
export const DEFAULT_ACCENT: AccentId = 'ink';

/** Row/control density (D-15). Compact subtracts 4px from rows and controls. */
export const DENSITIES = ['comfortable', 'compact'] as const;
export type Density = (typeof DENSITIES)[number];
export const DEFAULT_DENSITY: Density = 'comfortable';

/** Interface font size (D-13): shifts every type step by −1 / 0 / +1 px. */
export const FONT_SIZES = ['12', '13', '14'] as const;
export type FontSizeSetting = (typeof FONT_SIZES)[number];
export const DEFAULT_FONT_SIZE: FontSizeSetting = '13';

export function isKnownDensity(id: string | null | undefined): id is Density {
  return (DENSITIES as readonly string[]).includes(id ?? '');
}

export function isKnownFontSize(id: string | null | undefined): id is FontSizeSetting {
  return (FONT_SIZES as readonly string[]).includes(id ?? '');
}
