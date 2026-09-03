// ────────────────────────────────────────────────────────────────
// Settings, as an editable list (Phase 8 item 6).
//
// Two failure modes matter here, and neither is visible on screen:
//
//  1. Offering a key `config set` cannot write — the row appears editable,
//     the write is accepted, and the value silently never applies.
//  2. Writing a value the schema rejects — `config set` writes first and the
//     schema only rejects on the NEXT load, by which point the file on disk
//     is already broken.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { CliConfigSchema, DEFAULT_CONFIG } from '../schema.js';
import { settingRows, validateSettingValue } from '../settingsView.js';

const defaults = () => JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as Record<string, unknown>;
const rowFor = (key: string, config = defaults()) =>
  settingRows(config).find((row) => row.key === key);

describe('settingRows', () => {
  it('flattens nested config into the dotted keys `config set` takes', () => {
    const keys = settingRows(defaults()).map((row) => row.key);
    expect(keys).toContain('tui.theme');
    expect(keys).toContain('cli.pageSize');
    expect(keys).toContain('server.timeoutMs');
  });

  it('excludes the sub-trees that are managed by their own commands', () => {
    // Flattening `connections` would offer `connections.0.endpoint`, which
    // `config set` writes as a plain string into a structured entry.
    const keys = settingRows(defaults()).map((row) => row.key);
    expect(keys.some((k) => k.startsWith('connections'))).toBe(false);
    expect(keys.some((k) => k.startsWith('profiles'))).toBe(false);
    expect(keys.some((k) => k.startsWith('keymap'))).toBe(false);
    expect(keys).not.toContain('configVersion');
  });

  it('marks nothing as overridden for a pristine default config', () => {
    expect(settingRows(defaults()).filter((row) => row.overridden)).toEqual([]);
  });

  it('marks exactly the changed key as overridden, with its default beside it', () => {
    const config = defaults();
    (config['tui'] as Record<string, unknown>)['theme'] = 'gruvbox';
    const row = rowFor('tui.theme', config)!;
    expect(row.overridden).toBe(true);
    expect(row.value).toBe('gruvbox');
    expect(row.defaultValue).toBe('auto');
    expect(settingRows(config).filter((r) => r.overridden)).toHaveLength(1);
  });

  it('classifies types so the editor offers the right control', () => {
    expect(rowFor('tui.mouse')?.type).toBe('boolean');
    expect(rowFor('tui.refreshMs')?.type).toBe('number');
    expect(rowFor('tui.accent')?.type).toBe('enum');
    expect(rowFor('tui.accent')?.choices).toContain('violet');
    expect(rowFor('tui.theme')?.type).toBe('string');
  });

  it('says when each setting takes effect', () => {
    // A settings screen that silently needs a restart for half its rows
    // teaches people that settings do not work.
    expect(rowFor('tui.theme')?.effect).toBe('live');
    expect(rowFor('tui.alternateScreen')?.effect).toBe('restart');
    expect(rowFor('cli.pageSize')?.effect).toBe('next-command');
  });

  it('is sorted, so the same key is always in the same place', () => {
    const keys = settingRows(defaults()).map((row) => row.key);
    expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)));
  });

  it('offers only keys the real schema accepts', () => {
    // The contract that makes this pane safe: every row is a key
    // `config set` can write and the schema will accept back.
    for (const row of settingRows(defaults())) {
      expect(validateSettingValue(row.key, row.value), `${row.key} rejected its own current value`).toBeNull();
    }
  });
});

describe('validateSettingValue', () => {
  it('accepts a valid value', () => {
    expect(validateSettingValue('cli.pageSize', '100')).toBeNull();
    expect(validateSettingValue('tui.accent', 'violet')).toBeNull();
    expect(validateSettingValue('tui.mouse', 'true')).toBeNull();
  });

  it('rejects a number outside the schema\'s range, naming the field', () => {
    const problem = validateSettingValue('cli.pageSize', '9999');
    expect(problem).toBeTruthy();
    expect(problem).toContain('cli.pageSize');
  });

  it('rejects a value outside an enum', () => {
    expect(validateSettingValue('tui.accent', 'chartreuse')).toBeTruthy();
  });

  it('coerces the way `config set` does, so booleans and numbers survive', () => {
    // `config set` writes strings; a validator that checked the STRING would
    // reject every boolean and number setting.
    expect(validateSettingValue('tui.mouse', 'false')).toBeNull();
    expect(validateSettingValue('server.timeoutMs', '5000')).toBeNull();
  });

  it('rejects a key that is not a setting at all', () => {
    expect(validateSettingValue('tui.nonsense', 'x')).toContain('not a setting');
    expect(validateSettingValue('nope.nothing', 'x')).toContain('not a setting');
  });

  it('never mutates the shared default config while validating', () => {
    // It builds its candidate from `DEFAULT_CONFIG`; mutating that in place
    // would leak a rejected value into every later read.
    const before = JSON.stringify(DEFAULT_CONFIG);
    validateSettingValue('cli.pageSize', '9999');
    validateSettingValue('tui.accent', 'violet');
    expect(JSON.stringify(DEFAULT_CONFIG)).toBe(before);
    expect(CliConfigSchema.safeParse(DEFAULT_CONFIG).success).toBe(true);
  });
});
