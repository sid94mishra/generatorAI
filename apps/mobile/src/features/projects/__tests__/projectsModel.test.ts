import { describe, expect, it } from 'vitest';
import type { WorktreeListItem } from '@generatorai/shared';

import {
  codebaseBodies,
  codebaseBody,
  codebaseDraftError,
  codebaseHealth,
  codebaseLocation,
  filterProjects,
  frontmatterField,
  logProgress,
  mergeArtifacts,
  orphanCleanup,
  projectCounts,
  projectMenu,
  projectTab,
  settingsChangeCount,
  settingsDraftFrom,
  settingsPatch,
  toggleDisabled,
  uniqueAlias,
  uploadPlan,
  validateGitUrl,
  validateProjectName,
  worktreeCounts,
  EMPTY_CODEBASE_DRAFT,
} from '../model/projectsModel';

describe('names and URLs', () => {
  it('validates project names and remote URLs', () => {
    expect(validateProjectName('  ')).toMatch(/name/);
    expect(validateProjectName('payments')).toBeNull();
    expect(validateGitUrl('https://github.com/acme/app.git')).toBeNull();
    expect(validateGitUrl('git@github.com:acme/app.git')).toBeNull();
    expect(validateGitUrl('/srv/repo')).toMatch(/https/);
    expect(validateGitUrl('https://github.com')).not.toBeNull();
  });

  it('makes aliases unique', () => {
    expect(uniqueAlias('api', ['API', 'api-2'])).toBe('api-3');
  });
});

describe('codebase drafts', () => {
  it('builds the link body per source kind', () => {
    expect(codebaseBody({ ...EMPTY_CODEBASE_DRAFT, location: 'https://github.com/acme/Payments-API.git', branch: 'main' })).toEqual({
      alias: 'payments-api',
      type: 'git-remote',
      url: 'https://github.com/acme/Payments-API.git',
      defaultBranch: 'main',
    });
    expect(codebaseBody({ kind: 'local-dir', location: '/srv/docs/', alias: '', branch: 'ignored', subdirectory: 'site' })).toEqual({
      alias: 'docs',
      type: 'local-dir',
      localPath: '/srv/docs/',
      subdirectory: 'site',
    });
    expect(codebaseBodies([
      { ...EMPTY_CODEBASE_DRAFT, location: 'https://x.org/a/app' },
      { ...EMPTY_CODEBASE_DRAFT, location: 'https://y.org/b/app' },
    ]).map((b) => b.alias)).toEqual(['app', 'app-2']);
  });

  it('requires a URL or a server path', () => {
    expect(codebaseDraftError(EMPTY_CODEBASE_DRAFT)).toMatch(/URL/);
    expect(codebaseDraftError({ ...EMPTY_CODEBASE_DRAFT, kind: 'git-local' })).toMatch(/folder/);
    expect(codebaseDraftError({ ...EMPTY_CODEBASE_DRAFT, kind: 'git-local', location: 'C:\\repos\\app' })).toBeNull();
  });
});

describe('settings', () => {
  it('patches only what changed and counts the changes', () => {
    const saved = settingsDraftFrom({ settings: { worktreeRetention: 'hours-72', maxCodebases: 5 } });
    expect(settingsPatch(saved, saved)).toBeNull();
    const draft = { ...saved, maxCodebases: 99 };
    expect(settingsPatch(saved, draft)).toEqual({ settings: { maxCodebases: 50 } });
    expect(settingsChangeCount(saved, { worktreeRetention: 'manual', maxCodebases: 6 })).toBe(2);
    expect(settingsDraftFrom({}).worktreeRetention).toBe('hours-24');
  });
});

describe('project list', () => {
  const projects = [
    { name: 'payments', description: 'Checkout', status: 'active' },
    { name: 'old', status: 'archived' },
  ];
  it('filters by scope and search; counts leave unknown fields out', () => {
    expect(filterProjects(projects, 'active', 'check').map((p) => p.name)).toEqual(['payments']);
    expect(filterProjects(projects, 'archived', '').map((p) => p.name)).toEqual(['old']);
    expect(projectCounts({ codebases: 1, activeChats: 3 })).toEqual(['1 codebase', '3 chats']);
    expect(projectCounts({ codebases: 2 })).toEqual(['2 codebases']);
  });
  it('menus follow the edit scope and the archived state', () => {
    const ids = (m: ReturnType<typeof projectMenu>) => m.filter((e) => 'id' in e).map((e) => (e as { id: string }).id);
    expect(ids(projectMenu({ status: 'active', rootPath: '/p' }, true))).toEqual(['open', 'new-chat', 'run-workflow', 'add-codebase', 'copy-path', 'settings', 'archive', 'delete']);
    expect(ids(projectMenu({ status: 'archived' }, true))).toContain('unarchive');
    expect(ids(projectMenu({ status: 'active' }, false))).toEqual(['open', 'new-chat', 'run-workflow', 'settings']);
    expect(projectTab('pull-requests')).toBe('pull-requests');
    expect(projectTab('nope')).toBe('codebases');
  });
});

describe('codebases and worktrees', () => {
  it('shortens locations and maps health', () => {
    expect(codebaseLocation({ type: 'git-remote', url: 'https://github.com/acme/api.git' })).toBe('github.com/acme/api');
    expect(codebaseLocation({ type: 'git-local', localPath: '/srv/app' })).toBe('/srv/app');
    expect(codebaseHealth('cloning')).toMatchObject({ label: 'Cloning', busy: true });
    expect(codebaseHealth('weird')).toMatchObject({ tone: 'idle', label: 'weird' });
  });
  it('counts worktrees and sizes the orphan clean-up only when every size is known', () => {
    const w = (id: string, status: string, sizeBytes?: number) => ({ id, status, branchName: id, sizeBytes }) as unknown as WorktreeListItem;
    expect(worktreeCounts([w('a', 'active'), w('b', 'orphaned'), w('c', 'orphaned')])).toEqual({ all: 3, active: 1, orphaned: 2, completed: 0 });
    expect(orphanCleanup([w('b', 'orphaned', 10), w('c', 'orphaned', 20), w('d', 'active', 5)]).bytes).toBe(30);
    expect(orphanCleanup([w('b', 'orphaned', 10), w('c', 'orphaned')]).bytes).toBeNull();
  });
  it('reads git progress from the newest line', () => {
    expect(logProgress([{ ts: 't', stream: 'stderr', text: 'Counting objects: 100% (4/4), done.' }, { ts: 't', stream: 'stderr', text: 'Receiving objects:  12% (1/8)\rReceiving objects:  38% (694/1824)' }])).toEqual({
      percent: 38,
      phase: 'Receiving objects · 694 / 1824',
    });
    expect(logProgress([{ ts: 't', stream: 'stdout', text: '$ git fetch' }])).toBeNull();
  });
});

describe('customization', () => {
  it('merges system and project artifacts, project shadowing system', () => {
    const merged = mergeArtifacts(
      [{ id: 's1', type: 'skill', name: 'documentation' }, { id: 's2', type: 'skill', name: 'Testing' }, { id: 'p0', type: 'prompt', name: 'x' }],
      [{ id: 'p1', type: 'skill', name: 'testing', description: 'ours' }],
      'skill',
    );
    expect(merged.map((m) => [m.id, m.source])).toEqual([['p1', 'project'], ['s1', 'system']]);
  });
  it('toggles one entry in the disabled set', () => {
    const off = toggleDisabled([], 'skill', 'a', false);
    expect(off).toEqual([{ type: 'skill', id: 'a' }]);
    expect(toggleDisabled(off, 'skill', 'a', true)).toEqual([]);
  });
  it('plans uploads from frontmatter', () => {
    const md = '---\nname: Checkout E2E\ndescription: "Run the suite"\n---\nbody';
    expect(frontmatterField(md, 'description')).toBe('Run the suite');
    expect(uploadPlan('skill', 'SKILL.md', md)).toEqual({ name: 'Checkout E2E', filePath: 'checkout-e2e/SKILL.md', description: 'Run the suite' });
    expect(uploadPlan('prompt', 'review.md', 'no frontmatter')).toEqual({ name: 'review', filePath: 'review.md' });
  });
});
