import { describe, expect, it } from 'vitest';

import {
  aliasFromGitUrl,
  anyCloning,
  breadcrumbs,
  canRemoveWorktree,
  cleanupSummary,
  clampMaxCodebases,
  cloneEvents,
  filePreview,
  formatBytes,
  gitCodebaseBodies,
  globalMcpToggle,
  mcpNeedsConfiguration,
  mcpSwitchValue,
  mcpToggleBody,
  normalizeRelPath,
  parentPath,
  partitionProjects,
  repoDraftErrors,
  settingsDraftFrom,
  settingsPatch,
  uniqueAlias,
  validateGitUrl,
  validateProjectName,
} from '../components/projects/projectEditModel';

describe('project names and git URLs', () => {
  it('requires a trimmed, bounded project name', () => {
    expect(validateProjectName('   ')).toMatch(/name/);
    expect(validateProjectName('x'.repeat(121))).toMatch(/120/);
    expect(validateProjectName(' Payments ')).toBeNull();
  });

  it('accepts https, ssh and scp-style remotes', () => {
    expect(validateGitUrl('https://github.com/acme/api.git')).toBeNull();
    expect(validateGitUrl('ssh://git@github.com/acme/api')).toBeNull();
    expect(validateGitUrl('git@github.com:acme/api.git')).toBeNull();
  });

  it('rejects local paths with the reason a phone cannot link them', () => {
    expect(validateGitUrl('/Users/me/code/api')).toMatch(/machine running GeneratorAI/);
    expect(validateGitUrl('C:\\code\\api')).toMatch(/machine running GeneratorAI/);
    expect(validateGitUrl('~/code')).toMatch(/machine running GeneratorAI/);
  });

  it('rejects blanks, spaces and URLs without a repository', () => {
    expect(validateGitUrl('')).toBeTruthy();
    expect(validateGitUrl('https://github.com/acme api')).toMatch(/spaces/);
    expect(validateGitUrl('github.com')).toBeTruthy();
  });

  it('derives a folder-safe alias from the repo name', () => {
    expect(aliasFromGitUrl('https://github.com/Acme/My Api.git')).toBe('my-api');
    expect(aliasFromGitUrl('git@github.com:acme/web-app.git')).toBe('web-app');
    expect(aliasFromGitUrl('nonsense')).toBe('');
  });

  it('makes aliases unique case-insensitively', () => {
    expect(uniqueAlias('api', ['web'])).toBe('api');
    expect(uniqueAlias('api', ['API', 'api-2'])).toBe('api-3');
    expect(uniqueAlias('  ', [])).toBe('repo');
  });

  it('builds git-remote bodies, dropping blank rows and de-duplicating aliases', () => {
    expect(
      gitCodebaseBodies(
        [
          { url: 'https://github.com/acme/api.git' },
          { url: '   ' },
          { url: 'git@gitlab.com:other/api.git', branch: ' main ' },
          { url: 'https://github.com/acme/web', alias: 'frontend' },
        ],
        ['frontend'],
      ),
    ).toEqual([
      { alias: 'api', type: 'git-remote', url: 'https://github.com/acme/api.git' },
      { alias: 'api-2', type: 'git-remote', url: 'git@gitlab.com:other/api.git', defaultBranch: 'main' },
      { alias: 'frontend-2', type: 'git-remote', url: 'https://github.com/acme/web' },
    ]);
  });

  it('reports errors per row and ignores empty rows', () => {
    expect(repoDraftErrors([{ url: '' }, { url: '/tmp/x' }, { url: 'https://github.com/a/b' }])).toEqual({
      1: expect.stringMatching(/Local folders/),
    });
  });
});

describe('clone progress', () => {
  it('polls only while something is cloning', () => {
    expect(anyCloning([{ id: 'a', alias: 'a', status: 'ready' }])).toBe(false);
    expect(anyCloning([{ id: 'a', alias: 'a', status: 'pending' }])).toBe(true);
    expect(anyCloning(undefined)).toBe(false);
  });

  it('reports transitions out of cloning, with the server error', () => {
    const events = cloneEvents({ a: 'cloning', b: 'pending', c: 'ready', d: 'error' }, [
      { id: 'a', alias: 'api', status: 'ready' },
      { id: 'b', alias: 'web', status: 'error', lastError: ' auth failed ' },
      { id: 'c', alias: 'ops', status: 'error', lastError: 'x' },
      { id: 'd', alias: 'docs', status: 'error' },
      { id: 'e', alias: 'new', status: 'error' },
    ]);
    expect(events).toEqual([
      { kind: 'ready', id: 'a', alias: 'api' },
      { kind: 'failed', id: 'b', alias: 'web', error: 'auth failed' },
    ]);
  });

  it('falls back to a generic failure line', () => {
    expect(cloneEvents({ a: 'cloning' }, [{ id: 'a', alias: 'api', status: 'error' }])[0]).toMatchObject({
      error: 'The clone failed.',
    });
  });
});

describe('project list', () => {
  it('splits archived projects out, keeping order', () => {
    const { active, archived } = partitionProjects([
      { id: '1', status: 'active' },
      { id: '2', status: 'archived' },
      { id: '3' },
    ]);
    expect(active.map((p) => p.id)).toEqual(['1', '3']);
    expect(archived.map((p) => p.id)).toEqual(['2']);
  });
});

describe('project settings', () => {
  const project = { name: 'Payments', description: 'Money', settings: { worktreeRetention: 'manual', maxCodebases: 4 } };

  it('reads a draft defensively', () => {
    expect(settingsDraftFrom(project)).toEqual({
      name: 'Payments',
      description: 'Money',
      worktreeRetention: 'manual',
      maxCodebases: 4,
    });
    expect(settingsDraftFrom({ name: 'X', settings: { worktreeRetention: 'weird', maxCodebases: '9' } })).toEqual({
      name: 'X',
      description: '',
      worktreeRetention: 'hours-24',
      maxCodebases: 10,
    });
  });

  it('clamps max codebases to 1..50', () => {
    expect(clampMaxCodebases(0)).toBe(1);
    expect(clampMaxCodebases(99)).toBe(50);
    expect(clampMaxCodebases(Number.NaN)).toBe(10);
  });

  it('sends only what changed', () => {
    const saved = settingsDraftFrom(project);
    expect(settingsPatch(saved, { ...saved })).toBeNull();
    expect(settingsPatch(saved, { ...saved, name: '  ', maxCodebases: 4 })).toBeNull();
    expect(settingsPatch(saved, { ...saved, name: ' Billing ', worktreeRetention: 'immediate' })).toEqual({
      name: 'Billing',
      settings: { worktreeRetention: 'immediate' },
    });
    expect(settingsPatch(saved, { ...saved, description: '', maxCodebases: 70 })).toEqual({
      description: '',
      settings: { maxCodebases: 50 },
    });
  });
});

describe('worktrees', () => {
  it('never offers to remove a worktree a run is using', () => {
    expect(canRemoveWorktree('active')).toBe(false);
    expect(canRemoveWorktree('orphaned')).toBe(true);
  });

  it('summarises cleanup results of any reasonable shape', () => {
    expect(cleanupSummary({ removed: 2 })).toBe('Removed 2 worktrees.');
    expect(cleanupSummary({ cleaned: ['a'] })).toBe('Removed 1 worktree.');
    expect(cleanupSummary({ removed: 0 })).toBe('Nothing to clean up.');
    expect(cleanupSummary(undefined)).toBe('Cleanup finished.');
  });
});

describe('file browser', () => {
  it('normalises paths and never climbs out of the root', () => {
    expect(normalizeRelPath('src\\app//../index.ts')).toBe('src/app/index.ts');
    expect(normalizeRelPath('../../etc/passwd')).toBe('etc/passwd');
    expect(parentPath('src/app/index.ts')).toBe('src/app');
    expect(parentPath('')).toBe('');
  });

  it('builds breadcrumbs from the root', () => {
    expect(breadcrumbs('src/app')).toEqual([
      { label: 'Root', path: '' },
      { label: 'src', path: 'src' },
      { label: 'app', path: 'src/app' },
    ]);
  });

  it('formats sizes', () => {
    expect(formatBytes(12)).toBe('12 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(undefined)).toBeNull();
  });

  it('detects binary, empty and oversized content', () => {
    expect(filePreview('')).toEqual({ kind: 'empty' });
    expect(filePreview('PNG\u0000\u0001')).toEqual({ kind: 'binary' });
    expect(filePreview('a\nb')).toEqual({ kind: 'text', text: 'a\nb', truncated: false, lines: 2 });
    expect(filePreview('abcdef', 3)).toMatchObject({ text: 'abc', truncated: true });
  });
});

describe('MCP toggles', () => {
  const http = {
    id: 'm1',
    name: 'GitHub',
    serverType: 'http' as const,
    url: 'https://mcp.example.com',
    source: 'custom',
    enabled: false,
    userEnabled: true,
    headers: { Authorization: '••••' },
    env: { IGNORED: '••••' },
    needsConfiguration: { missingInputs: [], missingCredentials: ['TOKEN'] },
  };

  it('shows the user toggle, not the effective state', () => {
    expect(mcpSwitchValue(http)).toBe(true);
    expect(mcpSwitchValue({ name: 'x', enabled: false })).toBe(false);
    expect(mcpNeedsConfiguration(http)).toBe(true);
    expect(mcpNeedsConfiguration({ name: 'x' })).toBe(false);
  });

  it('echoes the redacted credentials so a toggle keeps stored tokens', () => {
    expect(mcpToggleBody(http, false)).toEqual({
      name: 'GitHub',
      serverType: 'http',
      url: 'https://mcp.example.com',
      enabled: false,
      headers: { Authorization: '••••' },
    });
    expect(
      mcpToggleBody({ name: 'fs', command: 'npx', args: ['server'], env: { KEY: '••••' } }, true),
    ).toEqual({ name: 'fs', serverType: 'stdio', command: 'npx', args: ['server'], enabled: true, env: { KEY: '••••' } });
  });

  it('routes bundled and custom servers to their own endpoints', () => {
    expect(globalMcpToggle({ ...http, source: 'system' }, false)).toEqual({
      path: '/api/system/mcp-servers/system/m1',
      body: { enabled: false },
    });
    expect(globalMcpToggle(http, true)?.path).toBe('/api/system/mcp-servers/custom/m1');
    expect(globalMcpToggle({ ...http, source: 'project' }, true)).toBeNull();
    expect(globalMcpToggle({ name: 'no-id', source: 'system' }, true)).toBeNull();
  });
});
