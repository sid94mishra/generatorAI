// ────────────────────────────────────────────────────────────────
// Emitter tests.
//
// `tokens.test.ts` proves the token DATA is correct. This file proves the
// generated CSS actually delivers it, which is a separate failure mode: a
// palette can be flawless and still never reach the page because its selector
// was misspelled, omitted, or emitted in an order that loses a specificity
// tie.
//
// The specificity assertions matter most. Three axes compose on one element
// with no JavaScript beyond two attribute writes, and two of the rungs tie at
// (0,2,0) — they are resolved purely by source order. That is invisible in
// review and produces a bug ("light mode shows dark accents") that only
// appears for users who changed two settings. So the order is asserted here
// rather than trusted to the comment above it.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';

import { DESIGN_ACCENT_KEYS, DESIGN_COLOR_VARS } from '../design.js';
import { DESIGN_LAYER_HEADER, emitCss, spliceCss, TOKENS_END_MARKER, TOKENS_START_MARKER } from '../emit/css.js';
import { emitNative } from '../emit/native.js';
import { emitVocabularyCss, emitVocabularyJson, vocabularyJson } from '../emit/vocabulary.js';
import { ACCENT_IDS, DEFAULT_THEME, THEMES } from '../themes/index.js';
import {
  COLOR_NAMES,
  LEGACY_COLOR_NAMES,
  LEGACY_UTILITY_NAMES,
  REQUIRED_UTILITIES,
  SHARED_COLOR_NAMES,
  TEXT_COLOR_OVERRIDES,
} from '../vocabulary.js';

const css = emitCss();

/** Index of a selector in the emitted stylesheet, or -1. */
const at = (selector: string): number => css.indexOf(`${selector} {`);

describe('web CSS emitter', () => {
  it('emits a dark and a light block for every non-default theme', () => {
    for (const theme of THEMES) {
      if (theme.id === DEFAULT_THEME) continue;
      expect(at(`[data-theme="${theme.id}"]`), `${theme.id} dark block`).toBeGreaterThan(-1);
      expect(at(`.light[data-theme="${theme.id}"]`), `${theme.id} light block`).toBeGreaterThan(-1);
    }
  });

  it('emits the default theme into :root and .light so a bare page is themed', () => {
    // Without this, the app renders unstyled until the provider hydrates.
    expect(at(':root')).toBeGreaterThan(-1);
    expect(at('.light')).toBeGreaterThan(-1);
  });

  it('scopes every accent block to its theme', () => {
    // An unscoped `[data-accent="violet"]` would give a Catppuccin user
    // GitHub's violet — the exact bug the theme axis exists to prevent.
    for (const theme of THEMES) {
      for (const accentId of ACCENT_IDS) {
        if (accentId === theme.defaultAccent) continue;
        const base = `[data-theme="${theme.id}"][data-accent="${accentId}"]`;
        expect(at(base), `${theme.id}/${accentId} dark`).toBeGreaterThan(-1);
        expect(at(`.light${base}`), `${theme.id}/${accentId} light`).toBeGreaterThan(-1);
      }
    }
  });

  it('never emits an accent selector that is not theme-scoped', () => {
    const unscoped = css.match(/^\[data-accent="[^"]+"\]|^\.light\[data-accent="[^"]+"\]/gm);
    expect(unscoped).toBeNull();
  });

  it('orders the specificity ladder so later rungs win their ties', () => {
    // `.light[data-theme=x]` and `[data-theme=x][data-accent=a]` are BOTH
    // (0,2,0). Source order is the only tie-breaker, so a theme's light block
    // must precede its accent blocks, and the light accent block — which is
    // (0,3,0) and outranks everything — comes last.
    for (const theme of THEMES) {
      if (theme.id === DEFAULT_THEME) continue;
      const darkTheme = at(`[data-theme="${theme.id}"]`);
      const lightTheme = at(`.light[data-theme="${theme.id}"]`);
      expect(darkTheme, `${theme.id}: dark block must precede light`).toBeLessThan(lightTheme);

      const accentId = ACCENT_IDS.find((a) => a !== theme.defaultAccent)!;
      const base = `[data-theme="${theme.id}"][data-accent="${accentId}"]`;
      expect(
        lightTheme,
        `${theme.id}: light theme block must precede its accent blocks`,
      ).toBeLessThan(at(base));
      expect(at(base), `${theme.id}: light accent must come last`).toBeLessThan(at(`.light${base}`));
    }
  });

  it('emits the tokens every consumer reads', () => {
    // A token that exists in TS but never reaches CSS fails silently: the
    // component just renders the inherited colour.
    for (const name of [
      '--background',
      '--foreground',
      '--primary-emphasis',
      '--muted-foreground',
      '--success',
      '--danger',
      '--sidebar-accent',
      '--canvas-dot',
      '--chart-1',
      '--chart-6',
      '--syntax-keyword',
      '--syntax-comment',
      '--font-sans',
      '--font-mono',
      '--radius',
      '--gai-ground',
      '--gai-fg-3',
    ]) {
      expect(css, `${name} missing`).toContain(`${name}:`);
    }
  });

  it('bridges every colour token into a Tailwind utility', () => {
    // Layer 2 is what makes `bg-card` real; a token missing here is usable
    // only through an arbitrary value, which is what we are migrating away from.
    for (const name of ['background', 'card', 'muted-foreground', 'success-muted', 'chart-3']) {
      expect(css, `--color-${name} not bridged`).toContain(`--color-${name}: var(--${name});`);
    }
  });

  it('renames the legacy bridges that collide with the design vocabulary (02 §3)', () => {
    // The selection tint is `accent-tint`; `accent`, `surface`, `raised` and
    // `overlay` belong to the design layer, so the legacy layer must not claim them.
    expect(css).toContain('--color-accent-tint: var(--accent);');
    for (const name of ['accent', 'accent-foreground', 'surface', 'surface-hover', 'raised', 'overlay']) {
      expect(css, `--color-${name} still bridged to the legacy value`).not.toContain(`--color-${name}: var(--${name});`);
    }
  });

  it('drives highlight.js from syntax tokens rather than a bundled palette', () => {
    expect(css).toContain('.hljs-keyword');
    expect(css).toContain('color: var(--syntax-keyword);');
    // A literal hex inside the syntax rules would mean one theme's colours
    // leaked into all of them.
    const syntaxBlock = css.slice(css.indexOf('.hljs {'));
    expect(syntaxBlock).not.toMatch(/#[0-9a-f]{6}/i);
  });

  it('gives every theme its own type stack and radius scale', () => {
    for (const theme of THEMES) {
      const block = css.slice(at(`[data-theme="${theme.id}"]`));
      expect(block, `${theme.id} fonts`).toContain('--font-sans:');
      expect(block, `${theme.id} radius`).toContain('--radius:');
    }
  });
});

describe('design layer (L1b)', () => {
  const start = css.indexOf(DESIGN_LAYER_HEADER);
  const end = css.indexOf('Layer 2 — Tailwind utility bridge');
  const l1b = css.slice(start, end);
  const inL1b = (selector: string): number => l1b.indexOf(`\n${selector} {`);
  const block = (selector: string): string => {
    const i = inL1b(selector);
    return i === -1 ? '' : l1b.slice(i, l1b.indexOf('}', i));
  };

  it('is its own section after Layer 1 and before the bridge', () => {
    expect(start).toBeGreaterThan(css.indexOf('/* ── Accent axis'));
    expect(end).toBeGreaterThan(start);
  });

  it('defines every design colour in :root, .light and every theme block', () => {
    const selectors = [':root', '.light', ...THEMES.flatMap((t) => [`[data-theme="${t.id}"]`, `.light[data-theme="${t.id}"]`])];
    for (const selector of selectors) {
      const body = block(selector);
      expect(body, `${selector} missing from L1b`).not.toBe('');
      for (const [, name] of DESIGN_COLOR_VARS) expect(body, `${selector} ${name}`).toContain(`  ${name}: `);
    }
  });

  it('orders the ladder per theme: dark < light < accent dark < accent light', () => {
    for (const theme of THEMES) {
      const accentId = ACCENT_IDS.find((a) => a !== theme.defaultAccent)!;
      const base = `[data-theme="${theme.id}"][data-accent="${accentId}"]`;
      const order = [`[data-theme="${theme.id}"]`, `.light[data-theme="${theme.id}"]`, base, `.light${base}`].map(inL1b);
      for (const i of order) expect(i, theme.id).toBeGreaterThan(-1);
      expect([...order].sort((a, b) => a - b), `${theme.id}: ${order.join(' < ')}`).toEqual(order);
      // The light theme block must also precede every theme's accent blocks
      // (same (0,2,0) specificity as an accent block, resolved by source order).
      expect(inL1b(`.light[data-theme="${theme.id}"]`)).toBeLessThan(inL1b(`[data-theme="${THEMES[0]!.id}"][data-accent="${ACCENT_IDS.find((a) => a !== THEMES[0]!.defaultAccent)}"]`));
    }
  });

  it('accent blocks set only accent, on-accent and focus, and are always theme-scoped', () => {
    const names = DESIGN_ACCENT_KEYS.map((k) => DESIGN_COLOR_VARS.find(([key]) => key === k)![1]);
    for (const theme of THEMES) {
      for (const accentId of ACCENT_IDS) {
        if (accentId === theme.defaultAccent) continue;
        const body = block(`[data-theme="${theme.id}"][data-accent="${accentId}"]`);
        const declared = [...body.matchAll(/(--gai-[\w-]+):/g)].map((m) => m[1]);
        expect(declared, `${theme.id}/${accentId}`).toEqual(names);
      }
    }
    expect(l1b.match(/^(?:\.light)?\[data-accent=/gm)).toBeNull();
  });

  it('emits legacy ink accent blocks for all 17 themes whose default is not ink', () => {
    const others = THEMES.filter((t) => t.defaultAccent !== 'ink');
    expect(others).toHaveLength(17);
    for (const theme of others) expect(at(`[data-theme="${theme.id}"][data-accent="ink"]`), theme.id).toBeGreaterThan(-1);
  });

  it('bridges only legacy names in Layer 2; the shared tokens move to vocabulary.css', () => {
    const bridge = css.slice(css.indexOf('@theme inline {'), css.indexOf('}', css.indexOf('@theme inline {')));
    for (const name of LEGACY_COLOR_NAMES) expect(bridge).toContain(`--color-${name}: var(--`);
    for (const name of [...SHARED_COLOR_NAMES, ...COLOR_NAMES]) expect(bridge).not.toContain(`--color-${name}:`);
  });

  it('safelists the required design utilities for the CSS-emission check', () => {
    expect(css).toContain(`@source inline("${REQUIRED_UTILITIES.join(' ')}");`);
  });
});

describe('shared class vocabulary', () => {
  const vocab = emitVocabularyCss();

  it('maps every design colour name to its --gai-* variable', () => {
    for (const name of COLOR_NAMES) expect(vocab).toContain(`  --color-${name}: var(--gai-${name});`);
    for (const [name, variable] of Object.entries(TEXT_COLOR_OVERRIDES)) {
      expect(vocab).toContain(`  --text-color-${name}: var(--gai-${variable});`);
    }
    expect(vocab).toContain('  --shadow-pop: var(--gai-shadow-pop);');
    for (const name of SHARED_COLOR_NAMES) expect(vocab).toContain(`  --color-${name}: var(--${name});`);
  });

  it('holds names only, no values, so each platform supplies its own (D-40)', () => {
    expect(vocab).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(vocab).toContain('GENERATED');
  });

  it('has a design variable behind every colour name', () => {
    const vars = new Set(DESIGN_COLOR_VARS.map(([, n]) => n));
    for (const [, v] of vocab.matchAll(/var\((--gai-[\w-]+)\)/g)) expect(vars.has(v!), v).toBe(true);
  });

  it('exports the lists Node tools read, identical to the TS source', () => {
    const json = JSON.parse(emitVocabularyJson());
    expect(json).toEqual(JSON.parse(JSON.stringify(vocabularyJson())));
    expect(json.requiredUtilities).toEqual([...REQUIRED_UTILITIES]);
    expect(json.legacyUtilityNames).toEqual([...LEGACY_UTILITY_NAMES]);
  });

  it('keeps legacy and design names disjoint', () => {
    const design = new Set<string>([...COLOR_NAMES, ...SHARED_COLOR_NAMES]);
    for (const name of LEGACY_UTILITY_NAMES) expect(design.has(name), name).toBe(false);
  });
});

describe('splice', () => {
  it('replaces only the region between the markers', () => {
    const file = `HEAD\n${TOKENS_START_MARKER}\nold\n${TOKENS_END_MARKER}\nTAIL`;
    const out = spliceCss(file, 'new');
    expect(out.startsWith('HEAD')).toBe(true);
    expect(out.endsWith('TAIL')).toBe(true);
    expect(out).toContain('new');
    expect(out).not.toContain('old');
  });

  it('refuses to guess when the markers are missing', () => {
    // Silently appending would corrupt the hand-written base styles below.
    expect(() => spliceCss('no markers here', 'new')).toThrow(/markers/);
  });
});

describe('native emitter', () => {
  const native = emitNative();

  it('exports one variable bag per theme × appearance × accent', () => {
    for (const theme of THEMES) {
      expect(native, `${theme.id} missing from mobile bundle`).toContain(`"${theme.id}"`);
    }
    // Mobile resolves `var()` at style time but needs literals for Skia and
    // the status bar, so the values must be concrete.
    expect(native).toContain('"--background"');
    expect(native).toContain('"--chart-1"');
    // The design layer ships as literals too (M-01), but gets no NativeWind
    // utilities in P1.
    expect(native).toContain('"--gai-ground"');
    const tailwind = native.slice(native.indexOf('export const tailwindColors'), native.indexOf('/** Design-layer colour names'));
    expect(tailwind).not.toContain('gai-');
    expect(native).toContain('export const gaiColors');
    expect(native).toContain('export const accentIds');
  });

  it('ships terminal palettes and picker metadata', () => {
    expect(native).toContain('terminalThemes');
    expect(native).toContain('themeMeta');
    expect(native).toContain('brightMagenta');
  });

  it('is marked generated so an edit is caught rather than absorbed', () => {
    expect(native).toContain('GENERATED FILE — do not edit');
  });
});
