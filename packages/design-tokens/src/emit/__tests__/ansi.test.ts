import { describe, it, expect } from 'vitest';
import {
  buildTerminalTheme,
  emitAllTerminalThemes,
  terminalThemeIds,
  resolveTerminalTheme,
  toAnsi256,
  toAnsi16,
  paint,
  sgr,
  RESET,
  type TerminalTheme,
} from '../ansi.js';
import { THEMES, VISIBLE_THEMES, getThemeDef } from '../../themes/index.js';

const HEX = /^#[0-9a-f]{6}$/i;

/** Every colour slot on the theme, excluding the nested maps. */
const SLOTS: Array<keyof TerminalTheme> = [
  'background', 'foreground', 'surface', 'surfaceForeground', 'muted',
  'border', 'borderMuted', 'selectionBackground', 'selectionForeground',
  'focusBorder', 'primary', 'primaryForeground', 'success', 'warning',
  'danger', 'info', 'running', 'idle', 'diffAdded', 'diffAddedBg',
  'diffRemoved', 'diffRemovedBg', 'diffContext',
];

function relativeLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const srgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

function contrast(a: string, b: string): number {
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

describe('terminal theme catalog', () => {
  it('offers every user-visible web theme to the terminal', () => {
    // The invariant is parity with the web picker, not any particular count.
    expect(terminalThemeIds().length).toBe(VISIBLE_THEMES.length);
    expect(terminalThemeIds().map((t) => t.id).sort()).toEqual(
      VISIBLE_THEMES.map((t) => t.id).sort(),
    );
  });

  it('emits light and dark for every theme', () => {
    const all = emitAllTerminalThemes();
    expect(Object.keys(all).length).toBe(THEMES.length);
    for (const [id, appearances] of Object.entries(all)) {
      expect(Object.keys(appearances).sort(), id).toEqual(['dark', 'light']);
    }
  });
});

describe('buildTerminalTheme', () => {
  const cases = THEMES.flatMap((theme) =>
    (['light', 'dark'] as const).map((appearance) => ({ theme, appearance })),
  );

  it.each(cases)('$theme.id/$appearance fills every slot with an opaque hex', ({ theme, appearance }) => {
    const built = buildTerminalTheme(theme, appearance);
    for (const slot of SLOTS) {
      expect(built[slot], `${theme.id}/${appearance} ${String(slot)}`).toMatch(HEX);
    }
  });

  it.each(cases)('$theme.id/$appearance keeps body text readable', ({ theme, appearance }) => {
    // A terminal cannot blend alpha, so a token authored as a tint must be
    // composited before it ships or it renders at full strength.
    const built = buildTerminalTheme(theme, appearance);
    expect(contrast(built.foreground, built.background)).toBeGreaterThan(4.5);
  });

  it.each(cases)('$theme.id/$appearance keeps muted text legible', ({ theme, appearance }) => {
    const built = buildTerminalTheme(theme, appearance);
    expect(contrast(built.muted, built.background)).toBeGreaterThan(2.5);
  });

  it.each(cases)('$theme.id/$appearance emits a full 16-colour ANSI palette', ({ theme, appearance }) => {
    const built = buildTerminalTheme(theme, appearance);
    expect(Object.keys(built.ansi).length).toBeGreaterThanOrEqual(16);
    for (const [name, value] of Object.entries(built.ansi)) {
      expect(value, `${theme.id} ansi.${name}`).toMatch(HEX);
    }
  });

  it.each(cases)('$theme.id/$appearance emits syntax roles', ({ theme, appearance }) => {
    const built = buildTerminalTheme(theme, appearance);
    expect(Object.keys(built.syntax).length).toBeGreaterThan(0);
    for (const [role, value] of Object.entries(built.syntax)) {
      expect(value, `${theme.id} syntax.${role}`).toMatch(HEX);
    }
  });

  it('keeps danger red regardless of the chosen accent', () => {
    const theme = getThemeDef('tokyo-night');
    const a = buildTerminalTheme(theme, 'dark', 'green');
    const b = buildTerminalTheme(theme, 'dark', 'violet');
    expect(a.danger).toBe(b.danger);
    expect(a.primary).not.toBe(b.primary);
  });
});

describe('colour ladders', () => {
  it('maps pure colours onto the 256-cube', () => {
    expect(toAnsi256({ r: 0, g: 0, b: 0, a: 1 })).toBe(16);
    expect(toAnsi256({ r: 255, g: 255, b: 255, a: 1 })).toBe(231);
  });

  it('keeps every 256 index in range', () => {
    for (const c of [0, 64, 128, 192, 255]) {
      const idx = toAnsi256({ r: c, g: c, b: c, a: 1 });
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThanOrEqual(255);
    }
  });

  it('maps colours onto valid SGR foreground codes', () => {
    // toAnsi16 emits the SGR code itself (30-37 / 90-97), because `sgr` adds
    // 10 for background rather than re-deriving the colour.
    for (const c of [0, 128, 255]) {
      const code = toAnsi16({ r: c, g: 0, b: 0, a: 1 });
      expect((code >= 30 && code <= 37) || (code >= 90 && code <= 97), String(code)).toBe(true);
    }
  });

  it('emits a bright code for a light colour and a dim one for a dark colour', () => {
    expect(toAnsi16({ r: 255, g: 60, b: 60, a: 1 })).toBeGreaterThanOrEqual(90);
    expect(toAnsi16({ r: 10, g: 10, b: 10, a: 1 })).toBeLessThan(90);
  });

  it('emits a truecolor SGR sequence', () => {
    expect(sgr('#ff8800', { ladder: 'truecolor' })).toContain('38;2;255;136;0');
  });

  it('emits nothing at all on the none ladder', () => {
    expect(sgr('#ff8800', { ladder: 'none' })).toBe('');
    expect(paint('hello', '#ff8800', 'none')).toBe('hello');
  });

  it('always terminates painted text with a reset', () => {
    const painted = paint('hello', '#ff8800', 'truecolor');
    expect(painted.endsWith(RESET)).toBe(true);
    expect(painted).toContain('hello');
  });

  it('paints a background when asked', () => {
    expect(sgr('#ff8800', { ladder: 'truecolor', background: true })).toContain('48;2;');
  });
});

describe('resolveTerminalTheme', () => {
  it('returns a usable theme with no options at all', () => {
    const theme = resolveTerminalTheme();
    expect(theme.background).toMatch(HEX);
    expect(theme.id).toBeTruthy();
  });

  it('honours an explicit theme and appearance', () => {
    const theme = resolveTerminalTheme({ theme: 'nord', appearance: 'dark' });
    expect(theme.id).toBe('nord');
    expect(theme.appearance).toBe('dark');
  });

  it('treats auto as the default theme', () => {
    expect(resolveTerminalTheme({ theme: 'auto' }).id).toBe(resolveTerminalTheme().id);
  });

  it('falls back rather than throwing on an unknown id', () => {
    // A theme removed in an upgrade must not stop the CLI from starting.
    expect(resolveTerminalTheme({ theme: 'does-not-exist' }).background).toMatch(HEX);
  });
});
