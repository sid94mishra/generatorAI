// ────────────────────────────────────────────────────────────────
// Legacy literal colour names (TEMPORARY: M3-08 → deleted in M10 with the
// last legacy screen). The colour twin of legacy.css: the legacy screens read
// `useTheme().legacyColors['muted-foreground']` etc. (≈ 415 sites), resolved
// from ThemeColors with exactly the class mapping of legacy.css, so a
// legacy icon tint and its neighbouring legacy class always agree. New code
// uses classes, or useThemeColors() in src/ui / src/services.
// ────────────────────────────────────────────────────────────────

import { FILE_ICON_COLORS, type DesignTokens } from '@generatorai/design-tokens';

import type { ThemeColors } from '../ui/lib/themeColors';

/** Legacy name → design token (02 §9.4 alias list; MD-123). */
export const LEGACY_COLOR_TOKEN = {
  background: 'surface',
  foreground: 'fg',
  card: 'raised',
  'card-foreground': 'fg',
  popover: 'overlay',
  'popover-foreground': 'fg',
  subtle: 'sunken',
  emphasis: 'selected',
  surface: 'surface',
  'surface-hover': 'sunken',
  raised: 'raised',
  overlay: 'overlay',
  muted: 'sunken',
  'muted-foreground': 'fg2',
  secondary: 'raised',
  'secondary-foreground': 'fg',
  accent: 'selected',
  'accent-foreground': 'fg',
  primary: 'accent',
  'primary-emphasis': 'accent',
  'primary-foreground': 'onAccent',
  ring: 'focus',
  control: 'selected',
  'control-strong': 'selected',
  'control-foreground': 'fg',
  border: 'line',
  'border-muted': 'lineSoft',
  input: 'lineStrong',
  destructive: 'err',
  'destructive-foreground': 'onAccent',
  success: 'ok',
  'success-muted': 'okBg',
  warning: 'warn',
  'warning-muted': 'warnBg',
  info: 'run',
  'info-muted': 'runBg',
  danger: 'err',
  'danger-muted': 'errBg',
  done: 'ok',
  sidebar: 'raised',
  'sidebar-foreground': 'fg',
  'sidebar-border': 'lineSoft',
  'sidebar-accent': 'selected',
  'sidebar-accent-foreground': 'fg',
} as const satisfies Record<string, keyof DesignTokens>;

export function legacyColorsFrom(c: ThemeColors): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, token] of Object.entries(LEGACY_COLOR_TOKEN)) out[name] = c[token];
  c.chart.forEach((colour, i) => {
    out[`chart-${i + 1}`] = colour;
  });
  out['canvas-bg'] = c.canvasBg;
  out['canvas-dot'] = c.canvasDot;
  for (const [name, pair] of Object.entries(FILE_ICON_COLORS)) out[`file-icon-${name}`] = pair[c.appearance];
  return out;
}
