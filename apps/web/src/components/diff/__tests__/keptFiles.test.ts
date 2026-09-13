// Kept-file grouping for the Changes tab.

import { describe, it, expect } from 'vitest';
import { splitKeptFiles } from '../ChangesSurface.js';
import type { ChangeSummary, ChangeSummaryFile } from '@/types/changes.js';

const file = (path: string, kept?: boolean): ChangeSummaryFile => ({
  path,
  status: 'modified',
  additions: 1,
  deletions: 0,
  isBinary: false,
  isTooLarge: false,
  ...(kept ? { kept: true } : {}),
});

const summary = (repos: ChangeSummary['repos']): ChangeSummary => ({
  workspaceId: 'ws',
  hasGit: true,
  base: { kind: 'baseline' },
  head: { kind: 'working' },
  repos,
  stats: {
    files: repos.reduce((n, r) => n + r.files.length, 0),
    additions: 0,
    deletions: 0,
  },
});

const repo = (alias: string, files: ChangeSummaryFile[]): ChangeSummary['repos'][number] => ({
  alias,
  kind: 'mount',
  hasBaseline: true,
  stats: { files: files.length, additions: 0, deletions: 0 },
  files,
});

describe('splitKeptFiles', () => {
  it('returns the summary untouched when nothing is kept', () => {
    const s = summary([repo('.', [file('a.txt'), file('b.txt')])]);
    const out = splitKeptFiles(s);
    expect(out.keptCount).toBe(0);
    expect(out.pending).toBe(s);
    expect(out.kept).toBeUndefined();
  });

  it('splits kept files out while preserving repo identity', () => {
    const out = splitKeptFiles(
      summary([
        repo('.', [file('a.txt', true), file('b.txt')]),
        repo('api', [file('src/c.ts', true)]),
      ]),
    );
    expect(out.keptCount).toBe(2);
    // The pending side drops a repo that has nothing left to review, so no
    // empty group is rendered.
    expect(out.pending!.repos.map((r) => r.alias)).toEqual(['.']);
    expect(out.pending!.repos[0]!.files.map((f) => f.path)).toEqual(['b.txt']);
    expect(out.kept!.repos.map((r) => r.alias)).toEqual(['.', 'api']);
    expect(out.kept!.repos[0]!.files.map((f) => f.path)).toEqual(['a.txt']);
  });

  it('leaves an empty pending list when everything is kept', () => {
    const out = splitKeptFiles(summary([repo('.', [file('a.txt', true)])]));
    expect(out.pending!.repos).toEqual([]);
    expect(out.keptCount).toBe(1);
  });

  it('handles an absent summary', () => {
    expect(splitKeptFiles(undefined)).toEqual({
      pending: undefined,
      kept: undefined,
      keptCount: 0,
    });
  });
});
