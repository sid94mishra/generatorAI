// D-146 — the agent's GitHub tools: repository resolution from the project's
// codebases (never from the model), argument validation, readable refusals,
// and the approval gate (writes ask in the asking modes, merge always asks,
// nothing writes while planning). The provider is a fake: no GitHub call.

import { describe, expect, it, vi } from 'vitest';
import type { ProjectCodebase } from '@generatorai/shared';
import type { ISourceControlProvider } from '@generatorai/source-control';
import { PullRequestNotMergeableError } from '@generatorai/source-control';
import {
  buildGitHubToolSet,
  GitHubToolHost,
  GITHUB_MERGE_TOOL_NAME,
  GITHUB_TOOL_NAMES,
} from '../../src/tools/github/index.js';
import { askBeforeActing } from '../../src/services/session/gates.js';
import type { ResolvedCodebaseRemote } from '../../src/services/scm/CodebaseRemoteResolver.js';
import type { TurnContext } from '../../src/services/session/types.js';
import { PlatformToolBinder, type BindTarget } from '../../src/services/session/PlatformToolBinder.js';

const cb = (id: string, alias: string): ProjectCodebase => ({ id, alias, clonePath: `/srv/${alias}` }) as unknown as ProjectCodebase;

function fakeProvider() {
  return {
    id: 'github',
    listIssues: vi.fn(async () => [
      { provider: 'github', number: 4, title: 'Crash', body: 'b', state: 'open', labels: ['bug'], author: 'o', url: 'u4', createdAt: 'c', updatedAt: 'u', comments: 1 },
      { provider: 'github', number: 5, title: 'Typo', body: '', state: 'open', labels: [], url: 'u5', createdAt: 'c', updatedAt: 'u', comments: 0 },
    ]),
    getIssue: vi.fn(async (ref: { number: number }) =>
      ref.number === 404
        ? null
        : { provider: 'github', number: ref.number, title: 'Crash', body: 'Stack trace', state: 'open', labels: [], url: 'u', createdAt: 'c', updatedAt: 'u', comments: 1 },
    ),
    listIssueComments: vi.fn(async () => [{ id: '1', author: 'a', body: 'same here', createdAt: 'c' }]),
    createIssue: vi.fn(async () => ({ provider: 'github', number: 9, title: 'New', body: '', state: 'open', labels: ['bug'], url: 'u9', createdAt: 'c', updatedAt: 'u', comments: 0 })),
    commentOnIssue: vi.fn(async () => ({ id: 'c1', author: 'me', body: 'x', createdAt: 'c', url: 'cu' })),
    closeIssue: vi.fn(async () => ({ provider: 'github', number: 4, title: 'Crash', body: '', state: 'closed', stateReason: 'completed', labels: [], url: 'u4', createdAt: 'c', updatedAt: 'u', comments: 1 })),
    getPullRequestDetail: vi.fn(async () => ({ state: 'open', head: 'feature/x', draft: false })),
    mergePullRequest: vi.fn(async () => ({ merged: true, sha: 'abc', message: 'merged' })),
    deleteBranch: vi.fn(async () => true),
  };
}

function setup(opts: { codebases?: ProjectCodebase[]; resolve?: (c: ProjectCodebase) => ResolvedCodebaseRemote } = {}) {
  const provider = fakeProvider();
  const codebases = opts.codebases ?? [cb('cb-web', 'web')];
  const resolve =
    opts.resolve ??
    ((c: ProjectCodebase): ResolvedCodebaseRemote => ({
      ok: true,
      repoDir: `/srv/${c.alias}`,
      slug: { owner: 'acme', repo: c.alias, host: 'github.com' },
      provider: provider as unknown as ISourceControlProvider,
    }));
  const getByProjectId = vi.fn(async () => codebases);
  const host = new GitHubToolHost({ codebases: { getByProjectId }, resolver: { resolve: async (c) => resolve(c) } });
  const tools = buildGitHubToolSet(host, { projectId: 'p1' });
  const tool = (name: string) => tools.find((t) => t.name === name)!;
  return { provider, host, tools, tool, getByProjectId };
}

describe('buildGitHubToolSet', () => {
  it('declares the six tools in order; reads skip the permission prompt, writes do not', () => {
    const { tools } = setup();
    expect(tools.map((t) => t.name)).toEqual([...GITHUB_TOOL_NAMES]);
    expect(tools.filter((t) => t.skipPermission).map((t) => t.name)).toEqual(['github_list_issues', 'github_get_issue']);
  });

  it('lists issues of the only repository, compactly', async () => {
    const { tool, provider } = setup();
    const out = (await tool('github_list_issues').handler({ state: 'closed', labels: ['bug'], limit: 1 })) as Record<string, unknown>;
    expect(provider.listIssues).toHaveBeenCalledWith({ owner: 'acme', repo: 'web', state: 'closed', host: 'github.com', labels: ['bug'] });
    expect(out).toMatchObject({ codebase: 'web', repository: 'acme/web', state: 'closed', count: 1 });
    expect(out['issues']).toEqual([{ number: 4, title: 'Crash', state: 'open', labels: ['bug'], author: 'o', comments: 1, updatedAt: 'u', url: 'u4' }]);
  });

  it('reads an issue with its comments, and refuses a number that is not an issue', async () => {
    const { tool } = setup();
    const out = (await tool('github_get_issue').handler({ number: 4 })) as Record<string, unknown>;
    expect(out['issue']).toMatchObject({ number: 4, body: 'Stack trace' });
    expect(out['comments']).toEqual([{ author: 'a', createdAt: 'c', body: 'same here' }]);

    expect(await tool('github_get_issue').handler({ number: 404 })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await tool('github_get_issue').handler({ number: -1 })).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
  });

  it('creates an issue after validating the arguments', async () => {
    const { tool, provider } = setup();
    expect(await tool('github_create_issue').handler({ title: '   ' })).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
    expect(provider.createIssue).not.toHaveBeenCalled();

    const out = await tool('github_create_issue').handler({ title: 'New', body: 'Details', labels: ['bug'] });
    expect(provider.createIssue).toHaveBeenCalledWith({ owner: 'acme', repo: 'web', host: 'github.com', title: 'New', body: 'Details', labels: ['bug'] });
    expect(out).toEqual({ ok: true, codebase: 'web', repository: 'acme/web', issue: { number: 9, title: 'New', url: 'u9', labels: ['bug'] } });
  });

  it('comments, and closes with an optional comment first', async () => {
    const { tool, provider } = setup();
    expect(await tool('github_comment_issue').handler({ number: 4, body: 'Fixed in #12' })).toMatchObject({ ok: true, number: 4, comment: { id: 'c1' } });
    expect(provider.commentOnIssue).toHaveBeenCalledWith({ owner: 'acme', repo: 'web', number: 4, host: 'github.com' }, 'Fixed in #12');

    provider.commentOnIssue.mockClear();
    const out = await tool('github_close_issue').handler({ number: 4, reason: 'not_planned', comment: 'Duplicate of #2' });
    expect(provider.commentOnIssue).toHaveBeenCalledWith(expect.objectContaining({ number: 4 }), 'Duplicate of #2');
    expect(provider.closeIssue).toHaveBeenCalledWith(expect.objectContaining({ number: 4 }), { reason: 'not_planned' });
    expect(out).toMatchObject({ ok: true, issue: { number: 4, state: 'closed' } });

    expect(await tool('github_close_issue').handler({ number: 4, reason: 'wontfix' })).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
  });

  it('merges with the method and deletes the head branch when asked', async () => {
    const { tool, provider } = setup();
    const out = await tool(GITHUB_MERGE_TOOL_NAME).handler({ number: 7, method: 'squash', deleteBranch: true });
    expect(provider.mergePullRequest).toHaveBeenCalledWith({ owner: 'acme', repo: 'web', number: 7, host: 'github.com' }, { method: 'squash' });
    expect(provider.deleteBranch).toHaveBeenCalledWith('acme', 'web', 'feature/x', 'github.com');
    expect(out).toMatchObject({ ok: true, number: 7, merged: true, sha: 'abc', branchDeleted: true });

    expect(await tool(GITHUB_MERGE_TOOL_NAME).handler({ number: 7, method: 'octopus' })).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
  });

  it('reports the host refusing a merge as a readable error', async () => {
    const { tool, provider } = setup();
    provider.mergePullRequest.mockRejectedValueOnce(new PullRequestNotMergeableError('Pull request #7 cannot be merged: conflicts'));
    expect(await tool(GITHUB_MERGE_TOOL_NAME).handler({ number: 7 })).toEqual({
      ok: false,
      code: 'SCM_NOT_MERGEABLE',
      error: 'Pull request #7 cannot be merged: conflicts',
    });

    provider.getPullRequestDetail.mockResolvedValueOnce({ state: 'merged', head: 'x', draft: false });
    expect(await tool(GITHUB_MERGE_TOOL_NAME).handler({ number: 7 })).toMatchObject({ ok: false, error: 'Pull request #7 is already merged' });
  });
});

describe('repository resolution', () => {
  const two = [cb('cb-web', 'web'), cb('cb-api', 'api')];

  it('asks for a codebase when the project has several repositories, and uses the named one', async () => {
    const { tool, provider } = setup({ codebases: two });
    const out = (await tool('github_list_issues').handler({})) as Record<string, unknown>;
    expect(out).toMatchObject({ ok: false, code: 'AMBIGUOUS_CODEBASE' });
    expect(out['codebases']).toEqual([
      { alias: 'web', repository: 'acme/web' },
      { alias: 'api', repository: 'acme/api' },
    ]);

    await tool('github_list_issues').handler({ codebase: 'api' });
    expect(provider.listIssues).toHaveBeenCalledWith(expect.objectContaining({ repo: 'api' }));
    expect(await tool('github_list_issues').handler({ codebase: 'nope' })).toMatchObject({ ok: false, code: 'UNKNOWN_CODEBASE', codebases: ['web', 'api'] });
  });

  it('picks the only connected repository and explains when there is none', async () => {
    const { provider } = setup();
    const connected = (c: ProjectCodebase): ResolvedCodebaseRemote =>
      c.alias === 'web'
        ? { ok: true, repoDir: '/srv/web', slug: { owner: 'acme', repo: 'web', host: 'github.com' }, provider: provider as unknown as ISourceControlProvider }
        : { ok: false, reason: 'No git remote configured' };
    const one = setup({ codebases: two, resolve: connected });
    expect(await one.tool('github_list_issues').handler({})).toMatchObject({ repository: 'acme/web' });
    expect(await one.host.hasRepository('p1')).toBe(true);

    const none = setup({ codebases: two, resolve: () => ({ ok: false, reason: 'Remote host github.com is not connected', host: 'github.com' }) });
    expect(await none.tool('github_list_issues').handler({})).toMatchObject({ ok: false, code: 'NO_REPOSITORY' });
    expect(await none.host.hasRepository('p1')).toBe(false);
  });
});

describe('askBeforeActing (D-146)', () => {
  const run = vi.fn(async () => 'done');
  const write = { name: 'github_create_issue', description: 'Create an issue. More.', parametersSchema: {}, handler: run };
  const merge = { name: GITHUB_MERGE_TOOL_NAME, description: 'Merge a pull request.', parametersSchema: {}, handler: run };
  const turnIn = (permissionMode: string) => ({ permissionMode }) as unknown as TurnContext;
  const always = new Set([GITHUB_MERGE_TOOL_NAME]);

  it('writes ask in the asking modes and run unasked in full access', async () => {
    const permission = vi.fn(async () => ({ granted: true }));
    for (const mode of ['default', 'acceptEdits']) {
      const [w] = askBeforeActing([write], { turnOf: () => turnIn(mode), port: { permission }, always });
      await expect(w!.handler({ title: 't' })).resolves.toBe('done');
    }
    expect(permission).toHaveBeenCalledTimes(2);
    expect(permission).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'other', description: 'Create an issue.', details: expect.objectContaining({ toolName: 'github_create_issue' }) }),
      expect.anything(),
    );
    permission.mockClear();
    const [w] = askBeforeActing([write], { turnOf: () => turnIn('bypassPermissions'), port: { permission }, always });
    await expect(w!.handler({})).resolves.toBe('done');
    expect(permission).not.toHaveBeenCalled();
  });

  it('merge asks in every mode, bypass included, and does not run when denied', async () => {
    const permission = vi.fn(async () => ({ granted: true }));
    for (const mode of ['default', 'acceptEdits', 'bypassPermissions']) {
      await askBeforeActing([merge], { turnOf: () => turnIn(mode), port: { permission }, always })[0]!.handler({ number: 1 });
    }
    expect(permission).toHaveBeenCalledTimes(3);

    run.mockClear();
    const [denied] = askBeforeActing([merge], { turnOf: () => turnIn('bypassPermissions'), port: { permission: async () => ({ granted: false, reason: 'Not now.' }) }, always });
    await expect(denied!.handler({})).rejects.toThrow('Not now.');
    expect(run).not.toHaveBeenCalled();
  });

  it('merge is refused where nobody can be asked; a write still runs there', async () => {
    run.mockClear();
    await expect(askBeforeActing([merge], { turnOf: () => turnIn('default'), port: undefined, always })[0]!.handler({})).rejects.toThrow(/needs a person/);
    await expect(askBeforeActing([merge], { turnOf: () => undefined, port: { permission: async () => ({ granted: true }) }, always })[0]!.handler({})).rejects.toThrow(/needs a person/);
    expect(run).not.toHaveBeenCalled();
    await expect(askBeforeActing([write], { turnOf: () => turnIn('default'), port: undefined, always })[0]!.handler({})).resolves.toBe('done');
  });

  it('refuses every write while planning (merge included)', async () => {
    const permission = vi.fn(async () => ({ granted: true }));
    for (const tool of [write, merge]) {
      await expect(askBeforeActing([tool], { turnOf: () => turnIn('plan'), port: { permission }, always })[0]!.handler({})).rejects.toThrow(/while planning/);
    }
    expect(permission).not.toHaveBeenCalled();
  });
});

describe('PlatformToolBinder.github', () => {
  const target = (): BindTarget => ({
    owner: { kind: 'chat', chatId: 'c1', sessionId: 's1' },
    sessionId: 's1',
    conversationId: 'conv-1',
    groups: {} as never,
  });
  const opts = { enabled: true, port: undefined, turnOf: () => undefined };

  it('binds the six tools and the hint only for a project with a connected repository', async () => {
    const { host } = setup();
    const binder = new PlatformToolBinder({ githubTools: host });

    const cfg: Record<string, unknown> = { conversationId: 'conv-1' };
    await binder.github(cfg as never, target(), { ...opts, projectId: 'p1' });
    expect((cfg['tools'] as Array<{ name: string }>).map((t) => t.name)).toEqual([...GITHUB_TOOL_NAMES]);
    expect(JSON.stringify(cfg)).toContain('[GitHub]');

    for (const variant of [{ projectId: undefined }, { projectId: 'p1', enabled: false }]) {
      const empty: Record<string, unknown> = {};
      await binder.github(empty as never, target(), { ...opts, ...variant });
      expect(empty['tools']).toBeUndefined();
    }

    const none = setup({ resolve: () => ({ ok: false, reason: 'No git remote configured' }) });
    const unbound: Record<string, unknown> = {};
    await new PlatformToolBinder({ githubTools: none.host }).github(unbound as never, target(), { ...opts, projectId: 'p1' });
    expect(unbound['tools']).toBeUndefined();
  });
});
