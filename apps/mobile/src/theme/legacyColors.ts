// ────────────────────────────────────────────────────────────────
// Legacy literal colours (TEMPORARY, M3-05 → removed in M3-08).
//
// The legacy screens read `useTheme().colors.<legacy-name>` literals (415
// sites: `colors.primary`, `colors['muted-foreground']` …) for icons and
// native props. Until M3-08 moves them to `useThemeColors()`, this resolves
// the same bag the NativeWind-era `themeVars` held — computed on demand for
// the active theme only, instead of read from the 25k-line generated table.
// `legacyColors.test.ts` pins it to design-tokens' `resolveTokenSet`.
// ────────────────────────────────────────────────────────────────

import {
  DESIGN_COLOR_VARS,
  FILE_ICON_COLORS,
  getThemeDef,
  resolveAccentTokens,
  resolveAppearanceTokens,
  resolveChartRamp,
  resolveDesignTokens,
  type AccentId,
  type Appearance,
} from '@generatorai/design-tokens';

const kebab = (s: string): string => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** Every legacy + design colour for one theme × appearance × accent, keyed by CSS name without `--`. */
export function legacyColors(themeId: string, appearance: Appearance, accent: AccentId): Record<string, string> {
  const theme = getThemeDef(themeId);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(resolveAppearanceTokens(theme, appearance))) out[kebab(key)] = value;
  const a = resolveAccentTokens(theme, accent, appearance);
  out.primary = a.primary;
  out['primary-emphasis'] = a.primaryEmphasis;
  out.ring = a.ring;
  out.accent = a.accent;
  out['sidebar-accent'] = a.sidebarAccent;
  out['sidebar-accent-foreground'] = a.sidebarAccentForeground;
  out['primary-foreground'] = a.onAccent;
  resolveChartRamp(theme, appearance).forEach((colour, i) => {
    out[`chart-${i + 1}`] = colour;
  });
  for (const [name, pair] of Object.entries(FILE_ICON_COLORS)) out[`file-icon-${name}`] = pair[appearance];
  const d = resolveDesignTokens(theme, appearance, accent);
  for (const [key, name] of DESIGN_COLOR_VARS) out[name.slice(2)] = d[key];
  return out;
}
