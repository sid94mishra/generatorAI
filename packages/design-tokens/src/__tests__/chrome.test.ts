import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CHROME, CHROME_FALLBACK_COLORS, SHELL, trafficLightPosition } from '../chrome.js';
import { chromeColors } from '../chrome-colors.js';
import { relativeLuminance, parseHex } from '../color.js';
import { DEFAULT_THEME, THEMES, isKnownTheme } from '../themes/index.js';

const HEX6 = /^#[0-9a-f]{6}$/;

describe('CHROME / SHELL (06 §3.1, 02 §8)', () => {
  it('chrome.ts has no imports, so the Electron main bundle stays lean', () => {
    const source = readFileSync(fileURLToPath(new URL('../chrome.ts', import.meta.url)), 'utf8');
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\(/);
  });

  it('keeps the current desktop minimum window', () => {
    expect(CHROME.minWindow).toEqual({ width: 860, height: 560 });
  });

  it('centres the mac traffic lights in the 44px row', () => {
    expect(trafficLightPosition()).toEqual({ x: 16, y: 16 });
  });

  it('strip caption cluster is three caption buttons', () => {
    expect(CHROME.strip.captionClusterWidth).toBe(3 * CHROME.strip.captionButtonWidth);
  });

  it('SHELL re-exports the CHROME widths instead of redefining them', () => {
    expect(SHELL.sidebarWidth).toBe(CHROME.sidebarWidth);
    expect(SHELL.railWidth).toBe(CHROME.railWidth);
    expect(SHELL.railBreakpoint).toBe(CHROME.railBreakpoint);
    expect(SHELL.mainCardInset).toBe(CHROME.cardMargin);
    expect(SHELL.pageHeaderHeight).toBe(CHROME.pageHeaderHeight);
    expect([SHELL.dockWidth, SHELL.dockWidthRun, SHELL.dockSheetWidth]).toEqual([480, 440, 380]);
    expect(SHELL.dialogWidth).toEqual({ sm: 420, md: 640, lg: 960, xl: 1040 });
  });
});

describe('chromeColors (18 themes × 2 appearances)', () => {
  const cases = THEMES.flatMap((t) => (['dark', 'light'] as const).map((ap) => [t.id, ap] as const));

  it.each(cases)('%s %s: #rrggbb ground is the darker of background/card', (id, ap) => {
    const { ground, fg } = chromeColors(id, ap);
    expect(ground).toMatch(HEX6);
    expect(fg).toMatch(HEX6);
    const spec = THEMES.find((t) => t.id === id)![ap];
    const lum = (c: string) => relativeLuminance(parseHex(c));
    expect(lum(ground)).toBeCloseTo(Math.min(lum(spec.background), lum(spec.card)), 6);
  });

  it('matches the GitHub literals the desktop shell hard-codes today', () => {
    expect(chromeColors('github', 'dark')).toEqual({ ground: '#0d1117', fg: '#e6edf3' });
    expect(chromeColors('github', 'light').fg).toBe('#1f2328');
  });

  it('falls back to the default theme for unknown ids', () => {
    expect(chromeColors('no-such-theme', 'dark')).toEqual(chromeColors(DEFAULT_THEME, 'dark'));
  });

  // 02 §12 row 15. Unconditional: a renamed or removed Instrument must fail here, not skip.
  it('CHROME_FALLBACK_COLORS equals Instrument ground/fg', () => {
    expect(isKnownTheme('instrument')).toBe(true);
    for (const ap of ['dark', 'light'] as const) {
      const { ground, fg } = chromeColors('instrument', ap);
      expect({ background: ground, symbol: fg }).toEqual(CHROME_FALLBACK_COLORS[ap]);
    }
  });
});
