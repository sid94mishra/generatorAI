// The endpoint contract, against a mocked fetch: the paths, the methods and
// the exact bodies mobile sends. The server half is built in parallel from
// the same table in `.github/docs/feature-source-control.md`, so these
// assertions are the contract, not an implementation detail.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../api/http';
import { createScmApi } from '../api';

interface Call {
  path: string;
  method: string;
  body: unknown;
}

let calls: Call[] = [];

function respond(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    statusText: 'OK',
    json: async () => body,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as unknown as Response;
}

function api(next: (path: string) => Response = () => respond({})) {
  const fetchImpl = vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({
      path,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return next(path);
  });
  return { scm: createScmApi(fetchImpl), fetchImpl };
}

beforeEach(() => {
  calls = [];
});

describe('accounts and settings', () => {
  it('reads the settings, sets the default account and disconnects one', async () => {
    const { scm } = api((path) => (path.endsWith('/accounts/acc-1') ? respond(undefined, 204) : respond({})));
    await scm.settings();
    await scm.setDefaultAccount('acc-2');
    await scm.disconnectAccount('acc-1');

    expect(calls).toEqual([
      { path: '/api/source-control/settings', method: 'GET', body: undefined },
      { path: '/api/source-control/settings', method: 'PUT', body: { defaultAccountId: 'acc-2' } },
      { path: '/api/source-control/accounts/acc-1', method: 'DELETE', body: undefined },
    ]);
  });

  it('never sends a token — there is no endpoint here that could', () => {
    const { scm } = api();
    expect(Object.keys(scm)).not.toContain('connectAccount');
    expect(JSON.stringify(Object.keys(scm))).not.toMatch(/token/i);
  });
});

describe('readiness and the flow', () => {
  it('reads readiness for the workspace, and for one mount', async () => {
    const { scm } = api();
    await scm.readiness('ws-1');
    await scm.readiness('ws-1', 'api');
    expect(calls.map((c) => c.path)).toEqual([
      '/api/workspaces/ws-1/scm/readiness',
      '/api/workspaces/ws-1/scm/readiness?alias=api',
    ]);
  });

  it('posts the flow body verbatim', async () => {
    const { scm } = api();
    await scm.flow('ws-1', {
      alias: '.',
      commit: { message: 'fix' },
      push: true,
      pullRequest: { title: 'Fix', draft: true },
    });
    expect(calls[0]).toEqual({
      path: '/api/workspaces/ws-1/scm/flow',
      method: 'POST',
      body: { alias: '.', commit: { message: 'fix' }, push: true, pullRequest: { title: 'Fix', draft: true } },
    });
  });

  it('asks for generated text by kind', async () => {
    const { scm } = api();
    await scm.generate('ws-1', { alias: '.', kind: 'pull_request', base: 'main', hint: 'Cart fix' });
    expect(calls[0]).toEqual({
      path: '/api/workspaces/ws-1/scm/generate',
      method: 'POST',
      body: { alias: '.', kind: 'pull_request', base: 'main', hint: 'Cart fix' },
    });
  });

  it('drives the three conflict routes', async () => {
    const { scm } = api();
    await scm.resolveConflictsWithAgent('ws-1', { alias: '.', chatId: 'chat-9' });
    await scm.continueConflicts('ws-1', { alias: '.' });
    await scm.abortConflicts('ws-1', { alias: '.' });
    expect(calls).toEqual([
      {
        path: '/api/workspaces/ws-1/scm/conflicts/resolve-with-agent',
        method: 'POST',
        body: { alias: '.', chatId: 'chat-9' },
      },
      { path: '/api/workspaces/ws-1/scm/conflicts/continue', method: 'POST', body: { alias: '.' } },
      { path: '/api/workspaces/ws-1/scm/conflicts/abort', method: 'POST', body: { alias: '.' } },
    ]);
  });

  it("reports the server's own reason instead of a status line", async () => {
    const { scm } = api(() => respond({ error: { code: 'scm_blocked', message: 'Detached HEAD' } }, 409));
    await expect(scm.flow('ws-1', {})).rejects.toMatchObject({
      message: 'Detached HEAD',
      status: 409,
      code: 'scm_blocked',
    });
    await expect(scm.flow('ws-1', {})).rejects.toBeInstanceOf(ApiError);
  });
});

describe('pull requests', () => {
  it('lists a project, filtered by state', async () => {
    const { scm } = api(() => respond({ items: [], unavailable: [] }));
    await scm.projectPullRequests('p 1', 'all');
    expect(calls[0]!.path).toBe('/api/projects/p%201/pull-requests?state=all');
  });

  it('reads one pull request, its files and its comments', async () => {
    const { scm } = api();
    await scm.pullRequest('p1', 'cb1', 12);
    await scm.pullRequestFiles('p1', 'cb1', 12);
    await scm.pullRequestComments('p1', 'cb1', 12);
    expect(calls.map((c) => c.path)).toEqual([
      '/api/projects/p1/codebases/cb1/pull-requests/12',
      '/api/projects/p1/codebases/cb1/pull-requests/12/files',
      '/api/projects/p1/codebases/cb1/pull-requests/12/comments',
    ]);
  });

  it('starts a review chat with the extra instructions', async () => {
    const { scm } = api(() => respond({ chat: { id: 'chat-1' } }));
    const result = await scm.reviewChat('p1', 'cb1', 12, { instructions: 'focus on the migration' });
    expect(calls[0]).toEqual({
      path: '/api/projects/p1/codebases/cb1/pull-requests/12/review-chat',
      method: 'POST',
      body: { instructions: 'focus on the migration' },
    });
    expect(result.chat.id).toBe('chat-1');
  });
});
