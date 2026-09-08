import { describe, expect, it } from 'vitest';

import {
  crumbsFor,
  isImagePath,
  isMarkdownPath,
  levelEntries,
  parentPrefix,
  prefixOf,
  searchEntries,
} from '../components/chat/workbench/fileTree';
import { describePrompt, formatAliasList, groupCheckpoints } from '../components/review/checkpointGroups';

const PATHS = ['README.md', 'src/index.ts', 'src/app/App.tsx', 'src/app/util.ts', 'src/lib/a.ts', 'test/a.test.ts', 'srcx/other.ts'];

describe('fileTree', () => {
  it('lists folders first, then files, with counts, one level at a time', () => {
    expect(levelEntries(PATHS, '')).toEqual([
      { name: 'src', path: 'src/', isDir: true, count: 4 },
      { name: 'srcx', path: 'srcx/', isDir: true, count: 1 },
      { name: 'test', path: 'test/', isDir: true, count: 1 },
      { name: 'README.md', path: 'README.md', isDir: false },
    ]);
    expect(levelEntries(PATHS, 'src/').map((e) => e.name)).toEqual(['app', 'lib', 'index.ts']);
  });

  it('does not confuse a sibling prefix (src vs srcx)', () => {
    expect(levelEntries(PATHS, 'src/').some((e) => e.name === 'other.ts')).toBe(false);
  });

  it('walks up with parentPrefix and derives a file prefix', () => {
    expect(crumbsFor('src/app/')).toEqual(['src', 'app']);
    expect(parentPrefix('src/app/')).toBe('src/');
    expect(parentPrefix('src/')).toBe('');
    expect(prefixOf('src/app/App.tsx')).toBe('src/app/');
    expect(prefixOf('README.md')).toBe('');
  });

  it('search ranks a filename hit above a folder hit and is case-insensitive', () => {
    const hits = searchEntries(PATHS, 'APP').map((e) => e.path);
    expect(hits[0]).toBe('src/app/App.tsx');
    expect(hits).toContain('src/app/util.ts');
    expect(searchEntries(PATHS, '   ')).toEqual([]);
    expect(searchEntries(PATHS, 'ts', 2)).toHaveLength(2);
  });

  it('classifies images and markdown by extension', () => {
    expect(isImagePath('a/b.PNG')).toBe(true);
    expect(isImagePath('a/b.ts')).toBe(false);
    expect(isMarkdownPath('docs/x.MDX')).toBe(true);
  });
});

describe('checkpointGroups', () => {
  const row = (id: string, extra: Record<string, unknown>) =>
    ({ id, workspaceId: 'w', repoAlias: '.', kind: 'turn', createdAt: 1000, fileCount: 0, ...extra }) as never;

  it('groups a turn across mounts and restores the before snapshots', () => {
    const groups = groupCheckpoints([
      row('a1', { turnId: 't1', phase: 'after', repoAlias: 'api', seq: 4, fileCount: 2, additions: 5, deletions: 1, createdAt: 2000 }),
      row('b1', { turnId: 't1', phase: 'before', repoAlias: 'api', seq: 3, createdAt: 1500 }),
      row('b2', { turnId: 't1', phase: 'before', repoAlias: 'web', seq: 3, createdAt: 1400 }),
      row('live', { kind: 'live' }),
      row('base', { kind: 'baseline', createdAt: 100 }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['turn:t1', 'cp:base']);
    const turn = groups[0]!;
    expect(turn.undoesTurn).toBe(true);
    expect(turn.restoreTargets.map((c) => c.id).sort()).toEqual(['b1', 'b2']);
    expect(turn.aliases).toEqual(['api', 'web']);
    expect(turn.createdAt).toBe(1400);
    expect(turn).toMatchObject({ fileCount: 2, additions: 5, deletions: 1, compareValue: 'turn:t1' });
    expect(groups[1]).toMatchObject({ label: 'Session start', compareValue: 'checkpoint:base' });
  });

  it('formats alias lists and summarises review prompts', () => {
    expect(formatAliasList(['.'])).toBe('the workspace');
    expect(formatAliasList(['a', 'b', 'c'])).toBe('a, b and c');
    expect(describePrompt('plain prompt')).toBe('plain prompt');
    expect(describePrompt('<review_feedback><file path="a.ts"><comment intent="fix">rename it</comment>')).toBe('Review: rename it');
    expect(describePrompt('<review_feedback><file path="a.ts">')).toBe('Review on a.ts');
  });
});
