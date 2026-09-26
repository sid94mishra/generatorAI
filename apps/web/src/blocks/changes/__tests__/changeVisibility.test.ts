import { describe, expect, it } from 'vitest';
import type { ChangeSummary } from '@/types/changes.js';
import { splitWorkspaceChanges } from '../changeVisibility.js';

const file = (path: string, additions = 1, deletions = 0) => ({
  path,
  status: 'modified' as const,
  additions,
  deletions,
  isBinary: false,
  isTooLarge: false,
});

function summary(repos: ChangeSummary['repos']): ChangeSummary {
  return {
    workspaceId: 'ws',
    hasGit: true,
    base: { kind: 'baseline' },
    head: { kind: 'working' },
    repos,
    stats: repos.reduce(
      (a, r) => ({ files: a.files + r.stats.files, additions: a.additions + r.stats.additions, deletions: a.deletions + r.stats.deletions }),
      { files: 0, additions: 0, deletions: 0 },
    ),
  };
}

const linked = {
  alias: 'todo-api',
  kind: 'linked' as const,
  hasBaseline: true,
  files: [file('src/a.js', 5), file('src/b.js', 2, 1)],
  stats: { files: 2, additions: 7, deletions: 1 },
};
const root = {
  alias: '.',
  kind: 'root' as const,
  hasBaseline: true,
  files: [file('orchestrator/state.json', 0, 22), file('tasks/x/SUMMARY.md', 9)],
  stats: { files: 2, additions: 9, deletions: 22 },
};

describe('splitWorkspaceChanges', () => {
  it('hides root-workspace files when a codebase repo is present', () => {
    const r = splitWorkspaceChanges(summary([root, linked]), false);
    expect(r.hiddenWorkspaceFiles).toBe(2);
    expect(r.visible?.repos.map((x) => x.alias)).toEqual(['todo-api']);
    expect(r.visible?.stats).toEqual({ files: 2, additions: 7, deletions: 1 });
  });

  it('keeps root files when they are the only repo (ad-hoc workspace)', () => {
    const r = splitWorkspaceChanges(summary([root]), false);
    expect(r.hiddenWorkspaceFiles).toBe(0);
    expect(r.visible?.repos).toHaveLength(1);
  });

  it('shows everything when the toggle is on', () => {
    const r = splitWorkspaceChanges(summary([root, linked]), true);
    expect(r.hiddenWorkspaceFiles).toBe(0);
    expect(r.visible?.repos).toHaveLength(2);
  });

  it('reports nothing hidden when the root repo has no changes', () => {
    const r = splitWorkspaceChanges(summary([{ ...root, files: [], stats: { files: 0, additions: 0, deletions: 0 } }, linked]), false);
    expect(r.hiddenWorkspaceFiles).toBe(0);
    expect(r.visible?.repos).toHaveLength(2);
  });

  it('passes an absent summary through', () => {
    expect(splitWorkspaceChanges(undefined, false)).toEqual({ visible: undefined, hiddenWorkspaceFiles: 0 });
  });
});
