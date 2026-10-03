// M10-04 contrast audit over the mobile palettes (MD-28, MD-195): every theme × appearance × accent the app can paint.
// Text tones (fg, fg-2, fg-3 and the status text tones) need 4.5:1 on every surface they are drawn on; status glyph
// tones (non-text, always beside a word) 3:1; the accent's on-accent label 4.5:1 for all seven accents.
import { describe, expect, it } from 'vitest';
import { THEMES, buildNativePalette, contrastRatio, type DesignTokens } from '@generatorai/design-tokens';

const SURFACES = ['ground', 'surface', 'raised', 'sunken', 'overlay'] as const satisfies readonly (keyof DesignTokens)[];
const TEXT = ['fg', 'fg2', 'fg3', 'runText', 'okText', 'warnText', 'errText'] as const satisfies readonly (keyof DesignTokens)[];
const GLYPHS = ['run', 'ok', 'warn', 'err'] as const satisfies readonly (keyof DesignTokens)[];

describe('mobile palette contrast (all themes × modes × accents)', () => {
  const failures: string[] = [];
  for (const theme of THEMES) {
    const palette = buildNativePalette(theme);
    for (const mode of ['dark', 'light'] as const) {
      const t = palette[mode].tokens;
      for (const bg of SURFACES) {
        for (const fg of TEXT) {
          const ratio = contrastRatio(t[fg], t[bg]);
          if (ratio < 4.5) failures.push(`${theme.id}-${mode} text ${fg} on ${bg}: ${ratio.toFixed(2)}`);
        }
        for (const fg of GLYPHS) {
          const ratio = contrastRatio(t[fg], t[bg]);
          if (ratio < 3) failures.push(`${theme.id}-${mode} glyph ${fg} on ${bg}: ${ratio.toFixed(2)}`);
        }
      }
      for (const [id, accent] of Object.entries(palette.accents[mode])) {
        const ratio = contrastRatio(accent.onAccent, accent.accent);
        if (ratio < 4.5) failures.push(`${theme.id}-${mode} on-accent on ${id}: ${ratio.toFixed(2)}`);
      }
    }
  }
  it(`covers ${THEMES.length} themes × 2 modes`, () => {
    expect(THEMES.length).toBe(18);
  });
  it('has no pair under its threshold', () => {
    expect(failures).toEqual([]);
  });
});
