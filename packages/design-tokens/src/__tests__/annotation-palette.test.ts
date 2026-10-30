import { describe, expect, it } from 'vitest';
import { annotationPalette, type AnnotationPalette } from '../annotation-palette.js';
import { contrastRatio, parseHex, toHex } from '../color.js';
import { resolveDesignTokens } from '../design.js';
import { DEFAULT_ACCENT } from '../registry.js';
import { DEFAULT_THEME, THEMES } from '../themes/index.js';
import type { Appearance } from '../themes/types.js';

const HEX6 = /^#[0-9a-f]{6}$/i;
// Same patterns desktop main enforces before the palette reaches executeJavaScript.
const RGBA = /^rgba\(\d{1,3},\d{1,3},\d{1,3},(0|1|0?\.\d+)\)$/;
const APPEARANCES: Appearance[] = ['dark', 'light'];
const opaque6 = (c: string): string => toHex({ ...parseHex(c), a: 1 });

describe('annotationPalette (06 §4.4)', () => {
  for (const theme of THEMES) {
    for (const appearance of APPEARANCES) {
      describe(`${theme.id} ${appearance}`, () => {
        const palette = annotationPalette(theme.id, appearance);
        const tokens = resolveDesignTokens(theme, appearance, DEFAULT_ACCENT);

        it('returns #rrggbb for every colour and a compact rgba() shadow', () => {
          const { shadow, ...colours } = palette;
          for (const [key, value] of Object.entries(colours)) {
            expect(value, key).toMatch(HEX6);
          }
          expect(shadow).toMatch(RGBA);
        });

        it('marks the page with the theme run colour, not the accent', () => {
          expect(palette.accent).toBe(opaque6(tokens.run));
          expect(palette.done).toBe(opaque6(tokens.ok));
        });

        it('keeps the button label readable on the accent', () => {
          // Large/bold UI text: at least the non-text bar, and never worse
          // than any of the theme's candidate text colours.
          expect(contrastRatio(palette.onAccent, palette.accent)).toBeGreaterThanOrEqual(3);
          for (const candidate of [tokens.fg, tokens.ground]) {
            expect(contrastRatio(palette.onAccent, palette.accent)).toBeGreaterThanOrEqual(
              contrastRatio(opaque6(candidate), palette.accent) - 1e-9,
            );
          }
        });
      });
    }
  }

  it('falls back to the default theme for an unknown id', () => {
    const expected: AnnotationPalette = annotationPalette(DEFAULT_THEME, 'dark');
    expect(annotationPalette('no-such-theme', 'dark')).toEqual(expected);
  });

  it('differs between dark and light', () => {
    expect(annotationPalette(DEFAULT_THEME, 'dark')).not.toEqual(annotationPalette(DEFAULT_THEME, 'light'));
  });
});
