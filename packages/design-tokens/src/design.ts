// ────────────────────────────────────────────────────────────────
// The design layer (D-06, D-08, D-12; 02-design-system-spec.md §2).
//
// A second, design-named token set resolved from the same ThemeDef as the
// legacy layer. It is emitted as `--gai-*` variables next to the legacy ones
// and never changes a legacy value: legacy pages keep rendering exactly as
// before while ported pages use `bg-surface`, `text-fg-2`, `border-line` ….
//
// Where the boards' values fail WCAG, the derivation clamps them (D-12):
//   • fg-2 / fg-3 reach the theme's text bar on every surface and on hovered /
//     selected rows, not only on the page background;
//   • line-strong reaches 3:1 on all five surfaces (inputs inside dialogs);
//   • status colours split into a glyph hue (3:1) and a text value (4.5:1 on
//     its own tint), so badges stay readable without flattening the hues;
//   • focus is the accent clamped to 3:1 on every surface.
// ────────────────────────────────────────────────────────────────

import {
  contrastRatio,
  ensureContrastAll,
  flatten,
  oklabMix,
  parseHex,
  relativeLuminance,
  toHex,
  withAlpha,
  type Rgba,
} from './color.js';
import {
  TINT,
  resolveAccentTokens,
  type AccentId,
  type Appearance,
  type HuePalette,
  type ThemeDef,
} from './themes/types.js';
import { DEFAULT_FONT_SIZE, type Density, type FontSizeSetting } from './registry.js';
import { SHELL } from './chrome.js';
import { MOTION } from './tokens.js';
import {
  RADIUS_STEPS,
  TEXT_STEPS,
  type ContainerName,
  type HeightName,
  type RadiusStep,
  type TextStep,
  type ZName,
} from './vocabulary.js';

/** Scrim behind modal layers: black 62 % (dark) / near-black 30 % (light). */
export const SCRIM = { dark: '#0000009e', light: '#1414184d' } as const satisfies Record<Appearance, string>;
/** Drop shadow of floating layers: 55 % (dark) / 14 % (light). */
export const SHADOW = { dark: '#0000008c', light: '#14141e24' } as const satisfies Record<Appearance, string>;

/** Every colour the design layer resolves for one (theme, appearance, accent). */
export interface DesignTokens {
  ground: string;
  surface: string;
  raised: string;
  overlay: string;
  sunken: string;
  hover: string;
  selected: string;
  lineSoft: string;
  line: string;
  lineStrong: string;
  fg: string;
  fg2: string;
  fg3: string;
  accent: string;
  onAccent: string;
  focus: string;
  run: string;
  runText: string;
  runBg: string;
  ok: string;
  okText: string;
  okBg: string;
  warn: string;
  warnText: string;
  warnBg: string;
  err: string;
  errText: string;
  errBg: string;
  addBg: string;
  delBg: string;
  scrim: string;
  shadowPop: string;
}

/** camelCase token → raw CSS variable, in emission order. */
export const DESIGN_COLOR_VARS: ReadonlyArray<readonly [keyof DesignTokens, string]> = [
  ['ground', '--gai-ground'],
  ['surface', '--gai-surface'],
  ['raised', '--gai-raised'],
  ['overlay', '--gai-overlay'],
  ['sunken', '--gai-sunken'],
  ['hover', '--gai-hover'],
  ['selected', '--gai-selected'],
  ['lineSoft', '--gai-line-soft'],
  ['line', '--gai-line'],
  ['lineStrong', '--gai-line-strong'],
  ['fg', '--gai-fg'],
  ['fg2', '--gai-fg-2'],
  ['fg3', '--gai-fg-3'],
  ['accent', '--gai-accent'],
  ['onAccent', '--gai-on-accent'],
  ['focus', '--gai-focus'],
  ['run', '--gai-run'],
  ['runText', '--gai-run-text'],
  ['runBg', '--gai-run-bg'],
  ['ok', '--gai-ok'],
  ['okText', '--gai-ok-text'],
  ['okBg', '--gai-ok-bg'],
  ['warn', '--gai-warn'],
  ['warnText', '--gai-warn-text'],
  ['warnBg', '--gai-warn-bg'],
  ['err', '--gai-err'],
  ['errText', '--gai-err-text'],
  ['errBg', '--gai-err-bg'],
  ['addBg', '--gai-add-bg'],
  ['delBg', '--gai-del-bg'],
  ['scrim', '--gai-scrim'],
  ['shadowPop', '--gai-shadow-pop'],
];

/** The three tokens an accent changes; everything else is accent-independent. */
export const DESIGN_ACCENT_KEYS = ['accent', 'onAccent', 'focus'] as const satisfies ReadonlyArray<keyof DesignTokens>;

const STATUS_HUES = [
  ['run', 'blue'],
  ['ok', 'green'],
  ['warn', 'yellow'],
  ['err', 'red'],
] as const satisfies ReadonlyArray<readonly [string, keyof HuePalette]>;

const NON_TEXT = 3;

const hex = (c: Rgba): string => toHex(c);
const lum = (c: string): number => relativeLuminance(parseHex(c));
const minContrast = (c: string | Rgba, backs: ReadonlyArray<string | Rgba>): number =>
  Math.min(...backs.map((b) => contrastRatio(c, b)));

/**
 * Resolve the design layer for one (theme, appearance, accent) — 02 §2.2.
 *
 * Takes no density or font-size input on purpose: those axes never change a
 * colour (02 §12 row 16).
 */
export function resolveDesignTokens(theme: ThemeDef, appearance: Appearance, accentId: AccentId): DesignTokens {
  const s = theme[appearance];
  const fg = s.foreground;
  const minText = theme.textContrast ?? 4.5;

  // 1–3. Surfaces. Ties put `ground` on the background.
  const cardIsDarker = lum(s.card) < lum(s.background);
  const ground = cardIsDarker ? s.card : s.background;
  const surface = cardIsDarker ? s.background : s.card;
  const raised = s.raised.toLowerCase() === surface.toLowerCase() ? s.subtle : s.raised;
  const overlay = s.popover;
  const sunken = s.sunken ?? ground;

  // 4. Foreground washes.
  const hover = hex(withAlpha(fg, TINT.hover[appearance]));
  const selected = hex(withAlpha(fg, TINT.selected[appearance]));

  // 5–7. Text tiers, clamped on every surface and on hovered/selected rows.
  const textBacks = [
    ground,
    surface,
    raised,
    overlay,
    sunken,
    flatten(hover, surface),
    flatten(hover, ground),
    flatten(selected, surface),
    flatten(selected, ground),
  ];
  const fg2 = hex(ensureContrastAll(s.mutedForeground, textBacks, minText, fg));
  let fg3 = fg2;
  for (let k = 18; k >= 0; k -= 1) {
    const candidate = oklabMix(fg2, surface, k / 100);
    if (minContrast(candidate, textBacks) >= minText) {
      fg3 = hex(candidate);
      break;
    }
  }

  // 8. Lines. Only line-strong is clamped: it is the edge of inputs,
  //    checkboxes and switches (WCAG 1.4.11), on any surface.
  const fiveSurfaces = [ground, surface, raised, overlay, sunken];
  const fourSurfaces = [ground, surface, raised, overlay];
  const lineStrong = hex(ensureContrastAll(s.border, fiveSurfaces, NON_TEXT, fg));

  // 9. Status: hue for glyphs and fills, a text value for coloured words.
  const status = {} as Record<(typeof STATUS_HUES)[number][0], { hue: string; text: string; bg: string }>;
  for (const [state, hueName] of STATUS_HUES) {
    const hue = s.hues[hueName];
    const bg = hex(withAlpha(hue, TINT.status[appearance]));
    status[state] = {
      bg,
      hue: hex(ensureContrastAll(hue, fourSurfaces, NON_TEXT, fg)),
      text: hex(
        ensureContrastAll(
          hue,
          [flatten(bg, surface), flatten(bg, ground), flatten(bg, raised), ...fourSurfaces],
          minText,
          fg,
        ),
      ),
    };
  }

  // 12. Accent. Ink is the foreground with surface-coloured text on it.
  const a = resolveAccentTokens(theme, accentId, appearance);
  const accent = accentId === 'ink' ? fg : a.primaryEmphasis;
  const onAccent = a.onAccent;
  const focus = hex(ensureContrastAll(accent, fourSurfaces, NON_TEXT, fg));

  return {
    ground,
    surface,
    raised,
    overlay,
    sunken,
    hover,
    selected,
    lineSoft: s.borderMuted,
    line: s.border,
    lineStrong,
    fg,
    fg2,
    fg3,
    accent,
    onAccent,
    focus,
    run: status.run.hue,
    runText: status.run.text,
    runBg: status.run.bg,
    ok: status.ok.hue,
    okText: status.ok.text,
    okBg: status.ok.bg,
    warn: status.warn.hue,
    warnText: status.warn.text,
    warnBg: status.warn.bg,
    err: status.err.hue,
    errText: status.err.text,
    errBg: status.err.bg,
    // 10–11. Diff washes, scrim, the one elevation shadow.
    addBg: hex(withAlpha(s.hues.green, TINT.diff[appearance])),
    delBg: hex(withAlpha(s.hues.red, TINT.diff[appearance])),
    scrim: SCRIM[appearance],
    shadowPop: `0 16px 40px ${SHADOW[appearance]}, 0 0 0 1px ${hex(withAlpha(fg, 6))}`,
  };
}

// ────────────────────────────────────────────────────────────────
// Scales (P1-T6): radius, type, heights + density, z-order, motion, shell
// widths. Web values; `geometry.ts` collects them per platform (M-04).
// ────────────────────────────────────────────────────────────────

/** Offset of each radius step from the theme's base radius (D-14). */
export const RADIUS_OFFSETS = {
  badge: -2,
  'control-sm': -1,
  control: 0,
  seg: 1,
  card: 2,
  panel: 4,
  dialog: 6,
} as const satisfies Record<RadiusStep, number>;

/**
 * The seven radius steps for a theme's base radius `r` (= `ThemeDef.radius.DEFAULT`),
 * each clamped to ≥ 2px — or ≥ 0 for a theme that chooses square corners (r = 0).
 * Instrument (r = 6) reproduces the boards: 4/5/6/7/8/10/12.
 */
export function radiusScale(base: number): Record<RadiusStep, number> {
  const floor = base === 0 ? 0 : 2;
  const out = {} as Record<RadiusStep, number>;
  for (const step of RADIUS_STEPS) out[step] = Math.max(floor, base + RADIUS_OFFSETS[step]);
  return out;
}

export interface TypeStep {
  /** px at the default interface font size (13). */
  size: number;
  /** Unitless. */
  lineHeight: number;
  weight: 400 | 500 | 600;
  /** em. */
  tracking: number;
}

/** The 7-step type scale at the default interface size (D-13, 02 §5.2). */
export const TYPE_SCALE = {
  micro: { size: 11, lineHeight: 1.45, weight: 400, tracking: 0 },
  small: { size: 12, lineHeight: 1.45, weight: 400, tracking: 0 },
  ui: { size: 13, lineHeight: 1.45, weight: 400, tracking: 0 },
  body: { size: 14, lineHeight: 1.6, weight: 400, tracking: 0 },
  title: { size: 16, lineHeight: 1.3, weight: 600, tracking: 0 },
  heading: { size: 20, lineHeight: 1.3, weight: 600, tracking: -0.01 },
  display: { size: 28, lineHeight: 1.2, weight: 600, tracking: -0.02 },
} as const satisfies Record<TextStep, TypeStep>;

/** Every step moves by the same pixel offset as the interface font size setting. */
export function typeSizes(setting: FontSizeSetting): Record<TextStep, number> {
  const delta = Number(setting) - Number(DEFAULT_FONT_SIZE);
  const out = {} as Record<TextStep, number>;
  for (const step of TEXT_STEPS) out[step] = TYPE_SCALE[step].size + delta;
  return out;
}

/** Row and control heights in px, per density (D-15, 02 §6.3). Bars stay put. */
export const HEIGHTS = {
  comfortable: {
    'control-sm': 24,
    control: 28,
    'control-lg': 32,
    nav: 30,
    item: 30,
    step: 28,
    th: 32,
    row: 44,
    tab: 36,
    bar: 44,
    badge: 20,
    kbd: 18,
    'panel-bar': 40,
    'dialog-bar': 48,
    footer: 56,
  },
  compact: {
    'control-sm': 20,
    control: 24,
    'control-lg': 28,
    nav: 26,
    item: 26,
    step: 24,
    th: 28,
    row: 36,
    tab: 32,
    bar: 44,
    badge: 20,
    kbd: 18,
    'panel-bar': 40,
    'dialog-bar': 48,
    footer: 56,
  },
} as const satisfies Record<Density, Record<HeightName, number>>;

/** Smallest hit target at any density (WCAG 2.5.8): compact controls draw smaller but keep this. */
export const MIN_HIT_TARGET = 24;

/**
 * Named stacking layers (D-41, 02 §6.5). Dropdowns and popovers sit ABOVE
 * dialogs: they portal to <body> and open from inside dialogs.
 */
export const Z_INDEX = {
  base: 0,
  sticky: 10,
  dock: 20,
  rail: 30,
  sidebar: 30,
  dialog: 1000,
  dropdown: 1100,
  popover: 1100,
  toast: 1150,
  tooltip: 1200,
} as const satisfies Record<ZName, number>;

/** Transition timing (D-20, 02 §6.7). `MOTION` (tokens.ts) holds the same durations as numbers. */
export const MOTION_CSS = {
  duration: { fast: `${MOTION.fast}ms`, normal: `${MOTION.normal}ms`, slow: `${MOTION.slow}ms` },
  ease: { standard: 'cubic-bezier(0.2, 0, 0, 1)' },
} as const;

/**
 * The vocabulary's container names (`w-sidebar`, `max-w-dialog` …) → shell
 * widths in px, emitted as `--gai-w-*` (D-15, 02 §8). A projection of `SHELL`
 * (chrome.ts), the one source of the numbers, which the desktop main process
 * imports through the lean `./chrome` subpath — never redefine a width here.
 */
export const CONTAINER_WIDTHS = {
  sidebar: SHELL.sidebarWidth,
  rail: SHELL.railWidth,
  dock: SHELL.dockWidth,
  'dock-run': SHELL.dockWidthRun,
  sheet: SHELL.dockSheetWidth,
  'dialog-sm': SHELL.dialogWidth.sm,
  dialog: SHELL.dialogWidth.md,
  'dialog-lg': SHELL.dialogWidth.lg,
} as const satisfies Record<ContainerName, number>;

/** Elevation recipes (02 §6.4) as design-class strings: flat, float, modal. */
export const ELEVATION = {
  flat: 'border border-line-soft',
  float: 'bg-overlay border border-line shadow-pop rounded-card',
  modal: 'bg-overlay border border-line shadow-pop rounded-dialog',
} as const;
