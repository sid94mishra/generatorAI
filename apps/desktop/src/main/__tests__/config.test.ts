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

import { loadSettings, resetSettingsCache, saveSettings } from '../config';

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
    files.set(FILE, JSON.stringify({ harnessType: 'openai', serverPort: 'abc', theme: 'dark' }));
    const s = loadSettings();
    expect(s.harnessType).toBe('copilot');
    expect(s.serverPort).toBe(0);
    expect(s.theme).toBe('dark');
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/Ignoring invalid setting/);
  });

  it('survives a file that is not JSON', () => {
    files.set(FILE, '{ not json');
    expect(loadSettings().harnessType).toBe('copilot');
  });

  it('caches until reset', () => {
    files.set(FILE, JSON.stringify({ theme: 'light' }));
    expect(loadSettings().theme).toBe('light');
    files.set(FILE, JSON.stringify({ theme: 'dark' }));
    expect(loadSettings().theme).toBe('light');
    resetSettingsCache();
    expect(loadSettings().theme).toBe('dark');
  });
});

describe('saveSettings', () => {
  it('writes the merged settings back', () => {
    saveSettings({ serverPort: 4200 });
    expect(JSON.parse(files.get(FILE)!)).toMatchObject({ serverPort: 4200, harnessType: 'copilot' });
  });
});
