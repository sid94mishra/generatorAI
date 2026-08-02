// ────────────────────────────────────────────────────────────────
// Web CSS emitter.
//
// Produces the three token layers that apps/web/src/styles/globals.css
// consumes. The generator splices this between marker comments so the
// hand-written base styles below the markers stay hand-written.
//
//   Layer 1  raw semantic values, per appearance and per accent
//   Layer 2  `@theme inline` — makes them Tailwind utilities
//   Layer 3  `--color-*` compat aliases for legacy arbitrary values
//
// ── Two deliberate changes from the hand-written original ────────
//
// 1. Accent tints are DERIVED for every accent, including blue. The
//    hand-written blue literals were `#1f6feb22` / `#0969da15`; deriving
//    them from TINT gives `#1f6feb21` / `#0969da14`. That is a one-step
//    (1/255) alpha change on two tokens — below the 8-bit rounding of the
//    percentage those literals were meant to express, and far below any
//    perceptual threshold. Uniform derivation is worth more than bug-for-bug
//    fidelity to two typos.
//
// 2. File-icon colours are emitted per appearance instead of via
//    `light-dark()`. Both forms resolve identically on <html> today, but
//    concrete values also survive a shadow root that declares its own
//    `color-scheme` — which is exactly where these tokens are consumed.
// ────────────────────────────────────────────────────────────────

import {
  ACCENTS,
  APPEARANCE_TOKENS,
  DEFAULT_ACCENT,
  FILE_ICON_COLORS,
  FONT_FAMILY,
  RADIUS,
  resolveAccent,
  type Appearance,
  type AppearanceTokens,
} from '../tokens.js';

export const TOKENS_START_MARKER = '/* @generated-tokens:start — regenerate with `pnpm tokens:write`; do not edit by hand */';
export const TOKENS_END_MARKER = '/* @generated-tokens:end */';

const px = (n: number): string => `${n / 16}rem`;

/** CSS custom-property name for each appearance token. */
const APPEARANCE_VARS: Array<[keyof AppearanceTokens, string]> = [
  ['background', '--background'],
  ['foreground', '--foreground'],
  ['card', '--card'],
  ['cardForeground', '--card-foreground'],
  ['popover', '--popover'],
  ['popoverForeground', '--popover-foreground'],
  ['raised', '--raised'],
  ['overlay', '--overlay'],
  ['subtle', '--subtle'],
  ['emphasis', '--emphasis'],
  ['primaryForeground', '--primary-foreground'],
  ['secondary', '--secondary'],
  ['secondaryForeground', '--secondary-foreground'],
  ['muted', '--muted'],
  ['mutedForeground', '--muted-foreground'],
  ['accentForeground', '--accent-foreground'],
  ['destructive', '--destructive'],
  ['destructiveForeground', '--destructive-foreground'],
  ['border', '--border'],
  ['borderMuted', '--border-muted'],
  ['input', '--input'],
  ['success', '--success'],
  ['successMuted', '--success-muted'],
  ['warning', '--warning'],
  ['warningMuted', '--warning-muted'],
  ['info', '--info'],
  ['infoMuted', '--info-muted'],
  ['danger', '--danger'],
  ['dangerMuted', '--danger-muted'],
  ['done', '--done'],
  ['sidebar', '--sidebar'],
  ['sidebarForeground', '--sidebar-foreground'],
  ['sidebarBorder', '--sidebar-border'],
  ['canvasBg', '--canvas-bg'],
  ['canvasDot', '--canvas-dot'],
];

/** Every token that ends up as a Tailwind colour utility in Layer 2. */
const THEME_COLOR_VARS = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'raised',
  'overlay',
  'subtle',
  'emphasis',
  'primary',
  'primary-emphasis',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'destructive-foreground',
  'border',
  'border-muted',
  'input',
  'ring',
  'success',
  'success-muted',
  'warning',
  'warning-muted',
  'info',
  'info-muted',
  'danger',
  'danger-muted',
  'done',
  'sidebar',
  'sidebar-foreground',
  'sidebar-border',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'canvas-bg',
  'canvas-dot',
] as const;

function appearanceBlock(appearance: Appearance, selector: string): string {
  const t = APPEARANCE_TOKENS[appearance];
  const a = resolveAccent(DEFAULT_ACCENT, appearance);
  const lines: string[] = [`${selector} {`, `  color-scheme: ${appearance};`, ''];

  if (appearance === 'dark') {
    lines.push(`  --font-sans: ${FONT_FAMILY.sans};`, `  --font-mono: ${FONT_FAMILY.mono};`, '');
  }

  lines.push('  /* Surfaces */');
  for (const key of ['background', 'foreground', 'card', 'cardForeground', 'popover', 'popoverForeground', 'raised', 'overlay', 'subtle', 'emphasis'] as const) {
    const varName = APPEARANCE_VARS.find(([k]) => k === key)?.[1];
    lines.push(`  ${varName}: ${t[key]};`);
  }

  lines.push('', `  /* Interactive — accent axis, default '${DEFAULT_ACCENT}' */`);
  lines.push(`  --primary: ${a.primary};`);
  lines.push(`  --primary-emphasis: ${a.primaryEmphasis};`);
  lines.push(`  --primary-foreground: ${t.primaryForeground};`);
  lines.push(`  --secondary: ${t.secondary};`);
  lines.push(`  --secondary-foreground: ${t.secondaryForeground};`);
  lines.push(`  --muted: ${t.muted};`);
  lines.push(`  --muted-foreground: ${t.mutedForeground};`);
  lines.push(`  --accent: ${a.accent};`);
  lines.push(`  --accent-foreground: ${t.accentForeground};`);
  lines.push(`  --destructive: ${t.destructive};`);
  lines.push(`  --destructive-foreground: ${t.destructiveForeground};`);

  lines.push('', '  /* Borders */');
  lines.push(`  --border: ${t.border};`);
  lines.push(`  --border-muted: ${t.borderMuted};`);
  lines.push(`  --input: ${t.input};`);
  lines.push(`  --ring: ${a.ring};`);

  lines.push('', '  /* Status — semantic, never accent-controlled */');
  for (const key of ['success', 'successMuted', 'warning', 'warningMuted', 'info', 'infoMuted', 'danger', 'dangerMuted', 'done'] as const) {
    const varName = APPEARANCE_VARS.find(([k]) => k === key)?.[1];
    lines.push(`  ${varName}: ${t[key]};`);
  }

  lines.push('', '  /* Sidebar */');
  lines.push(`  --sidebar: ${t.sidebar};`);
  lines.push(`  --sidebar-foreground: ${t.sidebarForeground};`);
  lines.push(`  --sidebar-border: ${t.sidebarBorder};`);
  lines.push(`  --sidebar-accent: ${a.sidebarAccent};`);
  lines.push(`  --sidebar-accent-foreground: ${a.sidebarAccentForeground};`);

  lines.push('', '  /* Canvas (React Flow) */');
  lines.push(`  --canvas-bg: ${t.canvasBg};`);
  lines.push(`  --canvas-dot: ${t.canvasDot};`);

  lines.push('', '  /* File-type icon palette (mirrors @pierre/trees) */');
  for (const [name, pair] of Object.entries(FILE_ICON_COLORS)) {
    lines.push(`  --file-icon-${name}: ${pair[appearance]};`);
  }

  if (appearance === 'dark') {
    lines.push('', '  /* Radius — compact */');
    lines.push(`  --radius: ${px(RADIUS.DEFAULT)};`);
    lines.push(`  --radius-lg: ${px(RADIUS.lg)};`);
    lines.push(`  --radius-xl: ${px(RADIUS.xl)};`);
  }

  lines.push('}');
  return lines.join('\n');
}

function accentBlock(accentId: string, appearance: Appearance): string {
  const selector =
    appearance === 'dark' ? `[data-accent="${accentId}"]` : `.light[data-accent="${accentId}"]`;
  const a = resolveAccent(accentId, appearance);
  return [
    `${selector} {`,
    `  --primary: ${a.primary};`,
    `  --primary-emphasis: ${a.primaryEmphasis};`,
    `  --ring: ${a.ring};`,
    `  --accent: ${a.accent};`,
    `  --sidebar-accent: ${a.sidebarAccent};`,
    `  --sidebar-accent-foreground: ${a.sidebarAccentForeground};`,
    '}',
  ].join('\n');
}

function themeInlineBlock(): string {
  const lines = ['@theme inline {'];
  for (const name of THEME_COLOR_VARS) {
    lines.push(`  --color-${name}: var(--${name});`);
  }
  lines.push('}');
  return lines.join('\n');
}

function compatAliasBlock(): string {
  const lines = [':root {'];
  for (const name of THEME_COLOR_VARS) {
    lines.push(`  --color-${name}: var(--${name});`);
  }
  lines.push('}');
  return lines.join('\n');
}

/** The full generated CSS body (without the surrounding markers). */
export function emitCss(): string {
  const sections: string[] = [];

  sections.push(
    [
      '/* ══════════════════════════════════════════════════════════════',
      '   Layer 1 — raw semantic values.',
      '   Components never read these directly; they use the Tailwind',
      '   utilities produced by Layer 2.',
      '   ══════════════════════════════════════════════════════════════ */',
    ].join('\n'),
  );
  sections.push(appearanceBlock('dark', ':root'));
  sections.push(appearanceBlock('light', '.light'));

  sections.push(
    [
      '/* ── Accent axis (orthogonal to appearance) ──',
      '   Each accent overrides ONLY interactive tokens. Surfaces, text and',
      '   status colours are untouched: "danger" must look like danger no',
      "   matter what the user's accent preference is. */",
    ].join('\n'),
  );
  for (const accent of ACCENTS) {
    if (accent.id === DEFAULT_ACCENT) continue; // already inlined in Layer 1
    sections.push(accentBlock(accent.id, 'dark'));
    sections.push(accentBlock(accent.id, 'light'));
  }

  sections.push(
    [
      '/* ══════════════════════════════════════════════════════════════',
      '   Layer 2 — Tailwind utility bridge. Makes `bg-background`,',
      '   `text-muted-foreground`, `bg-success-muted`, `ring-ring`… real',
      '   utilities that follow the active theme + accent.',
      '   ══════════════════════════════════════════════════════════════ */',
    ].join('\n'),
  );
  sections.push(themeInlineBlock());

  sections.push(
    [
      '/* ══════════════════════════════════════════════════════════════',
      '   Layer 3 — compat aliases. Keeps every pre-existing',
      '   `var(--color-*)` arbitrary value resolving, dynamically, so',
      '   theme/accent switches still apply. New code should use Layer 2.',
      '   ══════════════════════════════════════════════════════════════ */',
    ].join('\n'),
  );
  sections.push(compatAliasBlock());

  return sections.join('\n\n');
}

/** Splice the generated body into an existing file between the markers. */
export function spliceCss(existing: string, generated: string): string {
  const start = existing.indexOf(TOKENS_START_MARKER);
  const end = existing.indexOf(TOKENS_END_MARKER);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      'globals.css is missing the @generated-tokens markers. ' +
        'Add them around the token layers before running the generator.',
    );
  }
  const head = existing.slice(0, start + TOKENS_START_MARKER.length);
  const tail = existing.slice(end);
  return `${head}\n\n${generated}\n\n${tail}`;
}
