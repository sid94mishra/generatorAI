import { describe, expect, it } from 'vitest';

import {
  filterOperations,
  rankOperations,
  type Operation,
} from '../api/activityRanking';
import { crumbsFor, levelEntries } from '../components/chat/workbench/fileTree';

function op(partial: Partial<Operation> & Pick<Operation, 'id' | 'updatedAt'>): Operation {
  return {
    kind: 'run',
    name: partial.id,
    status: 'completed',
    href: '/',
    blocked: false,
    running: false,
    ...partial,
  };
}

describe('rankOperations', () => {
  it('puts blocked work first even when it is the oldest', () => {
    // The entire reason to open this app on a phone.
    const ranked = rankOperations([
      op({ id: 'fresh', updatedAt: 1000 }),
      op({ id: 'blocked', updatedAt: 1, blocked: true }),
      op({ id: 'running', updatedAt: 500, running: true }),
    ]);
    expect(ranked.map((o) => o.id)).toEqual(['blocked', 'running', 'fresh']);
  });

  it('falls back to newest-first among peers', () => {
    const ranked = rankOperations([op({ id: 'old', updatedAt: 1 }), op({ id: 'new', updatedAt: 2 })]);
    expect(ranked.map((o) => o.id)).toEqual(['new', 'old']);
  });

  it('does not mutate its input', () => {
    const input = [op({ id: 'a', updatedAt: 1 }), op({ id: 'b', updatedAt: 2 })];
    rankOperations(input);
    expect(input.map((o) => o.id)).toEqual(['a', 'b']);
  });
});

describe('filterOperations', () => {
  const now = 1_000_000_000;
  const list = [
    op({ id: 'blocked', updatedAt: now - 1000, blocked: true }),
    op({ id: 'running', updatedAt: now - 2000, running: true }),
    op({ id: 'yesterday', updatedAt: now - 25 * 60 * 60 * 1000 }),
  ];

  it('"today" means the last 24 hours, not since midnight', () => {
    // Someone checking at 00:30 wants last night's work, not an empty list.
    expect(filterOperations(list, 'today', now).map((o) => o.id)).toEqual(['blocked', 'running']);
  });

  it('"running" only includes in-flight work', () => {
    expect(filterOperations(list, 'running', now).map((o) => o.id)).toEqual(['running']);
  });

  it('"attention" only includes blocked work', () => {
    expect(filterOperations(list, 'attention', now).map((o) => o.id)).toEqual(['blocked']);
  });
});

describe('levelEntries', () => {
  const paths = [
    'README.md',
    'src/index.ts',
    'src/components/Button.tsx',
    'src/components/Chip.tsx',
  ];

  it('lists directories before files at the root', () => {
    expect(levelEntries(paths, '')).toEqual([
      { name: 'src', path: 'src/', isDir: true },
      { name: 'README.md', path: 'README.md', isDir: false },
    ]);
  });

  it('descends into a prefix without repeating it', () => {
    expect(levelEntries(paths, 'src/')).toEqual([
      { name: 'components', path: 'src/components/', isDir: true },
      { name: 'index.ts', path: 'src/index.ts', isDir: false },
    ]);
  });

  it('keeps the full path on file entries so they can be opened', () => {
    const entries = levelEntries(paths, 'src/components/');
    expect(entries.map((e) => e.path)).toEqual([
      'src/components/Button.tsx',
      'src/components/Chip.tsx',
    ]);
  });

  it('is empty for a prefix that matches nothing', () => {
    expect(levelEntries(paths, 'nope/')).toEqual([]);
  });

  it('does not emit an entry for the prefix itself', () => {
    // A path equal to the prefix would otherwise yield a nameless row.
    expect(levelEntries(['src/', 'src/a.ts'], 'src/')).toEqual([
      { name: 'a.ts', path: 'src/a.ts', isDir: false },
    ]);
  });
});

describe('crumbsFor', () => {
  it('is empty at the root', () => {
    expect(crumbsFor('')).toEqual([]);
  });

  it('drops the trailing slash', () => {
    expect(crumbsFor('src/components/')).toEqual(['src', 'components']);
  });
});
