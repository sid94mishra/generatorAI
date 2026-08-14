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

import { emitCss, spliceCss, TOKENS_END_MARKER, TOKENS_START_MARKER } from '../emit/css.js';
import { emitNative } from '../emit/native.js';
import { ACCENT_IDS, DEFAULT_THEME, THEMES } from '../themes/index.js';

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
