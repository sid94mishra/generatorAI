import { describe, expect, it } from 'vitest';

import {
  crumbsFor,
  isImagePath,
  isMarkdownPath,
  levelEntries,
  parentPrefix,
  prefixOf,
  searchEntries,
} from './fileTree';

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

describe('virtual tree (MB-25)', () => {
  it('flattens expanded folders under their parent and marks changes', async () => {
    const { flattenTree, searchRows, ancestorPrefixes } = await import('./fileTree');
    const changed = new Map([['src/app/App.tsx', 'modified' as const]]);
    const closed = flattenTree(PATHS, new Set(), changed);
    expect(closed.map((r) => `${r.depth}:${r.name}${r.dirty ? '*' : ''}`)).toEqual(['0:src*', '0:srcx', '0:test', '0:README.md']);
    const open = flattenTree(PATHS, new Set(['src/', 'src/app/']), changed);
    expect(open.map((r) => `${r.depth}:${r.name}`)).toEqual(['0:src', '1:app', '2:App.tsx', '2:util.ts', '1:lib', '1:index.ts', '0:srcx', '0:test', '0:README.md']);
    expect(open.find((r) => r.name === 'App.tsx')).toMatchObject({ status: 'modified', dirty: true });
    expect(searchRows(PATHS, 'util', changed).map((r) => r.name)).toEqual(['src/app/util.ts']);
    expect(ancestorPrefixes('src/app/App.tsx')).toEqual(['src/', 'src/app/']);
  });
});
