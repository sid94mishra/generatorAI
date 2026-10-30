// Settings VALUES are validated at both ends. A bad value written through the
// IPC used to be persisted verbatim and then handed to the embedded server,
// which exited on every launch until the user hand-edited the file.

import { describe, expect, it } from 'vitest';
import { DEFAULT_CONNECTION_STATE } from '../serverConnections';
import { isRendererSettingKey, sanitizeSettings, validateSettingValue } from '../settings-schema';
import { DEFAULT_APPEARANCE, type DesktopSettings } from '../config';

const DEFAULTS: DesktopSettings = {
  appearance: DEFAULT_APPEARANCE,
  window: { width: 1440, height: 900 },
  serverPort: 0,
  harnessType: 'copilot',
  minimizeToTray: false,
  servers: DEFAULT_CONNECTION_STATE,
};

const LIGHT_GITHUB = {
  mode: 'light',
  themeId: 'github',
  groundLight: '#f6f8fa',
  groundDark: '#0d1117',
  fgLight: '#1f2328',
  fgDark: '#e6edf3',
} as const;

describe('validateSettingValue', () => {
  it('serverPort: integer 0-65535 only', () => {
    expect(validateSettingValue('serverPort', 0)).toEqual({ ok: true, value: 0 });
    expect(validateSettingValue('serverPort', 3100)).toEqual({ ok: true, value: 3100 });
    expect(validateSettingValue('serverPort', 65535).ok).toBe(true);
    for (const bad of [65536, -1, 3100.5, '3100', NaN, null, undefined, {}]) {
      expect(validateSettingValue('serverPort', bad).ok, String(bad)).toBe(false);
    }
  });

  it('harnessType: the enum the server understands', () => {
    expect(validateSettingValue('harnessType', 'claude-agent').ok).toBe(true);
    expect(validateSettingValue('harnessType', 'openai').ok).toBe(false);
    expect(validateSettingValue('harnessType', '').ok).toBe(false);
  });

  it('booleans are booleans, not truthy strings', () => {
    expect(validateSettingValue('minimizeToTray', true).ok).toBe(true);
    expect(validateSettingValue('minimizeToTray', 'true').ok).toBe(false);
    expect(validateSettingValue('minimizeToTray', 1).ok).toBe(false);
  });

  it('appearance: mode enum, theme id, #rrggbb colours only (06 §6.2)', () => {
    expect(validateSettingValue('appearance', LIGHT_GITHUB).ok).toBe(true);
    expect(validateSettingValue('appearance', DEFAULT_APPEARANCE).ok).toBe(true);
    const bad: unknown[] = [
      { ...LIGHT_GITHUB, mode: 'blue' },
      { ...LIGHT_GITHUB, themeId: 'Git Hub' },
      { ...LIGHT_GITHUB, themeId: 'x'.repeat(41) },
      // setBackgroundColor rejects CSS expressions: only hex literals persist.
      { ...LIGHT_GITHUB, groundLight: 'oklch(0.9 0 0)' },
      { ...LIGHT_GITHUB, groundDark: '#0d1117ff' },
      { ...LIGHT_GITHUB, fgLight: 'red' },
      { mode: 'dark' },
      { ...LIGHT_GITHUB, extra: 1 },
      'dark',
    ];
    for (const value of bad) expect(validateSettingValue('appearance', value).ok, JSON.stringify(value)).toBe(false);
  });

  it('appearance is not a generic renderer setting (only IPC.setAppearance writes it)', () => {
    expect(isRendererSettingKey('appearance')).toBe(false);
    expect(isRendererSettingKey('theme')).toBe(false);
  });

  it('lastRoute must be an app route, never a URL', () => {
    expect(validateSettingValue('lastRoute', '/chats/abc').ok).toBe(true);
    expect(validateSettingValue('lastRoute', 'https://evil.example').ok).toBe(false);
    expect(validateSettingValue('lastRoute', '//evil.example').ok).toBe(false);
    expect(validateSettingValue('lastRoute', 'x'.repeat(301)).ok).toBe(false);
  });

  it('reports which key failed', () => {
    const r = validateSettingValue('serverPort', 'abc');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^serverPort:/);
  });
});

describe('isRendererSettingKey', () => {
  it('accepts only the whitelisted keys', () => {
    expect(isRendererSettingKey('serverPort')).toBe(true);
    expect(isRendererSettingKey('servers')).toBe(false); // repaired internally, never renderer-writable
    expect(isRendererSettingKey('window')).toBe(false);
    expect(isRendererSettingKey(42)).toBe(false);
  });
});

describe('sanitizeSettings (loadSettings path)', () => {
  it('keeps valid values', () => {
    const out = sanitizeSettings(
      { appearance: LIGHT_GITHUB, serverPort: 4000, harnessType: 'anthropic', minimizeToTray: true, lastRoute: '/runs' },
      DEFAULTS,
    );
    expect(out).toMatchObject({ appearance: LIGHT_GITHUB, serverPort: 4000, harnessType: 'anthropic', minimizeToTray: true, lastRoute: '/runs' });
  });

  it('replaces each bad value with its default and reports it, instead of throwing', () => {
    const report = { repaired: [] as { key: string; error: string }[] };
    const out = sanitizeSettings(
      { serverPort: 'abc', harnessType: 'openai', minimizeToTray: 'yes', appearance: LIGHT_GITHUB },
      DEFAULTS,
      report,
    );
    expect(out.serverPort).toBe(0);
    expect(out.harnessType).toBe('copilot');
    expect(out.minimizeToTray).toBe(false);
    expect(out.appearance).toEqual(LIGHT_GITHUB); // the good one survives
    expect(report.repaired.map((r) => r.key).sort()).toEqual(['harnessType', 'minimizeToTray', 'serverPort']);
  });

  it('merges a partial window state over the defaults and repairs a corrupt one', () => {
    expect(sanitizeSettings({ window: { x: 10, y: 20 } }, DEFAULTS).window).toEqual({ width: 1440, height: 900, x: 10, y: 20 });
    const report = { repaired: [] as { key: string; error: string }[] };
    expect(sanitizeSettings({ window: { width: 'wide' } }, DEFAULTS, report).window).toEqual(DEFAULTS.window);
    expect(report.repaired[0]?.key).toBe('window');
  });

  it('tolerates a non-object file body', () => {
    for (const junk of [null, 'nope', 42, []]) {
      const out = sanitizeSettings(junk, DEFAULTS);
      expect(out.harnessType).toBe('copilot');
      expect(out.servers.serverMode).toBe('embedded');
    }
  });
});

describe('lastServerPort survives a round trip', () => {
  it('is kept, because the window origin (and its storage) depends on it', () => {
    // Dropping this on load sent the server to a new port every launch, which
    // changed the app's origin and emptied every per-origin store with it.
    const out = sanitizeSettings({ lastServerPort: 51904 }, DEFAULTS);
    expect(out.lastServerPort).toBe(51904);
  });

  it('is discarded when it is not a usable port', () => {
    expect(sanitizeSettings({ lastServerPort: 70_000 }, DEFAULTS).lastServerPort).toBeUndefined();
    expect(sanitizeSettings({ lastServerPort: 'abc' }, DEFAULTS).lastServerPort).toBeUndefined();
  });
});
