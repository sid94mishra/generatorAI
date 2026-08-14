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

import type { Appearance } from './themes/types.js';

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
