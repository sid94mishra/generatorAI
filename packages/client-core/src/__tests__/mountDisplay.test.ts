import { describe, expect, it } from 'vitest';
import { describeMount, EMPTY_WORKSPACE_LABEL, pathTail } from '../workspace/mountDisplay.js';

const managed = '/data/workspaces/executions/c1/source';

describe('describeMount', () => {
  it('names a no-source chat an empty workspace: no alias "main", branch or managed path', () => {
    const d = describeMount({ alias: 'main', mode: 'generated', originKind: 'generated', path: `${managed}/main`, git: { isRepo: true, branch: 'main' } });
    expect(d).toMatchObject({ kind: 'empty', label: EMPTY_WORKSPACE_LABEL });
    expect(d.branch).toBeUndefined();
    expect(d.userPath).toBeUndefined();
    expect(d.modeLabel).toBeUndefined();
  });

  it('shows a plain folder in place with its path and no branch', () => {
    const d = describeMount({ alias: 'notes', mode: 'in-place', originKind: 'folder', path: 'C:\\Users\\me\\notes', originPath: 'C:\\Users\\me\\notes', git: { isRepo: false } });
    expect(d).toMatchObject({ kind: 'folder', label: 'notes', modeLabel: 'In place', userPath: 'C:\\Users\\me\\notes' });
    expect(d.branch).toBeUndefined();
  });

  it('shows a git repo in place with its branch', () => {
    const d = describeMount({ alias: 'app', mode: 'in-place', originKind: 'folder', path: '/src/app', git: { isRepo: true, branch: 'feature/x' } });
    expect(d).toMatchObject({ kind: 'repo', branch: 'feature/x', userPath: '/src/app' });
  });

  it('shows a folder worktree by the repo it was cut from, never the managed checkout', () => {
    const d = describeMount({ alias: 'app', mode: 'worktree', originKind: 'folder', path: `${managed}/app`, originPath: '/src/app', git: { isRepo: true, branch: 'generatorai/fix' } });
    expect(d).toMatchObject({ kind: 'worktree', modeLabel: 'Worktree', branch: 'generatorai/fix', userPath: '/src/app' });
  });

  it('shows no path for a project codebase worktree (its origin may be the app\'s clone)', () => {
    const d = describeMount({ alias: 'api', mode: 'worktree', originKind: 'codebase', path: `${managed}/api`, originPath: '/data/codebases/api.git', git: { isRepo: true, branch: 'generatorai/x' } });
    expect(d.userPath).toBeUndefined();
    expect(d.branch).toBe('generatorai/x');
  });
});

describe('pathTail', () => {
  it('leaves a short path alone', () => {
    expect(pathTail('/src/app', 48)).toBe('/src/app');
  });
  it('keeps the folder name and the POSIX separator', () => {
    expect(pathTail('/var/folders/0d/wvbkljv54ylfz/T/generatorai-dummy-repo-2026/work', 40)).toBe('…/T/generatorai-dummy-repo-2026/work');
  });
  it('keeps a Windows path backslashed', () => {
    expect(pathTail('C:\\Users\\someone\\Documents\\projects\\payments-api', 30)).toBe('…\\projects\\payments-api');
  });
  it('never drops the last segment, even past the budget', () => {
    expect(pathTail('/a/averyveryveryverylongfoldername', 10)).toBe('…/averyveryveryverylongfoldername');
  });
});
