import { describe, expect, it } from 'vitest';
import type { SearchResult } from '@generatorai/shared';

import { buildPalette, flatRows, highlightRange, matchRank, parseRecents, rememberRecent } from './paletteModel';
import { nextThemeMode, themeToggleHint } from '../shell/themeCycle';

const base = { offline: false, themeHint: 'Dark → System', actions: ['chat.new', 'theme.toggle', 'app.settings'] as const };
const hit = (type: SearchResult['type'], id: string, title: string): SearchResult => ({ type, id, title, href: `/${type}s/${id}` });

describe('search palette model (MB-21)', () => {
  it('shows Recent, Actions, Go to and Recent chats for an empty query', () => {
    const groups = buildPalette({
      ...base,
      query: '',
      recents: [{ key: 'nav:chats', title: 'Chats', icon: 'chats', href: '/chats' }],
      recentChats: [{ id: 'c1', name: 'Fix flaky checkout test', live: 'needs_you' }],
    });
    expect(groups.map((g) => g.label)).toEqual(['Recent', 'Actions', 'Go to', 'Recent chats']);
    expect(groups[1]!.rows.map((r) => r.title)).toEqual(['New chat', 'Toggle theme', 'Settings']);
    expect(groups[1]!.rows[1]!.hint).toBe('Dark → System');
    expect(groups[3]!.rows[0]).toMatchObject({ href: '/chats/c1', status: 'needs_you' });
  });

  it('puts server hits first, grouped by type in best-hit order, and filters local rows', () => {
    const groups = buildPalette({
      ...base,
      query: 'work',
      results: [hit('workflow', 'w1', 'Nightly workflow'), hit('project', 'p1', 'Work project'), hit('workflow', 'w2', 'Workbench')],
      recentChats: [],
    });
    expect(groups.map((g) => g.label)).toEqual(['Workflows', 'Projects', 'Go to']);
    expect(groups[0]!.rows.map((r) => r.title)).toEqual(['Nightly workflow', 'Workbench']);
    expect(groups[2]!.rows.map((r) => r.title)).toEqual(['Workflows']);
  });

  it('puts the requested kind first ("Run workflow…")', () => {
    const groups = buildPalette({ ...base, query: 'a', kind: 'workflow', results: [hit('chat', 'c1', 'a chat'), hit('workflow', 'w1', 'a flow')] });
    expect(groups[0]!.label).toBe('Workflows');
  });

  it('keeps only local rows offline, with a note', () => {
    const groups = buildPalette({ ...base, query: '', offline: true, recentChats: [{ id: 'c1', name: 'x' }] });
    expect(groups.map((g) => g.label)).toEqual(['Actions', 'Go to']);
    expect(groups[0]!.note).toMatch(/offline/i);
  });

  it('ranks prefix over substring over fuzzy and highlights the substring', () => {
    expect(matchRank('set', 'Settings')).toBe(0);
    expect(matchRank('tin', 'Settings')).toBe(1);
    expect(matchRank('stg', 'Settings')).toBe(2);
    expect(matchRank('zz', 'Settings')).toBeNull();
    expect(highlightRange('nig', 'Run Nightly')).toEqual({ start: 4, end: 7 });
    expect(flatRows(buildPalette({ ...base, query: 'set' })).map((r) => r.title)).toContain('Settings');
  });

  it('remembers recents newest first without duplicates and parses only safe entries', () => {
    const a = { key: 'a', title: 'A', icon: 'chats' as const, href: '/chats' };
    const b = { key: 'b', title: 'B', icon: 'projects' as const, href: '/projects' };
    expect(rememberRecent([a, b], a).map((e) => e.key)).toEqual(['a', 'b']);
    expect(rememberRecent([a], b, 1)).toEqual([b]);
    expect(parseRecents(JSON.stringify([a, { key: 'x', title: 'X', icon: 'chats', href: 'https://evil' }]))).toEqual([a]);
    expect(parseRecents('{')).toEqual([]);
  });

  it('cycles the theme mode System → Light → Dark', () => {
    expect(nextThemeMode('system')).toBe('light');
    expect(nextThemeMode('dark')).toBe('system');
    expect(themeToggleHint('dark')).toBe('Dark → System');
  });
});
