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
