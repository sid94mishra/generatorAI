import { describe, expect, it } from 'vitest';
import type { WorkspaceCheckpoint } from '@generatorai/client-core';

import type { ChangeRow } from './changeKinds';
import { changeSections, commitSummary, compareModeOf, compareModes } from './compareModel';

const cp = (over: Partial<WorkspaceCheckpoint>): WorkspaceCheckpoint => ({ id: 'c', kind: 'turn', repoAlias: '.', createdAt: 1, ...over }) as WorkspaceCheckpoint;
const row = (path: string, alias = 'app', kept = false): ChangeRow => ({ path, alias, id: `${alias}:${path}`, status: 'modified', additions: 1, deletions: 0, isBinary: false, isTooLarge: false, kept });

describe('Changes compare bar and sections (MB-22)', () => {
  it('maps the quick modes onto base selectors, disabled when nothing backs them', () => {
    const modes = compareModes(
      [{ alias: 'app', git: { baseCommit: 'abc', baseRef: 'main' } }],
      [cp({ id: '1', turnId: 't1', createdAt: 10 }), cp({ id: '2', turnId: 't2', createdAt: 20 }), cp({ id: '3', kind: 'baseline', createdAt: 30 })],
    );
    expect(modes).toEqual({ turn: 'turn:t2', branch: { value: 'ref:abc', label: 'Branch vs main' } });
    expect(compareModeOf('baseline', modes)).toBe('chat');
    expect(compareModeOf('turn:t2', modes)).toBe('turn');
    expect(compareModeOf('ref:abc', modes)).toBe('branch');
    expect(compareModeOf('checkpoint:9', modes)).toBe('');
    expect(compareModes([], [])).toEqual({ turn: null, branch: null });
  });

  it('splits review, workspace scaffolding and kept files', () => {
    const sections = changeSections([row('a.ts'), row('notes.md', '.'), row('b.ts', 'app', true)], new Set(['.']));
    expect(sections.map((s) => [s.key, s.rows.map((r) => r.path)])).toEqual([
      ['chat', ['a.ts']],
      ['workspace', ['notes.md']],
      ['kept', ['b.ts']],
    ]);
    // Without a codebase beside it, the root's files are the work itself.
    expect(changeSections([row('script.py', '.')], new Set(['.'])).map((s) => s.key)).toEqual(['chat']);
  });

  it('says what a commit takes and where', () => {
    expect(commitSummary(2, 'fix/checkout-flake')).toEqual({ title: '2 files ready', subtitle: 'into fix/checkout-flake' });
    expect(commitSummary(1, null)).toEqual({ title: '1 file ready', subtitle: null });
  });
});
