// ────────────────────────────────────────────────────────────────
// Config migration and salvage (open question #37).
//
// The audit asks for migration tests and the tracker deferred them for want
// of a released prior version. That reasoning was wrong in one important
// way: `CONFIG_VERSION` is 2, so a version 1 exists, and the code had no
// migration at ALL — it replaced anything it could not parse with defaults.
//
// Since `config set` reads through that path and then writes the result
// back, a single unrecognised key destroyed every setting the user had ever
// changed, silently. That is testable today, without a release, and these
// are the tests for it.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { CONFIG_VERSION } from '../schema.js';
import { describeMigration, migrateConfig } from '../migrate.js';

const current = (overrides: Record<string, unknown> = {}) => ({
  configVersion: CONFIG_VERSION,
  ...overrides,
});

describe('migrateConfig — healthy configs', () => {
  it('leaves a current, valid config alone', () => {
    const result = migrateConfig(current({ tui: { theme: 'gruvbox' }, cli: { pageSize: 100 } }));
    expect(result.changed).toBe(false);
    expect(result.dropped).toEqual([]);
    expect(result.config.tui.theme).toBe('gruvbox');
    expect(result.config.cli.pageSize).toBe(100);
  });

  it('treats an absent config as a first run, not as a migration', () => {
    for (const empty of [undefined, null]) {
      const result = migrateConfig(empty);
      expect(result.changed).toBe(false);
      expect(result.dropped).toEqual([]);
      expect(describeMigration(result)).toBeNull();
    }
  });
});

describe('migrateConfig — salvage', () => {
  it('KEEPS every valid setting when one key is bad', () => {
    // The bug this exists for: the old code returned defaults here, and
    // `config set` then wrote those defaults over the user's file.
    const result = migrateConfig(
      current({
        tui: { theme: 'gruvbox', accent: 'chartreuse' },
        server: { url: 'https://example.test', timeoutMs: 5000 },
      }),
    );

    expect(result.config.tui.theme).toBe('gruvbox');
    expect(result.config.server.url).toBe('https://example.test');
    expect(result.config.server.timeoutMs).toBe(5000);
    // Only the bad one is lost, and it falls back to its default.
    expect(result.config.tui.accent).toBe('blue');
    expect(result.dropped.map((d) => d.path)).toEqual(['tui.accent']);
  });

  it('keeps other SECTIONS when one section is the wrong type entirely', () => {
    const result = migrateConfig(current({ tui: 'not an object', cli: { pageSize: 25 } }));
    expect(result.config.cli.pageSize).toBe(25);
    expect(result.dropped.map((d) => d.path)).toContain('tui');
  });

  it('salvages a version 1 file, keeping what the current schema still accepts', () => {
    // A plausible older layout: keys that survived, plus one that did not.
    const result = migrateConfig({
      configVersion: 1,
      server: { url: 'https://old.example', apiKey: 'legacy-key' },
      cli: { output: 'json', legacyPagination: true },
      tui: { theme: 'nord' },
    });

    expect(result.fromVersion).toBe(1);
    expect(result.changed).toBe(true);
    expect(result.config.configVersion).toBe(CONFIG_VERSION);
    expect(result.config.server.url).toBe('https://old.example');
    expect(result.config.server.apiKey).toBe('legacy-key');
    expect(result.config.cli.output).toBe('json');
    expect(result.config.tui.theme).toBe('nord');
    expect(result.dropped.map((d) => d.path)).toContain('cli.legacyPagination');
  });

  it('records WHY each dropped setting was dropped, not just that it was', () => {
    const result = migrateConfig(current({ cli: { pageSize: 99999 } }));
    expect(result.dropped[0]?.path).toBe('cli.pageSize');
    expect(result.dropped[0]?.reason.length).toBeGreaterThan(0);
  });

  it('preserves connections and profiles, which are the most expensive to lose', () => {
    const connection = {
      serverId: 'srv-1',
      label: 'work',
      endpoint: 'https://work.example',
      endpoints: [],
      kind: 'remote' as const,
      managed: false,
      lastConnectedAt: null,
    };
    const result = migrateConfig({
      configVersion: 1,
      connections: [connection],
      profiles: { staging: { tui: { theme: 'nord' } } },
      activeConnection: 'srv-1',
      tui: { accent: 'nonsense' },
    });

    expect(result.config.connections).toHaveLength(1);
    expect(result.config.connections[0]?.serverId).toBe('srv-1');
    expect(result.config.profiles['staging']?.tui?.theme).toBe('nord');
    expect(result.config.activeConnection).toBe('srv-1');
  });

  it('always returns a config the schema accepts, whatever the input', () => {
    for (const nonsense of [42, 'string', [], true, { configVersion: 'two' }, { tui: [] }]) {
      const result = migrateConfig(nonsense);
      expect(result.config.configVersion).toBe(CONFIG_VERSION);
      expect(result.config.tui).toBeDefined();
      expect(result.config.server).toBeDefined();
    }
  });

  it('upgrades an unversioned file rather than treating it as current', () => {
    const result = migrateConfig({ tui: { theme: 'nord' } });
    expect(result.fromVersion).toBeNull();
    expect(result.changed).toBe(true);
    expect(result.config.tui.theme).toBe('nord');
  });
});

describe('describeMigration', () => {
  it('says nothing when nothing changed', () => {
    expect(describeMigration(migrateConfig(current()))).toBeNull();
  });

  it('names the version it came from and every setting it could not keep', () => {
    const message = describeMigration(
      migrateConfig({ configVersion: 1, tui: { accent: 'nonsense' } }),
    )!;
    expect(message).toContain('config version 1');
    expect(message).toContain(String(CONFIG_VERSION));
    expect(message).toContain('tui.accent');
  });

  it('reports a clean upgrade without claiming anything was lost', () => {
    const message = describeMigration(migrateConfig({ configVersion: 1, tui: { theme: 'nord' } }))!;
    expect(message).toContain('Upgraded');
    expect(message).not.toContain('dropping');
  });
});
