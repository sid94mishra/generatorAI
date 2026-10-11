// Merge + issues on the GitHub provider: URLs, methods, bodies, and how
// GitHub's refusals become readable errors. The HTTP port is faked — no
// test here ever reaches api.github.com.

import { describe, it, expect } from 'vitest';
import { GitHubProvider } from '../src/GitHubProvider.js';
import { PullRequestNotMergeableError, SourceControlError } from '../src/errors.js';
import type { IScmHttpClient, ScmHttpRequestOptions, ScmHttpResponse } from '../src/ports.js';
import type { ILogger } from '@generatorai/shared';

const silentLogger: ILogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};

function provider(handler: (opts: ScmHttpRequestOptions) => ScmHttpResponse, opts: { host?: string } = {}) {
  const calls: ScmHttpRequestOptions[] = [];
  const http: IScmHttpClient = {
    request: async (o) => {
      calls.push(o);
      return handler(o);
    },
  };
  return { p: new GitHubProvider(http, silentLogger, { token: 't', ...opts }), calls };
}

const json = (body: unknown, status = 200): ScmHttpResponse => ({ status, headers: {}, body: JSON.stringify(body) });
const ref = { owner: 'acme', repo: 'web', number: 7 };

const ghIssue = (n: number, extra: Record<string, unknown> = {}) => ({
  number: n,
  html_url: `https://github.com/acme/web/issues/${n}`,
  title: `Issue ${n}`,
  body: 'Steps to reproduce',
  state: 'open',
  labels: [{ name: 'bug' }, 'p1'],
  user: { login: 'octocat' },
  comments: 2,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-02T00:00:00Z',
  ...extra,
});

describe('GitHubProvider.mergePullRequest', () => {
  it('PUTs /pulls/:n/merge with the method and commit text', async () => {
    const { p, calls } = provider(() => json({ sha: 'abc', merged: true, message: 'Pull Request successfully merged' }));
    const res = await p.mergePullRequest(ref, { method: 'squash', commitTitle: 'Add widget (#7)', commitMessage: 'body' });
    expect(calls[0]?.method).toBe('PUT');
    expect(calls[0]?.url).toBe('https://api.github.com/repos/acme/web/pulls/7/merge');
    expect(JSON.parse(calls[0]!.body!)).toEqual({ merge_method: 'squash', commit_title: 'Add widget (#7)', commit_message: 'body' });
    expect(res).toEqual({ merged: true, sha: 'abc', message: 'Pull Request successfully merged' });
  });

  it('sends only the method when no commit text is given', async () => {
    const { p, calls } = provider(() => json({ sha: 'abc', merged: true, message: 'ok' }));
    await p.mergePullRequest(ref, { method: 'rebase' });
    expect(JSON.parse(calls[0]!.body!)).toEqual({ merge_method: 'rebase' });
  });

  it.each([405, 409])('maps %i to PullRequestNotMergeableError carrying GitHub\'s reason', async (status) => {
    const { p } = provider(() => json({ message: 'Required status check "ci" is expected.' }, status));
    const err = await p.mergePullRequest(ref, { method: 'merge' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PullRequestNotMergeableError);
    expect((err as Error).message).toBe('Pull request #7 cannot be merged: Required status check "ci" is expected.');
    expect((err as PullRequestNotMergeableError).code).toBe('SCM_NOT_MERGEABLE');
  });

  it('explains a 403 as missing write access', async () => {
    const { p } = provider(() => json({ message: 'Resource not accessible by integration' }, 403));
    await expect(p.mergePullRequest(ref, { method: 'merge' })).rejects.toThrow(/Resource not accessible by integration.*write access/);
  });

  it('uses the enterprise base', async () => {
    const { p, calls } = provider(() => json({ merged: true }), { host: 'https://ghe.acme.com' });
    await p.mergePullRequest(ref, { method: 'merge' });
    expect(calls[0]?.url).toBe('https://ghe.acme.com/api/v3/repos/acme/web/pulls/7/merge');
  });
});

describe('GitHubProvider.deleteBranch', () => {
  it('DELETEs the head ref, encoding each segment', async () => {
    const { p, calls } = provider(() => ({ status: 204, headers: {}, body: '' }));
    expect(await p.deleteBranch('acme', 'web', 'feature/a b')).toBe(true);
    expect(calls[0]?.method).toBe('DELETE');
    expect(calls[0]?.url).toBe('https://api.github.com/repos/acme/web/git/refs/heads/feature/a%20b');
  });

  it('reads "Reference does not exist" (422) as already deleted', async () => {
    const { p } = provider(() => json({ message: 'Reference does not exist' }, 422));
    expect(await p.deleteBranch('acme', 'web', 'gone')).toBe(false);
  });

  it('throws on a permission failure', async () => {
    const { p } = provider(() => json({ message: 'Forbidden' }, 403));
    await expect(p.deleteBranch('acme', 'web', 'x')).rejects.toBeInstanceOf(SourceControlError);
  });
});

describe('GitHubProvider issues', () => {
  it('lists issues with state + labels and drops pull requests', async () => {
    const { p, calls } = provider(() => json([ghIssue(1), ghIssue(2, { pull_request: { url: 'x' } }), ghIssue(3)]));
    const issues = await p.listIssues({ owner: 'acme', repo: 'web', state: 'closed', labels: ['bug', ' p1 '] });
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url).toBe('https://api.github.com/repos/acme/web/issues?state=closed&per_page=100&labels=bug%2Cp1');
    expect(issues.map((i) => i.number)).toEqual([1, 3]);
    expect(issues[0]).toEqual({
      provider: 'github',
      number: 1,
      title: 'Issue 1',
      body: 'Steps to reproduce',
      state: 'open',
      labels: ['bug', 'p1'],
      author: 'octocat',
      url: 'https://github.com/acme/web/issues/1',
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-02T00:00:00Z',
      comments: 2,
    });
  });

  it('defaults the list to open issues without a labels filter', async () => {
    const { p, calls } = provider(() => json([]));
    await p.listIssues({ owner: 'acme', repo: 'web' });
    expect(calls[0]?.url).toBe('https://api.github.com/repos/acme/web/issues?state=open&per_page=100');
  });

  it('getIssue answers null for a missing number and for a pull request', async () => {
    expect(await provider(() => json({ message: 'Not Found' }, 404)).p.getIssue(ref)).toBeNull();
    expect(await provider(() => json(ghIssue(7, { pull_request: {} }))).p.getIssue(ref)).toBeNull();
    const { p, calls } = provider(() => json(ghIssue(7, { state: 'closed', state_reason: 'not_planned' })));
    const issue = await p.getIssue(ref);
    expect(calls[0]?.url).toBe('https://api.github.com/repos/acme/web/issues/7');
    expect(issue).toMatchObject({ number: 7, state: 'closed', stateReason: 'not_planned' });
  });

  it('lists comments oldest first', async () => {
    const { p, calls } = provider(() =>
      json([
        { id: 2, body: 'second', created_at: '2026-10-03T00:00:00Z', user: { login: 'b' } },
        { id: 1, body: 'first', created_at: '2026-10-02T00:00:00Z', user: { login: 'a' }, html_url: 'https://c/1' },
      ]),
    );
    const comments = await p.listIssueComments(ref);
    expect(calls[0]?.url).toBe('https://api.github.com/repos/acme/web/issues/7/comments?per_page=100');
    expect(comments).toEqual([
      { id: '1', author: 'a', body: 'first', createdAt: '2026-10-02T00:00:00Z', url: 'https://c/1' },
      { id: '2', author: 'b', body: 'second', createdAt: '2026-10-03T00:00:00Z' },
    ]);
  });

  it('creates an issue with title, body and labels', async () => {
    const { p, calls } = provider(() => json(ghIssue(9), 201));
    const issue = await p.createIssue({ owner: 'acme', repo: 'web', title: 'Crash', body: 'Stack', labels: ['bug'] });
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('https://api.github.com/repos/acme/web/issues');
    expect(JSON.parse(calls[0]!.body!)).toEqual({ title: 'Crash', body: 'Stack', labels: ['bug'] });
    expect(issue.number).toBe(9);
  });

  it('leaves body and labels off when empty', async () => {
    const { p, calls } = provider(() => json(ghIssue(9), 201));
    await p.createIssue({ owner: 'acme', repo: 'web', title: 'Crash', labels: [] });
    expect(JSON.parse(calls[0]!.body!)).toEqual({ title: 'Crash' });
  });

  it('surfaces GitHub validation errors readably', async () => {
    const { p } = provider(() => json({ message: 'Validation Failed', errors: [{ message: 'title is too long' }] }, 422));
    await expect(p.createIssue({ owner: 'acme', repo: 'web', title: 'x' })).rejects.toThrow(
      'GitHub could not create the issue (422): Validation Failed — title is too long',
    );
  });

  it('explains a 410 as issues being disabled', async () => {
    const { p } = provider(() => json({ message: 'Issues are disabled for this repo' }, 410));
    await expect(p.listIssues({ owner: 'acme', repo: 'web' })).rejects.toThrow(/issues are disabled/);
  });

  it('comments on an issue', async () => {
    const { p, calls } = provider(() => json({ id: 5, body: 'On it', created_at: 'x', user: { login: 'me' } }, 201));
    const comment = await p.commentOnIssue(ref, 'On it');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('https://api.github.com/repos/acme/web/issues/7/comments');
    expect(JSON.parse(calls[0]!.body!)).toEqual({ body: 'On it' });
    expect(comment).toEqual({ id: '5', author: 'me', body: 'On it', createdAt: 'x' });
  });

  it('closes an issue as completed by default, or with the given reason', async () => {
    const { p, calls } = provider(() => json(ghIssue(7, { state: 'closed', state_reason: 'completed' })));
    const closed = await p.closeIssue(ref);
    expect(calls[0]?.method).toBe('PATCH');
    expect(calls[0]?.url).toBe('https://api.github.com/repos/acme/web/issues/7');
    expect(JSON.parse(calls[0]!.body!)).toEqual({ state: 'closed', state_reason: 'completed' });
    expect(closed.state).toBe('closed');

    await p.closeIssue(ref, { reason: 'not_planned' });
    expect(JSON.parse(calls[1]!.body!)).toEqual({ state: 'closed', state_reason: 'not_planned' });
  });

  it('refuses every issue call without a token', async () => {
    const p = new GitHubProvider({ request: async () => json({}) }, silentLogger, {});
    await expect(p.listIssues({ owner: 'a', repo: 'b' })).rejects.toThrow(/requires a configured token/);
  });
});
