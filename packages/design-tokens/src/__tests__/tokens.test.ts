import { describe, expect, it } from 'vitest';

import { contrastRatio, flatten, parseHex, relativeLuminance, toHex, withAlpha } from '../color.js';
import {
  ACCENTS,
  APPEARANCE_TOKENS,
  DEFAULT_ACCENT,
  FILE_ICON_COLORS,
  getAccent,
  resolveAccent,
  type Appearance,
} from '../tokens.js';

const APPEARANCES: Appearance[] = ['dark', 'light'];

/**
 * File-type icons whose light/dark pair is inverted relative to every other
 * entry in the palette.
 *
 * The only entry is `vermilion`, and the inversion lives in @pierre/trees
 * itself — see the note on FILE_ICON_COLORS for why we mirror it rather than
 * diverge from the component we are colour-matching.
 *
 * A companion test asserts each waiver still violates the invariant, so an
 * exemption cannot outlive the defect it was written for.
 */
const FILE_ICON_ORIENTATION_WAIVERS = new Set(['vermilion']);

describe('colour utilities', () => {
  it('parses every hex form', () => {
    expect(parseHex('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseHex('#0d1117')).toEqual({ r: 13, g: 17, b: 23, a: 1 });
    // 8-digit form is how the status tints are authored.
    expect(parseHex('#23863626')).toMatchObject({ r: 35, g: 134, b: 54 });
    expect(parseHex('#23863626').a).toBeCloseTo(0x26 / 255, 5);
  });

  it('rejects malformed input rather than guessing', () => {
    expect(() => parseHex('0d1117')).toThrow();
    expect(() => parseHex('#12345')).toThrow();
    expect(() => parseHex('rebeccapurple')).toThrow();
  });

  it('round-trips hex through parse/serialize', () => {
    for (const hex of ['#0d1117', '#e6edf3', '#23863626']) {
      expect(toHex(parseHex(hex))).toBe(hex);
    }
  });

  it('withAlpha matches CSS color-mix against transparent', () => {
    // color-mix(in srgb, #1f6feb 20%, transparent) === #1f6feb at a=0.2
    expect(toHex(withAlpha('#1f6feb', 20))).toBe('#1f6feb33');
    expect(withAlpha('#1f6feb', 20).a).toBeCloseTo(0.2, 5);
    // Compounding: alpha multiplies, it does not replace.
    expect(withAlpha(withAlpha('#ffffff', 50), 50).a).toBeCloseTo(0.25, 5);
  });

  it('computes known WCAG contrast ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    // Order must not matter.
    expect(contrastRatio('#1f6feb', '#ffffff')).toBeCloseTo(
      contrastRatio('#ffffff', '#1f6feb'),
      10,
    );
  });

  it('refuses to compute contrast against a translucent colour', () => {
    // Silently compositing against an assumed backdrop is how palettes end
    // up "accessible" everywhere except where it matters.
    expect(() => contrastRatio('#ffffff', '#23863626')).toThrow(/opaque/);
  });
});

describe('accent resolution', () => {
  it('exposes six accents with a stable default', () => {
    expect(ACCENTS).toHaveLength(6);
    expect(getAccent(DEFAULT_ACCENT)).toBeDefined();
    expect(new Set(ACCENTS.map((a) => a.id)).size).toBe(ACCENTS.length);
  });

  it('falls back to the default accent instead of throwing', () => {
    expect(resolveAccent('does-not-exist', 'dark')).toEqual(resolveAccent(DEFAULT_ACCENT, 'dark'));
  });

  it('keeps ring and sidebar-accent-foreground pinned to primary', () => {
    // These two held for every accent in the hand-written CSS. Encoding them
    // in resolveAccent() is what stops them drifting one accent at a time.
    for (const accent of ACCENTS) {
      for (const appearance of APPEARANCES) {
        const t = resolveAccent(accent.id, appearance);
        expect(t.ring).toBe(t.primary);
        expect(t.sidebarAccentForeground).toBe(t.primary);
      }
    }
  });

  it('derives tints from emphasis on dark and primary on light', () => {
    const dark = resolveAccent('blue', 'dark');
    expect(dark.accent.slice(0, 7)).toBe(dark.primaryEmphasis);
    const light = resolveAccent('blue', 'light');
    expect(light.accent.slice(0, 7)).toBe(light.primary);
  });
});

describe('WCAG AA compliance', () => {
  // The whole reason `primaryEmphasis` exists separately from `primary` is
  // that white-on-primary fails AA for most accents. If this test ever goes
  // red, a filled button somewhere became unreadable.
  it('filled buttons clear 4.5:1 for every accent × appearance', () => {
    for (const accent of ACCENTS) {
      for (const appearance of APPEARANCES) {
        const { primaryEmphasis } = resolveAccent(accent.id, appearance);
        const fg = APPEARANCE_TOKENS[appearance].primaryForeground;
        const ratio = contrastRatio(fg, primaryEmphasis);
        expect(
          ratio,
          `${accent.id}/${appearance}: ${fg} on ${primaryEmphasis} = ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('body text clears 4.5:1 on every surface', () => {
    for (const appearance of APPEARANCES) {
      const t = APPEARANCE_TOKENS[appearance];
      for (const surface of [t.background, t.card, t.popover, t.raised, t.subtle] as const) {
        const ratio = contrastRatio(t.foreground, surface);
        expect(ratio, `${appearance}: foreground on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('muted text clears the 4.5:1 body threshold on background and card', () => {
    // Muted text is used for real content (timestamps, counts, paths), not
    // decoration, so it is held to the body-text bar rather than 3:1.
    for (const appearance of APPEARANCES) {
      const t = APPEARANCE_TOKENS[appearance];
      for (const surface of [t.background, t.card] as const) {
        const ratio = contrastRatio(t.mutedForeground, surface);
        expect(ratio, `${appearance}: muted-foreground on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('status colours clear 3:1 against the base background', () => {
    // Status colours are carriers of meaning on icons/badges (non-text
    // contrast), so 3:1 is the applicable threshold.
    for (const appearance of APPEARANCES) {
      const t = APPEARANCE_TOKENS[appearance];
      for (const key of ['success', 'warning', 'info', 'danger', 'done'] as const) {
        const ratio = contrastRatio(t[key], t.background);
        expect(ratio, `${appearance}: ${key} on background`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('accent primary stays readable as link text', () => {
    for (const accent of ACCENTS) {
      for (const appearance of APPEARANCES) {
        const { primary } = resolveAccent(accent.id, appearance);
        const ratio = contrastRatio(primary, APPEARANCE_TOKENS[appearance].background);
        expect(ratio, `${accent.id}/${appearance}: primary on background`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('file-icon colours stay visible against the tree background', () => {
    // File-type icons sit next to a filename that already carries the
    // meaning, so WCAG 1.4.11's 3:1 does not apply. The bar here is only
    // "perceptible": the palette's own floor is ~2.2:1 (yellow on white,
    // which is about as dark as yellow gets before it reads as brown).
    for (const appearance of APPEARANCES) {
      const bg = APPEARANCE_TOKENS[appearance].background;
      for (const [name, pair] of Object.entries(FILE_ICON_COLORS)) {
        const ratio = contrastRatio(pair[appearance], bg);
        expect(ratio, `${appearance}: file-icon-${name}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('file-icon pairs are darker on light and lighter on dark', () => {
    // This is the palette's actual structural rule, and it is a far sharper
    // instrument than a contrast floor: an inverted pair is invisible on one
    // theme and garish on the other, but can still clear any single ratio.
    for (const [name, pair] of Object.entries(FILE_ICON_COLORS)) {
      if (FILE_ICON_ORIENTATION_WAIVERS.has(name)) continue;
      const lightLum = relativeLuminance(parseHex(pair.light));
      const darkLum = relativeLuminance(parseHex(pair.dark));
      expect(lightLum, `file-icon-${name}: light variant must be the darker one`).toBeLessThan(
        darkLum,
      );
    }
  });

  it('has no stale file-icon orientation waivers', () => {
    for (const name of FILE_ICON_ORIENTATION_WAIVERS) {
      const pair = FILE_ICON_COLORS[name as keyof typeof FILE_ICON_COLORS];
      const lightLum = relativeLuminance(parseHex(pair.light));
      const darkLum = relativeLuminance(parseHex(pair.dark));
      expect(
        lightLum,
        `waiver "${name}" no longer violates the invariant — remove it`,
      ).toBeGreaterThan(darkLum);
    }
  });

  it('selection tints stay subtle enough to read text through', () => {
    // A row tint that swallows its own label is worse than no tint.
    for (const accent of ACCENTS) {
      for (const appearance of APPEARANCES) {
        const t = APPEARANCE_TOKENS[appearance];
        const { accent: tint } = resolveAccent(accent.id, appearance);
        const composited = flatten(tint, t.background);
        const ratio = contrastRatio(t.foreground, composited);
        expect(
          ratio,
          `${accent.id}/${appearance}: foreground on accent tint`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
