import { describe, expect, it } from 'vitest';
import { SETTINGS_GROUPS, matchedKeyword, searchSettings, settingsEntries } from '../model/settingsIndex';

const entries = settingsEntries('Widgets & Live Activities');

describe('settings index (MSettings, 04 §1.4)', () => {
  it('has the 15 sections + 4 device rows in four groups', () => {
    expect(entries).toHaveLength(19);
    expect(entries.filter((e) => e.device).map((e) => e.id)).toEqual(['notifications', 'app-lock', 'haptics', 'widgets']);
    expect(SETTINGS_GROUPS.map((g) => g.id)).toEqual(['app', 'agents', 'integrations', 'system']);
    expect(new Set(entries.map((e) => e.group))).toEqual(new Set(['app', 'agents', 'integrations', 'system']));
    expect(entries.find((e) => e.id === 'haptics')?.href).toBeNull();
    expect(entries.find((e) => e.id === 'mcp')?.href).toBe('/settings/mcp');
  });

  it('searches titles, groups and the words inside a section', () => {
    expect(searchSettings(entries, '')).toEqual([]);
    expect(searchSettings(entries, 'appear').map((e) => e.id)).toEqual(['appearance']);
    expect(searchSettings(entries, 'DARK').map((e) => e.id)).toEqual(['appearance']);
    expect(searchSettings(entries, 'github').map((e) => e.id)).toEqual(['source-control']);
    expect(searchSettings(entries, 'integrations audio').map((e) => e.id)).toEqual(['audio']);
    expect(searchSettings(entries, 'zzz')).toEqual([]);
  });

  it('names the keyword that matched when the title did not', () => {
    const appearance = entries.find((e) => e.id === 'appearance')!;
    expect(matchedKeyword(appearance, 'dark')).toBe('dark');
    expect(matchedKeyword(appearance, 'appearance')).toBeNull();
  });
});
