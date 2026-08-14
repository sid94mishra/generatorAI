import { describe, expect, it } from 'vitest';

import {
  contrastRatio,
  ensureContrast,
  flatten,
  mix,
  parseHex,
  relativeLuminance,
  toHex,
  withAlpha,
} from '../color.js';
import { FILE_ICON_COLORS } from '../tokens.js';
import {
  ACCENT_IDS,
  DEFAULT_THEME,
  THEMES,
  resolveAccentTokens,
  resolveAppearanceTokens,
  resolveChartRamp,
  resolveSyntaxTokens,
  resolveTerminalPalette,
  themeAccents,
  type Appearance,
} from '../themes/index.js';
import { DEFAULT_MODE, MODES, resolveAppearance } from '../registry.js';

const APPEARANCES: Appearance[] = ['dark', 'light'];

/**
 * Every (theme, appearance) pair, pre-expanded so each assertion below reads
 * as a single loop instead of a nested one. The label is what shows up in a
 * failure, and it is the only thing that makes a red build actionable when
 * twelve palettes are under test.
 */
const MATRIX = THEMES.flatMap((theme) =>
  APPEARANCES.map((appearance) => ({
    theme,
    appearance,
    label: `${theme.id}/${appearance}`,
    tokens: resolveAppearanceTokens(theme, appearance),
  })),
);

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

  it('mix interpolates linearly and clamps its input', () => {
    expect(toHex(mix('#000000', '#ffffff', 0.5))).toBe('#808080');
    expect(toHex(mix('#000000', '#ffffff', 2))).toBe('#ffffff');
    expect(toHex(mix('#000000', '#ffffff', -1))).toBe('#000000');
  });
});

describe('ensureContrast', () => {
  it('leaves a colour that already clears the bar untouched', () => {
    // Otherwise every hand-authored palette would be silently re-graded.
    expect(toHex(ensureContrast('#1f6feb', '#ffffff', 4.5))).toBe('#1f6feb');
  });

  it('darkens under light text and lightens under dark text', () => {
    const underWhite = ensureContrast('#7aa2f7', '#ffffff', 4.5);
    const underBlack = ensureContrast('#31748f', '#000000', 4.5);
    expect(relativeLuminance(underWhite)).toBeLessThan(relativeLuminance(parseHex('#7aa2f7')));
    expect(relativeLuminance(underBlack)).toBeGreaterThan(relativeLuminance(parseHex('#31748f')));
  });

  it('always reaches the requested ratio', () => {
    for (const hue of ['#f7768e', '#9ece6a', '#e0af68', '#88c0d0', '#c4a7e7']) {
      for (const on of ['#ffffff', '#000000', '#11111b']) {
        expect(contrastRatio(ensureContrast(hue, on, 4.5), on)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('theme registry', () => {
  it('ships a stable default that exists', () => {
    expect(THEMES.some((t) => t.id === DEFAULT_THEME)).toBe(true);
    expect(MODES.some((m) => m.id === DEFAULT_MODE)).toBe(true);
  });

  it('has unique theme ids and a light + dark variant for every one', () => {
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
    for (const theme of THEMES) {
      expect(theme.dark, `${theme.id} is missing its dark variant`).toBeDefined();
      expect(theme.light, `${theme.id} is missing its light variant`).toBeDefined();
    }
  });

  it('exposes the same six accents on every theme', () => {
    for (const theme of THEMES) {
      const accents = themeAccents(theme);
      expect(accents.map((a) => a.id), theme.id).toEqual([...ACCENT_IDS]);
      expect(ACCENT_IDS, `${theme.id} default accent`).toContain(theme.defaultAccent);
    }
  });

  it('resolves system mode from the OS preference', () => {
    expect(resolveAppearance('system', true)).toBe('dark');
    expect(resolveAppearance('system', false)).toBe('light');
    expect(resolveAppearance('light', true)).toBe('light');
    // Unknown ids behave as `system` rather than throwing at paint time.
    expect(resolveAppearance('nonsense', true)).toBe('dark');
  });

  it('keeps ring and sidebar-accent-foreground pinned to primary', () => {
    // Encoding these in resolveAccentTokens() is what stops them drifting one
    // accent at a time across six themes.
    for (const theme of THEMES) {
      for (const appearance of APPEARANCES) {
        for (const accentId of ACCENT_IDS) {
          const t = resolveAccentTokens(theme, accentId, appearance);
          expect(t.ring).toBe(t.primary);
          expect(t.sidebarAccentForeground).toBe(t.primary);
        }
      }
    }
  });

  it('derives tints from emphasis on dark and primary on light', () => {
    for (const theme of THEMES) {
      const dark = resolveAccentTokens(theme, theme.defaultAccent, 'dark');
      expect(dark.accent.slice(0, 7), theme.id).toBe(dark.primaryEmphasis);
      const light = resolveAccentTokens(theme, theme.defaultAccent, 'light');
      expect(light.accent.slice(0, 7), theme.id).toBe(light.primary);
    }
  });
});

describe('WCAG AA compliance — every theme × appearance', () => {
  // The whole reason `primaryEmphasis` exists separately from `primary` is
  // that text-on-primary fails AA for most hues. If this test ever goes red,
  // a filled button somewhere became unreadable.
  it('filled buttons clear 4.5:1 for every accent', () => {
    for (const { theme, appearance, label, tokens } of MATRIX) {
      for (const accentId of ACCENT_IDS) {
        const { primaryEmphasis } = resolveAccentTokens(theme, accentId, appearance);
        const fg = tokens.primaryForeground;
        const ratio = contrastRatio(fg, primaryEmphasis);
        expect(
          ratio,
          `${label}/${accentId}: ${fg} on ${primaryEmphasis} = ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('body text clears 4.5:1 on every surface', () => {
    for (const { label, tokens: t } of MATRIX) {
      for (const surface of [t.background, t.card, t.popover, t.raised, t.subtle] as const) {
        const ratio = contrastRatio(t.foreground, surface);
        expect(
          ratio,
          `${label}: foreground ${t.foreground} on ${surface} = ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('muted text clears the 4.5:1 body threshold on background, card and subtle', () => {
    // Muted text is used for real content (timestamps, counts, paths), not
    // decoration, so it is held to the body-text bar rather than 3:1.
    for (const { label, tokens: t } of MATRIX) {
      for (const surface of [t.background, t.card, t.subtle] as const) {
        const ratio = contrastRatio(t.mutedForeground, surface);
        expect(
          ratio,
          `${label}: muted-foreground ${t.mutedForeground} on ${surface} = ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('status colours clear 3:1 against the base background and card', () => {
    // Status colours are carriers of meaning on icons/badges (non-text
    // contrast), so 3:1 is the applicable threshold.
    for (const { label, tokens: t } of MATRIX) {
      for (const key of ['success', 'warning', 'info', 'danger', 'done'] as const) {
        for (const surface of [t.background, t.card] as const) {
          const ratio = contrastRatio(t[key], surface);
          expect(
            ratio,
            `${label}: ${key} ${t[key]} on ${surface} = ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it('status colours stay distinguishable from each other', () => {
    // A "failed" badge that looks like a "completed" badge is a correctness
    // bug, not a styling one — and hue-harmonised palettes are exactly where
    // it happens.
    for (const { label, tokens: t } of MATRIX) {
      const pairs: Array<[string, string]> = [
        ['success', 'danger'],
        ['success', 'warning'],
        ['warning', 'danger'],
        ['info', 'success'],
        ['info', 'danger'],
      ];
      for (const [a, b] of pairs) {
        const ca = t[a as 'success'];
        const cb = t[b as 'danger'];
        const dist = Math.abs(relativeLuminance(parseHex(ca)) - relativeLuminance(parseHex(cb)));
        const hueApart =
          Math.abs(parseHex(ca).r - parseHex(cb).r) +
          Math.abs(parseHex(ca).g - parseHex(cb).g) +
          Math.abs(parseHex(ca).b - parseHex(cb).b);
        expect(dist + hueApart / 255, `${label}: ${a} vs ${b}`).toBeGreaterThan(0.35);
      }
    }
  });

  it('accent primary stays readable as link text', () => {
    for (const { theme, appearance, label, tokens } of MATRIX) {
      for (const accentId of ACCENT_IDS) {
        const { primary } = resolveAccentTokens(theme, accentId, appearance);
        const ratio = contrastRatio(primary, tokens.background);
        expect(
          ratio,
          `${label}/${accentId}: primary ${primary} on background = ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('selection tints stay subtle enough to read text through', () => {
    // A row tint that swallows its own label is worse than no tint.
    for (const { theme, appearance, label, tokens: t } of MATRIX) {
      for (const accentId of ACCENT_IDS) {
        const { accent: tint } = resolveAccentTokens(theme, accentId, appearance);
        const composited = flatten(tint, t.background);
        const ratio = contrastRatio(t.foreground, composited);
        expect(
          ratio,
          `${label}/${accentId}: foreground on accent tint = ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('surfaces stay visually separable from each other', () => {
    // Without this, a theme can pass every text-contrast bar while rendering
    // a card that is indistinguishable from the page behind it.
    //
    // `popover` is deliberately exempt: GitHub Light floats a pure-white menu
    // on a pure-white page and separates it with a border and a shadow, which
    // is a legitimate (and very common) choice. The border assertion below is
    // what actually protects that case.
    for (const { label, tokens: t } of MATRIX) {
      const bg = relativeLuminance(parseHex(t.background));
      for (const [name, surface] of [
        ['card', t.card],
        ['emphasis', t.emphasis],
      ] as const) {
        expect(
          Math.abs(relativeLuminance(parseHex(surface)) - bg),
          `${label}: ${name} is the same luminance as background`,
        ).toBeGreaterThan(0.002);
      }
    }
  });

  it('borders are visible against the surfaces they divide', () => {
    for (const { label, tokens: t } of MATRIX) {
      for (const surface of [t.background, t.card, t.popover] as const) {
        const ratio = contrastRatio(t.border, surface);
        expect(
          ratio,
          `${label}: border ${t.border} on ${surface} = ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(1.2);
      }
    }
  });
});

describe('derived surfaces', () => {
  it('gives every theme a full terminal palette that reads on its own background', () => {
    for (const { theme, appearance, label } of MATRIX) {
      const term = resolveTerminalPalette(theme, appearance);
      for (const key of ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan'] as const) {
        const ratio = contrastRatio(term[key], term.background);
        expect(
          ratio,
          `${label}: terminal ${key} ${term[key]} on ${term.background} = ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(2.5);
      }
      // The cursor has to be findable, and it is the one glyph with no label.
      expect(contrastRatio(term.cursor, term.background), `${label}: cursor`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('gives every theme syntax colours that read on its code surface', () => {
    for (const { theme, appearance, label, tokens } of MATRIX) {
      const syntax = resolveSyntaxTokens(theme, appearance);
      for (const [role, colour] of Object.entries(syntax)) {
        const ratio = contrastRatio(colour, tokens.card);
        expect(
          ratio,
          `${label}: syntax.${role} ${colour} on card = ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('gives every theme six distinguishable chart colours', () => {
    for (const { theme, appearance, label, tokens } of MATRIX) {
      const ramp = resolveChartRamp(theme, appearance);
      expect(ramp, label).toHaveLength(6);
      expect(new Set(ramp).size, `${label}: chart ramp has duplicates`).toBe(6);
      for (const colour of ramp) {
        expect(
          contrastRatio(colour, tokens.background),
          `${label}: chart colour ${colour} on background`,
        ).toBeGreaterThanOrEqual(2.5);
      }
    }
  });
});

describe('file-icon palette', () => {
  it('stays visible against the tree background of every theme', () => {
    // File-type icons sit next to a filename that already carries the
    // meaning, so WCAG 1.4.11's 3:1 does not apply. The bar here is only
    // "perceptible": the palette's own floor is ~2.2:1 (yellow on white,
    // which is about as dark as yellow gets before it reads as brown).
    for (const { appearance, label, tokens } of MATRIX) {
      for (const [name, pair] of Object.entries(FILE_ICON_COLORS)) {
        const ratio = contrastRatio(pair[appearance], tokens.background);
        expect(ratio, `${label}: file-icon-${name}`).toBeGreaterThanOrEqual(1.7);
      }
    }
  });

  it('pairs are darker on light and lighter on dark', () => {
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

  it('has no stale orientation waivers', () => {
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
});

describe('the high-contrast theme actually is one', () => {
  // Shipping a theme called "High Contrast" that merely clears the same AA bar
  // as every other theme would be a lie told in the picker. These assertions
  // are the difference between a name and a guarantee.
  const hc = THEMES.find((t) => t.id === 'contrast')!;

  it('clears AAA (7:1) for body and secondary text on every surface', () => {
    for (const appearance of APPEARANCES) {
      const t = resolveAppearanceTokens(hc, appearance);
      for (const text of [t.foreground, t.mutedForeground] as const) {
        for (const surface of [t.background, t.card, t.popover, t.raised, t.subtle] as const) {
          const ratio = contrastRatio(text, surface);
          expect(
            ratio,
            `contrast/${appearance}: ${text} on ${surface} = ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(7);
        }
      }
    }
  });

  it('holds status colours and accents to the TEXT threshold, not the non-text one', () => {
    for (const appearance of APPEARANCES) {
      const t = resolveAppearanceTokens(hc, appearance);
      for (const key of ['success', 'warning', 'info', 'danger', 'done'] as const) {
        expect(
          contrastRatio(t[key], t.background),
          `contrast/${appearance}: ${key} on background`,
        ).toBeGreaterThanOrEqual(4.5);
      }
      for (const accentId of ACCENT_IDS) {
        const { primary } = resolveAccentTokens(hc, accentId, appearance);
        expect(
          contrastRatio(primary, t.background),
          `contrast/${appearance}/${accentId}: primary on background`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps borders visible in greyscale', () => {
    // The layout has to survive being viewed without colour at all, which is
    // what a 3:1 border (the non-text bar, applied to a divider) buys.
    for (const appearance of APPEARANCES) {
      const t = resolveAppearanceTokens(hc, appearance);
      for (const surface of [t.background, t.card] as const) {
        expect(
          contrastRatio(t.border, surface),
          `contrast/${appearance}: border on ${surface}`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe('the default theme is unchanged', () => {
  // GitHub is what every existing user is already looking at. These are the
  // exact values from the hand-authored token table that preceded the theme
  // system, asserted so a refactor of the derivation cannot quietly restyle
  // the whole app.
  const github = THEMES.find((t) => t.id === 'github')!;

  it('reproduces the original dark tokens', () => {
    const t = resolveAppearanceTokens(github, 'dark');
    expect(t.background).toBe('#0d1117');
    expect(t.foreground).toBe('#e6edf3');
    expect(t.card).toBe('#161b22');
    expect(t.popover).toBe('#1c2129');
    expect(t.subtle).toBe('#21262d');
    expect(t.emphasis).toBe('#30363d');
    expect(t.mutedForeground).toBe('#8b949e');
    expect(t.border).toBe('#30363d');
    expect(t.borderMuted).toBe('#21262d');
    expect(t.success).toBe('#3fb950');
    expect(t.warning).toBe('#d29922');
    expect(t.info).toBe('#4493f8');
    expect(t.danger).toBe('#f85149');
    expect(t.done).toBe('#a371f7');
    expect(t.sidebar).toBe('#161b22');
    expect(t.canvasBg).toBe('#0d1117');
    expect(t.canvasDot).toBe('rgba(48, 54, 61, 0.6)');
  });

  it('reproduces the original light tokens', () => {
    const t = resolveAppearanceTokens(github, 'light');
    expect(t.background).toBe('#ffffff');
    expect(t.foreground).toBe('#1f2328');
    expect(t.card).toBe('#f6f8fa');
    expect(t.subtle).toBe('#f0f3f6');
    expect(t.emphasis).toBe('#dfe2e5');
    expect(t.mutedForeground).toBe('#656d76');
    expect(t.border).toBe('#d0d7de');
    expect(t.success).toBe('#1a7f37');
    expect(t.danger).toBe('#d1242f');
    expect(t.done).toBe('#8250df');
  });

  it('reproduces the original accent table', () => {
    const accents = themeAccents(github);
    const byId = Object.fromEntries(accents.map((a) => [a.id, a]));
    expect(byId.blue.dark).toEqual({ primary: '#4493f8', emphasis: '#1f6feb' });
    expect(byId.blue.light).toEqual({ primary: '#0969da', emphasis: '#0969da' });
    expect(byId.violet.dark).toEqual({ primary: '#a371f7', emphasis: '#8957e5' });
    expect(byId.green.dark).toEqual({ primary: '#3fb950', emphasis: '#238636' });
    expect(byId.orange.dark).toEqual({ primary: '#db6d28', emphasis: '#bc4c00' });
    expect(byId.rose.dark).toEqual({ primary: '#f778ba', emphasis: '#bf4b8a' });
    expect(byId.teal.dark).toEqual({ primary: '#39c5cf', emphasis: '#1b7c83' });
  });
});
