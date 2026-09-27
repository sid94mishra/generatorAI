import { describe, expect, it } from 'vitest';

import {
  codebaseLocation,
  isQuietCodebaseStatus,
  mostRecent,
  orderBranches,
  projectRuns,
  readinessFacts,
  repoSlugFromUrl,
  runTone,
  runsNeedingYou,
  showsFetchState,
  statusFacts,
} from '../components/work/projectModel';

describe('projectRuns', () => {
  const runs = [
    { id: 'a', workflowDefinitionId: 'wf-1', status: 'running' },
    { id: 'b', workflowDefinitionId: 'wf-other', status: 'failed', projectId: 'p1' },
    { id: 'c', workflowDefinitionId: 'wf-other', status: 'completed', projectId: 'p2' },
    { id: 'd', workflowDefinitionId: 'wf-2', status: 'paused' },
    { id: 'e', workflowDefinitionId: 'wf-3', status: 'completed', variables: {} },
  ];

  it('keeps runs of the project workflows and runs started for the project', () => {
    expect(projectRuns(runs, ['wf-1', 'wf-2'], 'p1').map((r) => r.id)).toEqual(['a', 'b', 'd']);
  });

  it('returns nothing for a project with no workflows and no tagged runs', () => {
    expect(projectRuns(runs, [], 'p9')).toEqual([]);
  });

  it('selects runs needing a person', () => {
    const withTimes = runs.map((r, i) => ({ ...r, updatedAt: 1000 + i }));
    expect(runsNeedingYou(withTimes).map((r) => r.id)).toEqual(['d', 'b']);
  });

  it('gives each run exactly one tone', () => {
    expect(runTone('failed')).toBe('danger');
    expect(runTone('paused')).toBe('warning');
    expect(runTone('running')).toBe('info');
    expect(runTone('completed')).toBe('success');
    expect(runTone('cancelled')).toBe('neutral');
  });
});

describe('mostRecent', () => {
  it('sorts newest first across ISO strings and epoch numbers, capped at the limit', () => {
    const items = [
      { id: 'old', updatedAt: '2026-01-01T00:00:00Z' },
      { id: 'new', updatedAt: Date.parse('2026-09-01T00:00:00Z') },
      { id: 'mid', updatedAt: '2026-05-01T00:00:00Z' },
      { id: 'bad', updatedAt: 'not a date' },
    ];
    expect(mostRecent(items, 2).map((i) => i.id)).toEqual(['new', 'mid']);
    expect(mostRecent(items, 10).map((i) => i.id)).toEqual(['new', 'mid', 'old', 'bad']);
  });

  it('falls back to createdAt and does not mutate its input', () => {
    const items = [
      { id: 'x', createdAt: 1 },
      { id: 'y', createdAt: 5 },
    ];
    expect(mostRecent(items, 5).map((i) => i.id)).toEqual(['y', 'x']);
    expect(items[0]!.id).toBe('x');
    expect(mostRecent(items, 0)).toEqual([]);
  });
});

describe('codebaseLocation', () => {
  it('shortens an https URL to owner/repo', () => {
    expect(
      codebaseLocation({ type: 'git-remote', url: 'https://github.com/acme/widgets.git' }),
    ).toEqual({ primary: 'acme/widgets', secondary: 'https://github.com/acme/widgets.git' });
    expect(repoSlugFromUrl('https://gitlab.com/group/sub/project/')).toBe('sub/project');
  });

  it('shortens an scp-style ssh URL', () => {
    expect(codebaseLocation({ type: 'git-remote', url: 'git@github.com:acme/widgets.git' }).primary).toBe(
      'acme/widgets',
    );
    expect(repoSlugFromUrl('ssh://git@host.example:2222/acme/widgets.git')).toBe('acme/widgets');
  });

  it('uses the last folder of a long posix path', () => {
    const path = '/Users/someone/Desktop/Projects/clients/very-long-folder-name/generatorAI';
    expect(codebaseLocation({ type: 'git-local', localPath: path })).toEqual({
      primary: 'generatorAI',
      secondary: path,
    });
  });

  it('handles Windows backslashes', () => {
    expect(
      codebaseLocation({ type: 'local-dir', localPath: 'C:\\Users\\dev\\source\\repos\\MyApp' }).primary,
    ).toBe('MyApp');
  });

  it('ignores trailing separators', () => {
    expect(codebaseLocation({ type: 'local-dir', localPath: '/srv/code/app/' }).primary).toBe('app');
    expect(codebaseLocation({ type: 'local-dir', localPath: 'D:\\work\\api\\\\' }).primary).toBe('api');
    expect(codebaseLocation({ type: 'local-dir', localPath: '/' }).primary).toBe('/');
  });

  it('falls back to the alias when there is no location', () => {
    expect(codebaseLocation({ type: 'git-remote', alias: 'web' })).toEqual({ primary: 'web', secondary: '' });
  });
});

describe('showsFetchState', () => {
  it('is only true for remotes', () => {
    expect(showsFetchState('git-remote')).toBe(true);
    expect(showsFetchState('git-local')).toBe(false);
    expect(showsFetchState('local-dir')).toBe(false);
    expect(showsFetchState(undefined)).toBe(false);
  });

  it('treats ready as the quiet status', () => {
    expect(isQuietCodebaseStatus('ready')).toBe(true);
    expect(isQuietCodebaseStatus('error')).toBe(false);
  });
});

describe('defensive facts', () => {
  it('reads the key readiness facts and skips unknown shapes', () => {
    expect(readinessFacts(null)).toEqual([]);
    expect(readinessFacts(['x'])).toEqual([]);
    const facts = readinessFacts({
      branch: 'feature/x',
      dirty: true,
      changedFiles: 3,
      ahead: 2,
      behind: 0,
      hasRemote: true,
      connected: false,
      conflictedFiles: ['a.ts'],
      unknown: { nested: true },
    });
    expect(facts.map((f) => `${f.label}: ${f.value}`)).toEqual([
      'Current branch: feature/x',
      'Working tree: 3 changed files',
      'Upstream: 2 ahead · 0 behind',
      'Account: Not connected',
      'Conflicts: 1 file',
    ]);
  });

  it('reads status facts', () => {
    expect(statusFacts({ status: 'error', lastError: 'auth failed' })).toEqual({
      status: 'error',
      lastError: 'auth failed',
      clonePath: null,
    });
    expect(statusFacts('nope')).toEqual({ status: null, lastError: null, clonePath: null });
  });

  it('orders branches with the default first', () => {
    expect(orderBranches(['dev', 'main', 'x'], 'main')).toEqual(['main', 'dev', 'x']);
    expect(orderBranches({ not: 'an array' }, 'main')).toEqual([]);
    expect(orderBranches(['dev', 7], 'main')).toEqual(['dev']);
  });
});
