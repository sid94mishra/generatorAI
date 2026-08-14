// ────────────────────────────────────────────────────────────────
// Theme registry.
//
// To add a theme:
//   1. Add `<id>.ts` next to this file, exporting a `ThemeDef`.
//   2. Add it to THEMES below.
//   3. `pnpm tokens:write`.
//
// That is the whole checklist. The picker, the CSS, the mobile token module,
// the terminal palette, the syntax colours and the contrast suite all read
// from THEMES, so a new theme is covered by the accessibility tests before it
// is ever rendered.
//
// Order within a group is the order in the picker. `github` stays first
// because it is the default and the one users are already looking at;
// everything after it is ordered by how likely it is to be recognised.
// ────────────────────────────────────────────────────────────────

import { ayu } from './ayu.js';
import { carbon } from './carbon.js';
import { catppuccin } from './catppuccin.js';
import { clay } from './clay.js';
import { contrast } from './contrast.js';
import { dracula } from './dracula.js';
import { everforest } from './everforest.js';
import { flexoki } from './flexoki.js';
import { github } from './github.js';
import { graphite } from './graphite.js';
import { gruvbox } from './gruvbox.js';
import { nightOwl } from './night-owl.js';
import { nord } from './nord.js';
import { one } from './one.js';
import { rosePine } from './rose-pine.js';
import { solarized } from './solarized.js';
import { tokyoNight } from './tokyo-night.js';
import type { AccentId, ThemeDef, ThemeGroup } from './types.js';
import { ACCENT_IDS, THEME_GROUPS } from './types.js';

export * from './types.js';
export * from './fonts.js';

export const THEMES: ThemeDef[] = [
  // Product — interface-first palettes.
  github,
  graphite,
  carbon,
  clay,

  // Editor — ports of the most-installed syntax themes.
  one,
  dracula,
  tokyoNight,
  catppuccin,
  ayu,
  nightOwl,
  rosePine,

  // Low glare — warm or desaturated, tuned for long sessions.
  nord,
  everforest,
  gruvbox,
  solarized,
  flexoki,
  contrast,
];

/** The theme every user starts on — and the one `:root` is emitted from. */
export const DEFAULT_THEME = 'github';

export const VISIBLE_THEMES = THEMES.filter((t) => !t.hidden);

/** Visible themes bucketed by group, in registry order, for the picker. */
export function themesByGroup(): Array<{
  id: ThemeGroup;
  label: string;
  description: string;
  themes: ThemeDef[];
}> {
  return THEME_GROUPS.map((group) => ({
    ...group,
    themes: VISIBLE_THEMES.filter((t) => t.group === group.id),
  })).filter((g) => g.themes.length > 0);
}

export function getThemeDef(id: string | null | undefined): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? (THEMES.find((t) => t.id === DEFAULT_THEME) as ThemeDef);
}

/** True only for ids we actually ship — used to reject stale stored values. */
export function isKnownTheme(id: string | null | undefined): boolean {
  return THEMES.some((t) => t.id === id);
}

/**
 * Coerce a stored accent to one this theme can render.
 *
 * Accent ids are shared across themes, so this only ever falls back when the
 * stored value predates the registry (or was hand-edited); switching themes
 * deliberately keeps the user's accent choice.
 */
export function resolveAccentId(theme: ThemeDef, accentId: string | null | undefined): AccentId {
  return (ACCENT_IDS as readonly string[]).includes(accentId ?? '')
    ? (accentId as AccentId)
    : theme.defaultAccent;
}
