// ────────────────────────────────────────────────────────────────
// Theme registry — which appearances the user can pick.
//
// Orthogonal to ACCENTS in tokens.ts: any theme × any accent is valid.
//
// To add a theme:
//   1. Add an entry here.
//   2. If it needs token overrides beyond light/dark, add them to
//      APPEARANCE_TOKENS and teach the emitters about the new id.
//   3. It appears automatically in Settings → Appearance on web AND mobile.
// ────────────────────────────────────────────────────────────────

import type { Appearance } from './tokens.js';

export interface ThemeDef {
  /** Stable id — persisted, and used as `data-theme` on web. */
  id: string;
  label: string;
  /** lucide icon name, resolved by each platform's icon package. */
  icon: 'Sun' | 'Moon' | 'Monitor' | 'Contrast';
  /** Token base this theme resolves to. 'system' follows the OS. */
  appearance: Appearance | 'system';
  /** Hide from the picker (e.g. internal / work-in-progress). */
  hidden?: boolean;
}

export const THEMES: ThemeDef[] = [
  { id: 'system', label: 'System', icon: 'Monitor', appearance: 'system' },
  { id: 'light', label: 'Light', icon: 'Sun', appearance: 'light' },
  { id: 'dark', label: 'Dark', icon: 'Moon', appearance: 'dark' },
];

export const DEFAULT_THEME = 'dark';

export const VISIBLE_THEMES = THEMES.filter((t) => !t.hidden);

export function getTheme(id: string): ThemeDef | undefined {
  return THEMES.find((t) => t.id === id);
}

/** Resolve a theme id to a concrete appearance. */
export function resolveAppearance(id: string, systemPrefersDark: boolean): Appearance {
  const def = getTheme(id);
  if (!def || def.appearance === 'system') return systemPrefersDark ? 'dark' : 'light';
  return def.appearance;
}

/** Storage keys, shared so web and mobile agree on what they persist. */
export const THEME_STORAGE_KEY = 'generatorai-theme';
export const ACCENT_STORAGE_KEY = 'generatorai-accent';
