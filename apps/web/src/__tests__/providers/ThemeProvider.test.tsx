// ThemeProvider is the single writer of the appearance axes (D-25): it
// initialises from storage with the pre-paint rule, writes <html> through
// applyAppearance, persists each axis, applies View ▸ Appearance requests from
// the desktop shell and pushes the theme's chrome colours back to it.

import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACCENT_STORAGE_KEY,
  DENSITY_STORAGE_KEY,
  FONT_SIZE_STORAGE_KEY,
  MODE_STORAGE_KEY,
  REDUCE_MOTION_STORAGE_KEY,
  THEME_STORAGE_KEY,
  chromeColors,
} from '@generatorai/design-tokens';
import { ThemeProvider, useTheme } from '@/providers/ThemeProvider';

type Ctx = ReturnType<typeof useTheme>;

function mount(): { ctx: () => Ctx } {
  let latest: Ctx | null = null;
  function Probe() {
    latest = useTheme();
    return null;
  }
  render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
  return { ctx: () => latest! };
}

const html = document.documentElement;
const attr = (name: string) => html.getAttribute(name);

beforeEach(() => {
  localStorage.clear();
  for (const a of [...html.attributes]) if (a.name.startsWith('data-')) html.removeAttribute(a.name);
  html.classList.remove('light', 'dark');
});

afterEach(() => {
  delete (window as { generatoraiDesktop?: unknown }).generatoraiDesktop;
  vi.useRealTimers();
});

describe('ThemeProvider', () => {
  it('cleared storage → dark / instrument / ink / comfortable / 13', () => {
    const { ctx } = mount();
    expect(html.classList.contains('dark')).toBe(true);
    expect([attr('data-mode'), attr('data-theme'), attr('data-accent'), attr('data-density'), attr('data-font-size')]).toEqual([
      'dark',
      'instrument',
      'ink',
      'comfortable',
      '13',
    ]);
    expect(ctx().reduceMotion).toBe('system');
  });

  it('a stored theme with no stored accent paints that theme’s default accent', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'github');
    localStorage.setItem(MODE_STORAGE_KEY, 'light');
    mount();
    expect(html.classList.contains('light')).toBe(true);
    expect(attr('data-accent')).toBe('blue');
  });

  it('switching theme moves an unchosen accent to the new theme’s default; a chosen one stays', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'github');
    const { ctx } = mount();
    act(() => ctx().setThemeId('nord'));
    expect(attr('data-accent')).toBe('teal');
    expect(localStorage.getItem(ACCENT_STORAGE_KEY)).toBeNull();

    act(() => ctx().setAccent('rose'));
    act(() => ctx().setThemeId('github'));
    expect(attr('data-accent')).toBe('rose');
    expect(localStorage.getItem(ACCENT_STORAGE_KEY)).toBe('rose');
  });

  it('density, font size and reduce motion write the DOM and storage', () => {
    const { ctx } = mount();
    act(() => ctx().setDensity('compact'));
    act(() => ctx().setFontSize('12'));
    act(() => ctx().setReduceMotion('on'));
    expect([attr('data-density'), attr('data-font-size'), attr('data-motion')]).toEqual(['compact', '12', 'reduce']);
    expect(localStorage.getItem(DENSITY_STORAGE_KEY)).toBe('compact');
    expect(localStorage.getItem(FONT_SIZE_STORAGE_KEY)).toBe('12');
    expect(localStorage.getItem(REDUCE_MOTION_STORAGE_KEY)).toBe('1');

    act(() => ctx().setReduceMotion('system'));
    expect(attr('data-motion')).toBeNull();
    expect(localStorage.getItem(REDUCE_MOTION_STORAGE_KEY)).toBeNull();
  });

  it('desktop: applies View ▸ Appearance requests and pushes the theme’s chrome colours', () => {
    vi.useFakeTimers();
    let request: ((r: { mode: 'light' | 'dark' | 'system' }) => void) | null = null;
    const setAppearance = vi.fn(async () => undefined);
    (window as { generatoraiDesktop?: unknown }).generatoraiDesktop = {
      isDesktop: true,
      onAppearanceRequest: (cb: typeof request) => {
        request = cb;
        return () => undefined;
      },
      setAppearance,
    };
    localStorage.setItem(THEME_STORAGE_KEY, 'solarized');
    mount();
    act(() => vi.advanceTimersByTime(60));
    const light = chromeColors('solarized', 'light');
    const dark = chromeColors('solarized', 'dark');
    expect(setAppearance).toHaveBeenLastCalledWith({
      mode: 'dark',
      themeId: 'solarized',
      groundLight: light.ground,
      groundDark: dark.ground,
      fgLight: light.fg,
      fgDark: dark.fg,
    });
    expect(light.ground).toBe('#eee8d5');

    act(() => request!({ mode: 'light' }));
    expect(html.classList.contains('light')).toBe(true);
    expect(localStorage.getItem(MODE_STORAGE_KEY)).toBe('light');
    act(() => vi.advanceTimersByTime(60));
    expect(setAppearance).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'light', themeId: 'solarized' }));
  });

  it('browser tab: no bridge, no push, no error', () => {
    vi.useFakeTimers();
    mount();
    expect(() => act(() => vi.advanceTimersByTime(60))).not.toThrow();
  });
});
