// The desktop half of D-25 (06 §6.1–§6.4): main mirrors the renderer's
// appearance push — validate, persist, themeSource = mode, repaint, menu —
// and paints the persisted theme colours on the next launch.

import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODE, DEFAULT_THEME, THEMES, chromeColors } from '@generatorai/design-tokens';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, nativeTheme: { shouldUseDarkColors: true } }));
vi.mock('../logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { DEFAULT_APPEARANCE } from '../config';
import { appearanceMirror, commitAppearance, isDarkMode } from '../appearance';

/** What ThemeProvider pushes for a theme (chromeColors for both appearances). */
function push(themeId: string, mode: 'light' | 'dark' | 'system') {
  const light = chromeColors(themeId, 'light');
  const dark = chromeColors(themeId, 'dark');
  return { mode, themeId, groundLight: light.ground, groundDark: dark.ground, fgLight: light.fg, fgDark: dark.fg };
}

function deps() {
  return { save: vi.fn(), setThemeSource: vi.fn(), repaint: vi.fn(), updateMenu: vi.fn() };
}

describe('DEFAULT_APPEARANCE', () => {
  it('equals the web defaults: DEFAULT_MODE, DEFAULT_THEME and its chrome colours', () => {
    expect(DEFAULT_APPEARANCE).toEqual(push(DEFAULT_THEME, DEFAULT_MODE));
  });
});

describe('commitAppearance (IPC.setAppearance)', () => {
  it('persists, mirrors themeSource, repaints and moves the menu radio — in that order', () => {
    const d = deps();
    const order: string[] = [];
    for (const [k, fn] of Object.entries(d)) fn.mockImplementation(() => order.push(k));
    const payload = push('solarized', 'light');
    expect(commitAppearance(payload, d)).toEqual({ ok: true, appearance: payload });
    expect(d.save).toHaveBeenCalledWith(payload);
    expect(d.setThemeSource).toHaveBeenCalledWith('light');
    expect(d.updateMenu).toHaveBeenCalledWith('light');
    expect(order).toEqual(['save', 'setThemeSource', 'repaint', 'updateMenu']);
  });

  it('accepts the push of every theme in both modes (hex literals only)', () => {
    for (const t of THEMES) {
      for (const mode of ['light', 'dark', 'system'] as const) {
        expect(commitAppearance(push(t.id, mode), deps()).ok, `${t.id}/${mode}`).toBe(true);
      }
    }
  });

  it('refuses a malformed push and writes nothing', () => {
    const d = deps();
    const result = commitAppearance({ ...push('github', 'dark'), groundDark: 'rgb(0 0 0)' }, d);
    expect(result.ok).toBe(false);
    for (const fn of Object.values(d)) expect(fn).not.toHaveBeenCalled();
    expect(commitAppearance(null, d).ok).toBe(false);
  });
});

describe('appearanceMirror', () => {
  const solarized = push('solarized', 'system');

  it('picks the persisted ground/fg for the resolved appearance', () => {
    expect(appearanceMirror(solarized, false)).toEqual({ dark: false, ground: '#eee8d5', fg: solarized.fgLight });
    expect(appearanceMirror(solarized, true)).toEqual({ dark: true, ground: solarized.groundDark, fg: solarized.fgDark });
    expect(appearanceMirror({ ...solarized, mode: 'light' }, true).ground).toBe('#eee8d5');
  });

  it('isDarkMode follows the OS only for system', () => {
    expect(isDarkMode('system', true)).toBe(true);
    expect(isDarkMode('system', false)).toBe(false);
    expect(isDarkMode('dark', false)).toBe(true);
    expect(isDarkMode('light', true)).toBe(false);
  });
});
