// ────────────────────────────────────────────────────────────────
// Uniwind theme emitter (mobile 02 §9.2; MD-10, MD-115).
//
//   apps/mobile/src/theme/uniwind-themes.css
//     @layer theme { :root {
//       @variant dark / light          = Instrument (Uniwind's built-in adaptive
//                                        themes, so the first frame before
//                                        setTheme is themed — MD-77)
//       @variant <theme>-<appearance>  × 36, UNIWIND_THEMES order
//       geometry: un-varianted iOS values (also the react-native-web preview),
//       then @variant ios { … } and @variant android { … }
//     } }
//   apps/mobile/src/theme/uniwind-themes.json   UNIWIND_THEMES for Metro's
//                                               `extraThemes` (plain CommonJS)
//
// Every colour block declares the same 41 variables at the theme's DEFAULT
// accent (Uniwind requires an identical key set per theme); the active accent
// is applied at runtime with `Uniwind.updateCSSVariables(name, accentVars(…))`.
// Values are literals only: px (Uniwind's 1px = 1 pt / dp), #rrggbb[aa],
// unitless weights / z, ms — no rem, em, %, calc() or color-mix().
// ────────────────────────────────────────────────────────────────

import { DESIGN_COLOR_VARS, MOTION_CSS } from '../design.js';
import { GEOMETRY } from '../geometry.js';
import { SHADOW_FLOAT } from '../glass.js';
import { THEMES, getThemeDef } from '../themes/index.js';
import type { Appearance, ThemeDef } from '../themes/types.js';
import { CONTAINER_NAMES, EASE_NAMES, HEIGHT_NAMES, RADIUS_STEPS, TEXT_STEPS, Z_NAMES } from '../vocabulary.js';
import {
  MOBILE_CONTAINER_NAMES,
  MOBILE_HEIGHT_NAMES,
  MOBILE_RADIUS_STEPS,
  MOBILE_SPACING_NAMES,
  MOBILE_TEXT_STEPS,
} from '../vocabulary-mobile.js';
import { UNIWIND_THEMES, uniwindThemeName } from '../uniwind-names.js';
import { resolveTokenSet } from './native.js';

export { UNIWIND_THEMES, uniwindThemeName };

export type NativePlatform = 'ios' | 'android';

const APPEARANCES: readonly Appearance[] = ['dark', 'light'];

/** The default theme that Uniwind's adaptive `dark` / `light` variants carry. */
const BASE_THEME_ID = 'instrument';

/** Chart ramp and canvas: the shared (unprefixed) variables mobile uses (02 §2.1 #33–34). */
const SHARED_VARS = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6', '--canvas-bg', '--canvas-dot'];

/** Every --gai-* colour + shared vars + --gai-shadow-float for one theme × appearance at its DEFAULT accent (41 vars). */
export function uniwindColorVars(theme: ThemeDef, appearance: Appearance): Record<string, string> {
  const set = resolveTokenSet(theme.id, appearance, theme.defaultAccent);
  const out: Record<string, string> = {};
  for (const [, name] of DESIGN_COLOR_VARS) out[name] = set[name]!;
  for (const name of SHARED_VARS) out[name] = set[name]!;
  out['--gai-shadow-float'] = SHADOW_FLOAT;
  return out;
}

const px = (n: number): string => `${n}px`;

/** Family names per OS (02 §4.4); the platform blocks let Android differ without code. */
const FONT_FAMILIES: Record<NativePlatform, { sans: string; mono: string }> = {
  ios: { sans: "'Instrument Sans'", mono: "'JetBrains Mono'" },
  android: { sans: "'Instrument Sans'", mono: "'JetBrains Mono'" },
};

/** Every geometry var for one platform (identical key set on both). */
export function uniwindGeometryVars(platform: NativePlatform): Record<string, string> {
  const g = GEOMETRY[platform];
  const out: Record<string, string> = {};
  for (const step of [...TEXT_STEPS, ...MOBILE_TEXT_STEPS]) {
    const t = g.type[step];
    out[`--gai-text-${step}`] = px(t.size);
    out[`--gai-leading-${step}`] = px(t.lineHeight);
    out[`--gai-weight-${step}`] = String(t.weight);
    out[`--gai-tracking-${step}`] = px(t.tracking);
  }
  for (const step of [...RADIUS_STEPS, ...MOBILE_RADIUS_STEPS]) out[`--gai-radius-${step}`] = px(g.radii[step]);
  for (const name of HEIGHT_NAMES) out[`--gai-h-${name}`] = px(g.heights.comfortable[name]);
  for (const name of MOBILE_HEIGHT_NAMES) out[`--gai-h-${name}`] = px(g.mobileHeights[name]);
  for (const name of Z_NAMES) out[`--gai-z-${name}`] = String(g.zIndex[name]);
  for (const name of CONTAINER_NAMES) out[`--gai-w-${name}`] = px(g.shell[name]);
  for (const name of MOBILE_CONTAINER_NAMES) out[`--gai-w-${name}`] = px(g.mobileShell[name]);
  for (const name of MOBILE_SPACING_NAMES) out[`--gai-space-${name}`] = px(g.spacing[name]);
  out['--gai-font-sans'] = FONT_FAMILIES[platform].sans;
  out['--gai-font-mono'] = FONT_FAMILIES[platform].mono;
  // Reduced motion is handled in JS (02 §6.3), never by these variables.
  for (const [name, value] of Object.entries(MOTION_CSS.duration)) out[`--gai-duration-${name}`] = value;
  for (const name of EASE_NAMES) out[`--gai-ease-${name}`] = MOTION_CSS.ease[name];
  return out;
}

const decls = (vars: Record<string, string>, indent: string): string[] =>
  Object.entries(vars).map(([k, v]) => `${indent}${k}: ${v};`);

const variant = (name: string, vars: Record<string, string>): string[] => [
  `    @variant ${name} {`,
  ...decls(vars, '      '),
  '    }',
];

/** The CSS file (02 §9.2 "File shape"). */
export function emitUniwindThemes(): string {
  const base = getThemeDef(BASE_THEME_ID);
  const lines = [
    '/* GENERATED from packages/design-tokens (emit/uniwind.ts) — do not edit. Regenerate with `pnpm tokens:write`. */',
    '@layer theme {',
    '  :root {',
    "    /* Uniwind's built-in adaptive themes = Instrument (MD-77): present so the first frame before setTheme is themed. */",
    ...variant('dark', uniwindColorVars(base, 'dark')),
    ...variant('light', uniwindColorVars(base, 'light')),
    '',
    `    /* ${UNIWIND_THEMES.length} themes × appearances at each theme's default accent; accents via Uniwind.updateCSSVariables. */`,
  ];
  for (const theme of THEMES) {
    for (const appearance of APPEARANCES) {
      lines.push(...variant(uniwindThemeName(theme.id, appearance), uniwindColorVars(theme, appearance)));
    }
  }
  lines.push(
    '',
    '    /* Geometry. The un-varianted values are iOS (also used by the react-native-web preview). */',
    ...decls(uniwindGeometryVars('ios'), '    '),
    ...variant('ios', uniwindGeometryVars('ios')),
    ...variant('android', uniwindGeometryVars('android')),
    '  }',
    '}',
    '',
  );
  return lines.join('\n');
}

/** JSON array of UNIWIND_THEMES (metro.config.js `extraThemes`). */
export function emitUniwindThemeList(): string {
  return `${JSON.stringify(UNIWIND_THEMES, null, 2)}\n`;
}
