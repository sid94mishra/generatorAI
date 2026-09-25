// applyAppearance (the one DOM writer, D-25) and its parity with the generated
// pre-paint script in index.html: for the same storage, first paint and the
// hydrated app must write identical attributes, or the user sees a flash.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ACCENT_STORAGE_KEY,
  DEFAULT_ACCENT,
  DEFAULT_DENSITY,
  DEFAULT_FONT_SIZE,
  DEFAULT_MODE,
  DEFAULT_THEME,
  DENSITY_STORAGE_KEY,
  FONT_SIZE_STORAGE_KEY,
  MODE_STORAGE_KEY,
  REDUCE_MOTION_STORAGE_KEY,
  THEME_STORAGE_KEY,
  readStoredAppearance,
  resolveAppearance,
} from '@generatorai/design-tokens';
import { applyAppearance, type AppliedAppearance } from '../appearance';

const html = document.documentElement;

function snapshot(el: HTMLElement = html) {
  const attrs = Object.fromEntries(
    [...el.attributes].filter((a) => a.name.startsWith('data-')).map((a) => [a.name, a.value]),
  );
  const classes = [...el.classList].filter((c) => c === 'light' || c === 'dark');
  return { classes, attrs };
}

function resetHtml() {
  for (const a of [...html.attributes]) if (a.name.startsWith('data-')) html.removeAttribute(a.name);
  html.classList.remove('light', 'dark');
}

afterEach(() => {
  resetHtml();
  localStorage.clear();
  vi.restoreAllMocks();
});

const base: AppliedAppearance = {
  mode: 'system',
  resolved: 'light',
  theme: 'github',
  accent: 'blue',
  density: 'compact',
  fontSize: '14',
  reduceMotion: true,
};

describe('applyAppearance', () => {
  it('writes the class and every data attribute', () => {
    applyAppearance(base);
    expect(snapshot()).toEqual({
      classes: ['light'],
      attrs: {
        'data-mode': 'system',
        'data-theme': 'github',
        'data-accent': 'blue',
        'data-density': 'compact',
        'data-font-size': '14',
        'data-motion': 'reduce',
      },
    });
  });

  it('swaps light/dark and removes data-motion when motion is allowed again', () => {
    applyAppearance(base);
    applyAppearance({ ...base, resolved: 'dark', reduceMotion: false });
    expect(snapshot().classes).toEqual(['dark']);
    expect(html.hasAttribute('data-motion')).toBe(false);
  });

  it('defaults data-mode to the resolved appearance (Storybook has no "system")', () => {
    applyAppearance({ ...base, mode: undefined, resolved: 'dark' });
    expect(html.getAttribute('data-mode')).toBe('dark');
  });

  it('themes any element, not only <html> (Storybook decorators)', () => {
    const el = document.createElement('div');
    applyAppearance({ ...base, theme: 'nord', accent: 'teal' }, el);
    expect(snapshot(el).attrs['data-theme']).toBe('nord');
    expect(html.hasAttribute('data-theme')).toBe(false);
  });

  it('skips writes that would not change anything', () => {
    applyAppearance(base);
    const set = vi.spyOn(html, 'setAttribute');
    applyAppearance(base);
    expect(set).not.toHaveBeenCalled();
  });
});

/** The generated inline script, exactly as index.html ships it. */
const prepaint = (() => {
  const source = readFileSync(join(__dirname, '..', '..', '..', '..', 'index.html'), 'utf8');
  const start = source.indexOf('<script>');
  return source.slice(start + '<script>'.length, source.indexOf('</script>', start));
})();

function mockMedia(dark: boolean, reduced: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (q: string) =>
      ({
        matches: q.includes('color-scheme') ? dark : reduced,
        media: q,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
}

describe('pre-paint parity (index.html vs applyAppearance)', () => {
  const cases: Array<[string, Record<string, string>, boolean, boolean]> = [
    ['cleared storage', {}, true, false],
    ['github light, no accent', { [THEME_STORAGE_KEY]: 'github', [MODE_STORAGE_KEY]: 'light' }, true, false],
    ['nord system on a light OS', { [THEME_STORAGE_KEY]: 'nord', [MODE_STORAGE_KEY]: 'system' }, false, false],
    ['compact 12, reduce always', { [DENSITY_STORAGE_KEY]: 'compact', [FONT_SIZE_STORAGE_KEY]: '12', [REDUCE_MOTION_STORAGE_KEY]: '1' }, true, false],
    ['explicit ink on solarized, OS reduces motion', { [THEME_STORAGE_KEY]: 'solarized', [ACCENT_STORAGE_KEY]: 'ink' }, true, true],
    ['junk everywhere', { [THEME_STORAGE_KEY]: 'nope', [MODE_STORAGE_KEY]: 'sepia', [FONT_SIZE_STORAGE_KEY]: '9' }, true, false],
  ];

  it.each(cases)('%s', (_label, storage, osDark, osReduced) => {
    for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
    mockMedia(osDark, osReduced);

    new Function(prepaint)();
    const painted = snapshot();

    resetHtml();
    const s = readStoredAppearance((k) => localStorage.getItem(k));
    applyAppearance({
      mode: s.mode,
      resolved: resolveAppearance(s.mode, osDark),
      theme: s.theme,
      accent: s.accent,
      density: s.density,
      fontSize: s.fontSize,
      reduceMotion: s.reduceMotion === 'on' || osReduced,
    });
    expect(snapshot()).toEqual(painted);
  });

  it('cleared storage paints the registry defaults (dark / instrument / ink / comfortable / 13)', () => {
    mockMedia(false, false);
    new Function(prepaint)();
    expect(snapshot()).toEqual({
      classes: [DEFAULT_MODE],
      attrs: {
        'data-mode': DEFAULT_MODE,
        'data-theme': DEFAULT_THEME,
        'data-accent': DEFAULT_ACCENT,
        'data-density': DEFAULT_DENSITY,
        'data-font-size': DEFAULT_FONT_SIZE,
      },
    });
  });
});
