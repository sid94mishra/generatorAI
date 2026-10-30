// loadSettings must never crash the app, and must never hand the embedded
// server a value it will exit on. A corrupt settings.json is repaired to
// defaults with a logged warning.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const files = new Map<string, string>();
const warn = vi.fn();

vi.mock('electron', () => ({ app: { getPath: () => 'C:/fake/userData' } }));
vi.mock('node:fs', () => ({
  readFileSync: (p: string) => {
    const v = files.get(String(p).replace(/\\/g, '/'));
    if (v === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return v;
  },
  writeFileSync: (p: string, data: string) => files.set(String(p).replace(/\\/g, '/'), data),
  mkdirSync: () => undefined,
}));
vi.mock('../logger', () => ({ log: { info: vi.fn(), warn: (...a: unknown[]) => warn(...a), error: vi.fn(), debug: vi.fn() } }));

import { DEFAULT_APPEARANCE, loadSettings, resetSettingsCache, saveSettings } from '../config';

// Solarized light, as the renderer pushes it (chromeColors('solarized', …)).
const SOLARIZED = {
  mode: 'light',
  themeId: 'solarized',
  groundLight: '#eee8d5',
  groundDark: '#002b36',
  fgLight: '#586e75',
  fgDark: '#93a1a1',
} as const;

const FILE = 'C:/fake/userData/settings.json';

beforeEach(() => {
  files.clear();
  warn.mockClear();
  resetSettingsCache();
});

describe('loadSettings', () => {
  it('returns defaults when the file is missing, silently', () => {
    const s = loadSettings();
    expect(s.harnessType).toBe('copilot');
    expect(s.serverPort).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it('repairs a bad harnessType and serverPort instead of feeding them to the server', () => {
    files.set(FILE, JSON.stringify({ harnessType: 'openai', serverPort: 'abc', appearance: SOLARIZED }));
    const s = loadSettings();
    expect(s.harnessType).toBe('copilot');
    expect(s.serverPort).toBe(0);
    expect(s.appearance).toEqual(SOLARIZED);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/Ignoring invalid setting/);
  });

  it('survives a file that is not JSON', () => {
    files.set(FILE, '{ not json');
    expect(loadSettings().harnessType).toBe('copilot');
  });

  it('caches until reset', () => {
    files.set(FILE, JSON.stringify({ minimizeToTray: true }));
    expect(loadSettings().minimizeToTray).toBe(true);
    files.set(FILE, JSON.stringify({ minimizeToTray: false }));
    expect(loadSettings().minimizeToTray).toBe(true);
    resetSettingsCache();
    expect(loadSettings().minimizeToTray).toBe(false);
  });
});

describe('appearance persistence (D-25)', () => {
  it('defaults to the Instrument dark appearance before the renderer has pushed anything', () => {
    expect(loadSettings().appearance).toEqual(DEFAULT_APPEARANCE);
  });

  it('a pushed appearance survives a relaunch (fresh read from disk)', () => {
    saveSettings({ appearance: SOLARIZED });
    resetSettingsCache();
    expect(loadSettings().appearance).toEqual(SOLARIZED);
  });

  it('repairs a corrupt appearance to the default instead of painting a bad colour', () => {
    files.set(FILE, JSON.stringify({ appearance: { ...SOLARIZED, groundLight: 'oklch(0.9 0 0)' } }));
    expect(loadSettings().appearance).toEqual(DEFAULT_APPEARANCE);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('saveSettings', () => {
  it('writes the merged settings back', () => {
    saveSettings({ serverPort: 4200 });
    expect(JSON.parse(files.get(FILE)!)).toMatchObject({ serverPort: 4200, harnessType: 'copilot' });
  });
});
