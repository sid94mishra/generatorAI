import { describe, it, expect } from 'vitest';
import { GitHubProvider } from '../src/GitHubProvider.js';
import { SourceControlError } from '../src/errors.js';
import type { IScmHttpClient, ScmHttpRequestOptions, ScmHttpResponse } from '../src/ports.js';
import type { ILogger } from '@generatorai/shared';

const silentLogger: ILogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};

function mockHttp(
  handler: (opts: ScmHttpRequestOptions) => ScmHttpResponse,
  calls?: ScmHttpRequestOptions[],
): IScmHttpClient {
  return {
    request: async (opts) => {
      calls?.push(opts);
      return handler(opts);
    },
  };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): ScmHttpResponse => ({
  status,
  headers,
  body: JSON.stringify(body),
});

describe('GitHubProvider.getAuthenticatedUser', () => {
  it('GETs /user and maps login + avatar + scopes from x-oauth-scopes', async () => {
    const calls: ScmHttpRequestOptions[] = [];
    const http = mockHttp(
      () =>
        json({ login: 'octocat', avatar_url: 'https://avatars/1' }, 200, {
          'x-oauth-scopes': 'repo, workflow ,read:org',
        }),
      calls,
    );
    const p = new GitHubProvider(http, silentLogger, { token: 't' });
    const user = await p.getAuthenticatedUser();
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url).toBe('https://api.github.com/user');
    expect(user).toEqual({
      login: 'octocat',
      avatarUrl: 'https://avatars/1',
      scopes: ['repo', 'workflow', 'read:org'],
    });
  });

  it('omits scopes when the header is absent (fine-grained PAT)', async () => {
    const p = new GitHubProvider(
      mockHttp(() => json({ login: 'octocat' })),
      silentLogger,
      { token: 't' },
    );
    const user = await p.getAuthenticatedUser();
    expect(user.scopes).toBeUndefined();
    expect(user.avatarUrl).toBeUndefined();
  });

  it('throws on a failure status', async () => {
    const p = new GitHubProvider(
      mockHttp(() => ({ status: 401, headers: {}, body: '{}' })),
      silentLogger,
      { token: 't' },
    );
    await expect(p.getAuthenticatedUser()).rejects.toBeInstanceOf(SourceControlError);
  });

  it('uses the enterprise /api/v3 base', async () => {
    const calls: ScmHttpRequestOptions[] = [];
    const p = new GitHubProvider(mockHttp(() => json({ login: 'a' }), calls), silentLogger, {
      token: 't',
      host: 'https://ghe.acme.com',
    });
    await p.getAuthenticatedUser();
    expect(calls[0]?.url).toBe('https://ghe.acme.com/api/v3/user');
    expect(calls[0]?.headers?.['Authorization']).toBe('Bearer t');
  });
});

describe('GitHubProvider.getRepository', () => {
  it('maps default_branch / private / html_url', async () => {
    const calls: ScmHttpRequestOptions[] = [];
    const http = mockHttp(
      () =>
        json({
          default_branch: 'develop',
          private: true,
          html_url: 'https://github.com/acme/web',
        }),
      calls,
    );
    const p = new GitHubProvider(http, silentLogger, { token: 't' });
    const repo = await p.getRepository('acme', 'web');
    expect(calls[0]?.url).toBe('https://api.github.com/repos/acme/web');
    expect(repo).toEqual({
      defaultBranch: 'develop',
      private: true,
      url: 'https://github.com/acme/web',
    });
  });

  it('honours a per-call enterprise host override', async () => {
    const calls: ScmHttpRequestOptions[] = [];
    const p = new GitHubProvider(mockHttp(() => json({}), calls), silentLogger, { token: 't' });
    await p.getRepository('a', 'b', 'https://ghe.acme.com');
    expect(calls[0]?.url).toBe('https://ghe.acme.com/api/v3/repos/a/b');
  });
});

const detailPayload = {
  number: 7,
  html_url: 'https://github.com/acme/web/pull/7',
  title: 'Add widget',
  state: 'open',
  draft: true,
  body: 'Body text',
  mergeable: null,
  mergeable_state: 'unstable',
  additions: 12,
  deletions: 3,
  changed_files: 2,
  commits: 4,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
  user: { login: 'octocat' },
  labels: [{ name: 'bug' }, { name: 'ui' }],
  head: { ref: 'feature/x', sha: 'headsha' },
  base: { ref: 'main', sha: 'basesha' },
};

describe('GitHubProvider.getPullRequestDetail', () => {
  it('maps the GitHub payload onto the shared PullRequestDetail shape', async () => {
    const calls: ScmHttpRequestOptions[] = [];
    const p = new GitHubProvider(mockHttp(() => json(detailPayload), calls), silentLogger, {
      token: 't',
    });
    const detail = await p.getPullRequestDetail({ owner: 'acme', repo: 'web', number: 7 });
    expect(calls).toHaveLength(1); // does NOT fetch checks
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url).toBe('https://api.github.com/repos/acme/web/pulls/7');
    expect(detail).toEqual({
      provider: 'github',
      number: 7,
      url: 'https://github.com/acme/web/pull/7',
      title: 'Add widget',
      state: 'open',
      head: 'feature/x',
      base: 'main',
      draft: true,
      author: 'octocat',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
      body: 'Body text',
      mergeable: null,
      mergeableState: 'unstable',
      additions: 12,
      deletions: 3,
      changedFiles: 2,
      commits: 4,
      headSha: 'headsha',
      baseSha: 'basesha',
      labels: ['bug', 'ui'],
    });
  });

  it('defaults body to an empty string and mergeable to null', async () => {
    const p = new GitHubProvider(
      mockHttp(() =>
        json({ number: 1, html_url: 'u', title: 't', state: 'open', head: {}, base: {} }),
      ),
      silentLogger,
      { token: 't' },
    );
    const detail = await p.getPullRequestDetail({ owner: 'a', repo: 'b', number: 1 });
    expect(detail.body).toBe('');
    expect(detail.mergeable).toBeNull();
    expect(detail.labels).toEqual([]);
    expect(detail.headSha).toBe('');
  });
});

describe('GitHubProvider.listPullRequestFiles', () => {
  it('maps filenames, statuses and patches', async () => {
    const calls: ScmHttpRequestOptions[] = [];
    const http = mockHttp(
      () =>
        json([
          { filename: 'a.ts', status: 'added', additions: 5, deletions: 0, patch: '@@ -0,0' },
          { filename: 'b.ts', status: 'changed', additions: 1, deletions: 1 },
          { filename: 'c.ts', previous_filename: 'old.ts', status: 'renamed', additions: 0, deletions: 0 },
          { filename: 'd.ts', status: 'copied', additions: 2, deletions: 0 },
          { filename: 'e.ts', status: 'removed', additions: 0, deletions: 9 },
          { filename: 'f.ts', status: 'unexpected', additions: 0, deletions: 0 },
        ]),
      calls,
    );
    const p = new GitHubProvider(http, silentLogger, { token: 't' });
    const files = await p.listPullRequestFiles({ owner: 'acme', repo: 'web', number: 7 });
    expect(calls[0]?.url).toBe('https://api.github.com/repos/acme/web/pulls/7/files?per_page=100');
    expect(files.map((f) => f.status)).toEqual([
      'added',
      'modified',
      'renamed',
      'added',
      'removed',
      'modified',
    ]);
    expect(files[0]).toEqual({
      path: 'a.ts',
      status: 'added',
      additions: 5,
      deletions: 0,
      patch: '@@ -0,0',
    });
    expect(files[2]?.previousPath).toBe('old.ts');
    expect(files[1]?.patch).toBeUndefined();
  });
});

describe('GitHubProvider.listPullRequestComments', () => {
  it('merges review + issue comments sorted by createdAt', async () => {
    const urls: string[] = [];
    const http = mockHttp((opts) => {
      urls.push(opts.url);
      if (opts.url.includes('/pulls/7/comments')) {
        return json([
          {
            id: 11,
            body: 'review later',
            created_at: '2026-01-03T00:00:00Z',
            html_url: 'https://gh/rc1',
            user: { login: 'rev' },
            path: 'src/a.ts',
            line: null,
            original_line: 42,
          },
        ]);
      }
      return json([
        {
          id: 22,
          body: 'issue first',
          created_at: '2026-01-01T00:00:00Z',
          html_url: 'https://gh/ic1',
          user: { login: 'nate' },
        },
        { id: 23, body: 'issue mid', created_at: '2026-01-02T00:00:00Z', user: null },
      ]);
    });
    const p = new GitHubProvider(http, silentLogger, { token: 't' });
    const comments = await p.listPullRequestComments({ owner: 'acme', repo: 'web', number: 7 });
    expect(urls.some((u) => u.includes('/repos/acme/web/pulls/7/comments'))).toBe(true);
    expect(urls.some((u) => u.includes('/repos/acme/web/issues/7/comments'))).toBe(true);
    expect(comments.map((c) => c.id)).toEqual(['22', '23', '11']);
    expect(comments.map((c) => c.kind)).toEqual(['issue', 'issue', 'review']);
    expect(comments[1]?.author).toBe('');
    expect(comments[2]).toEqual({
      id: '11',
      author: 'rev',
      body: 'review later',
      createdAt: '2026-01-03T00:00:00Z',
      url: 'https://gh/rc1',
      path: 'src/a.ts',
      line: 42,
      kind: 'review',
    });
  });

  it('throws when either listing fails', async () => {
    const p = new GitHubProvider(
      mockHttp((opts) =>
        opts.url.includes('/issues/') ? { status: 500, headers: {}, body: '' } : json([]),
      ),
      silentLogger,
      { token: 't' },
    );
    await expect(
      p.listPullRequestComments({ owner: 'a', repo: 'b', number: 1 }),
    ).rejects.toBeInstanceOf(SourceControlError);
  });
});

describe('GitHubProvider.findOpenPullRequestForHead', () => {
  it('queries state=open&head=<owner>:<branch> and maps the first result', async () => {
    const calls: ScmHttpRequestOptions[] = [];
    const http = mockHttp(
      () =>
        json([
          {
            number: 9,
            html_url: 'https://github.com/acme/web/pull/9',
            title: 'WIP',
            state: 'open',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-04T00:00:00Z',
            user: { login: 'octocat' },
            head: { ref: 'feature/x' },
            base: { ref: 'main' },
          },
        ]),
      calls,
    );
    const p = new GitHubProvider(http, silentLogger, { token: 't' });
    const pr = await p.findOpenPullRequestForHead('acme', 'web', 'feature/x');
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url).toBe(
      'https://api.github.com/repos/acme/web/pulls?state=open&head=acme:feature%2Fx&per_page=1',
    );
    expect(pr?.number).toBe(9);
    expect(pr?.author).toBe('octocat');
    expect(pr?.updatedAt).toBe('2026-01-04T00:00:00Z');
  });

  it('returns null for an empty result array', async () => {
    const p = new GitHubProvider(mockHttp(() => json([])), silentLogger, { token: 't' });
    expect(await p.findOpenPullRequestForHead('a', 'b', 'br')).toBeNull();
  });

  it.each([401, 403, 404])('returns null (no throw) on %i', async (status) => {
    const p = new GitHubProvider(
      mockHttp(() => ({ status, headers: {}, body: '{}' })),
      silentLogger,
      { token: 't' },
    );
    expect(await p.findOpenPullRequestForHead('a', 'b', 'br')).toBeNull();
  });

  it('throws on other failures', async () => {
    const p = new GitHubProvider(
      mockHttp(() => ({ status: 500, headers: {}, body: 'boom' })),
      silentLogger,
      { token: 't' },
    );
    await expect(p.findOpenPullRequestForHead('a', 'b', 'br')).rejects.toBeInstanceOf(
      SourceControlError,
    );
  });

  it('uses the enterprise base for enterprise accounts', async () => {
    const calls: ScmHttpRequestOptions[] = [];
    const p = new GitHubProvider(mockHttp(() => json([]), calls), silentLogger, {
      token: 't',
      host: 'https://ghe.acme.com',
    });
    await p.findOpenPullRequestForHead('a', 'b', 'main');
    expect(calls[0]?.url).toBe(
      'https://ghe.acme.com/api/v3/repos/a/b/pulls?state=open&head=a:main&per_page=1',
    );
    expect(p.host).toBe('https://ghe.acme.com');
  });
});

describe('GitHubProvider.mapPr author/timestamps', () => {
  it('populates author, createdAt and updatedAt on listPullRequests', async () => {
    const p = new GitHubProvider(
      mockHttp(() =>
        json([
          {
            number: 1,
            html_url: 'u',
            title: 't',
            state: 'open',
            created_at: '2026-02-01T00:00:00Z',
            updated_at: '2026-02-02T00:00:00Z',
            user: { login: 'dev' },
            head: { ref: 'h' },
            base: { ref: 'main' },
          },
        ]),
      ),
      silentLogger,
      { token: 't' },
    );
    const [pr] = await p.listPullRequests({ owner: 'a', repo: 'b' });
    expect(pr?.author).toBe('dev');
    expect(pr?.createdAt).toBe('2026-02-01T00:00:00Z');
    expect(pr?.updatedAt).toBe('2026-02-02T00:00:00Z');
  });
});
