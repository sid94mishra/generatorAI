import { describe, it, expect, vi } from 'vitest';
import { GitHubProvider } from '../src/GitHubProvider.js';
import { SourceControlRegistry } from '../src/SourceControlRegistry.js';
import { ProviderNotConfiguredError } from '../src/errors.js';
import type {
  IScmHttpClient,
  IScmProcessRunner,
  ScmHttpRequestOptions,
  ScmHttpResponse,
} from '../src/ports.js';
import type { ILogger } from '@generatorai/shared';

const silentLogger: ILogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};

function mockHttp(handler: (opts: ScmHttpRequestOptions) => ScmHttpResponse): IScmHttpClient {
  return { request: async (opts) => handler(opts) };
}

describe('GitHubProvider.isConfigured', () => {
  it('is configured when a token is present', async () => {
    const p = new GitHubProvider(mockHttp(() => ({ status: 200, headers: {}, body: '{}' })), silentLogger, {
      token: 'ghp_x',
    });
    expect(await p.isConfigured()).toBe(true);
  });

  it('is not configured without token and no CLI', async () => {
    const p = new GitHubProvider(
      mockHttp(() => ({ status: 200, headers: {}, body: '{}' })),
      silentLogger,
      { allowCliFallback: false },
    );
    expect(await p.isConfigured()).toBe(false);
  });

  it('falls back to gh CLI auth status when no token', async () => {
    const runner: IScmProcessRunner = {
      run: vi.fn(async () => ({ exitCode: 0, stdout: 'Logged in', stderr: '' })),
    };
    const p = new GitHubProvider(
      mockHttp(() => ({ status: 200, headers: {}, body: '{}' })),
      silentLogger,
      {},
      runner,
    );
    expect(await p.isConfigured()).toBe(true);
    expect(runner.run).toHaveBeenCalledWith('gh', ['auth', 'status'], expect.anything());
  });
});

describe('GitHubProvider.createPullRequest via REST', () => {
  it('creates a PR and maps the response', async () => {
    const calls: ScmHttpRequestOptions[] = [];
    const http = mockHttp((opts) => {
      calls.push(opts);
      return {
        status: 201,
        headers: {},
        body: JSON.stringify({
          number: 42,
          html_url: 'https://github.com/acme/web/pull/42',
          title: 'My PR',
          state: 'open',
          draft: false,
          head: { ref: 'feature/x' },
          base: { ref: 'main' },
        }),
      };
    });
    const p = new GitHubProvider(http, silentLogger, { token: 'ghp_x' });
    const pr = await p.createPullRequest({
      owner: 'acme',
      repo: 'web',
      head: 'feature/x',
      base: 'main',
      title: 'My PR',
      body: 'desc',
    });
    expect(pr.number).toBe(42);
    expect(pr.url).toContain('/pull/42');
    expect(pr.state).toBe('open');
    expect(pr.head).toBe('feature/x');
    // Went to the pulls endpoint with a bearer token.
    expect(calls[0]?.url).toContain('/repos/acme/web/pulls');
    expect(calls[0]?.headers?.['Authorization']).toBe('Bearer ghp_x');
  });

  it('resolves the default base branch when base is omitted', async () => {
    const seen: string[] = [];
    const http = mockHttp((opts) => {
      seen.push(`${opts.method} ${opts.url}`);
      if (opts.method === 'GET' && opts.url.endsWith('/repos/acme/web')) {
        return { status: 200, headers: {}, body: JSON.stringify({ default_branch: 'develop' }) };
      }
      return {
        status: 201,
        headers: {},
        body: JSON.stringify({
          number: 1,
          html_url: 'u',
          title: 't',
          state: 'open',
          head: { ref: 'f' },
          base: { ref: 'develop' },
        }),
      };
    });
    const p = new GitHubProvider(http, silentLogger, { token: 'ghp_x' });
    const pr = await p.createPullRequest({ owner: 'acme', repo: 'web', head: 'f', title: 't' });
    expect(pr.base).toBe('develop');
    expect(seen.some((s) => s.includes('GET') && s.endsWith('/repos/acme/web'))).toBe(true);
  });

  it('throws when neither token nor CLI+repoDir available', async () => {
    const p = new GitHubProvider(
      mockHttp(() => ({ status: 200, headers: {}, body: '{}' })),
      silentLogger,
      { allowCliFallback: false },
    );
    await expect(
      p.createPullRequest({ owner: 'a', repo: 'b', head: 'h', title: 't' }),
    ).rejects.toBeInstanceOf(ProviderNotConfiguredError);
  });

  it('maps merged PR state', async () => {
    const http = mockHttp(() => ({
      status: 200,
      headers: {},
      body: JSON.stringify({
        number: 5,
        html_url: 'u',
        title: 't',
        state: 'closed',
        merged_at: '2026-01-01T00:00:00Z',
        head: { ref: 'h' },
        base: { ref: 'main' },
      }),
    }));
    const p = new GitHubProvider(http, silentLogger, { token: 'ghp_x' });
    const pr = await p.getPullRequest({ owner: 'a', repo: 'b', number: 5 });
    expect(pr?.state).toBe('merged');
  });
});

describe('GitHubProvider enterprise host', () => {
  it('uses /api/v3 base for enterprise hosts', async () => {
    let url = '';
    const http = mockHttp((opts) => {
      url = opts.url;
      return {
        status: 201,
        headers: {},
        body: JSON.stringify({ number: 1, html_url: 'u', title: 't', state: 'open', head: {}, base: {} }),
      };
    });
    const p = new GitHubProvider(http, silentLogger, { token: 't', host: 'https://ghe.acme.com' });
    await p.createPullRequest({ owner: 'a', repo: 'b', head: 'h', base: 'main', title: 't' });
    expect(url).toBe('https://ghe.acme.com/api/v3/repos/a/b/pulls');
  });
});

describe('GitHubProvider.getStatusChecks', () => {
  it('summarizes check runs', async () => {
    const http = mockHttp((opts) => {
      if (opts.url.includes('/pulls/7')) {
        return { status: 200, headers: {}, body: JSON.stringify({ head: { sha: 'abc' } }) };
      }
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          check_runs: [
            { status: 'completed', conclusion: 'success' },
            { status: 'completed', conclusion: 'failure' },
            { status: 'in_progress', conclusion: null },
          ],
        }),
      };
    });
    const p = new GitHubProvider(http, silentLogger, { token: 't' });
    const summary = await p.getStatusChecks({ owner: 'a', repo: 'b', number: 7 });
    expect(summary.total).toBe(3);
    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.pending).toBe(1);
    expect(summary.conclusion).toBe('failure');
  });
});

describe('SourceControlRegistry', () => {
  it('returns null active provider when set to none', () => {
    const reg = new SourceControlRegistry();
    const p = new GitHubProvider(mockHttp(() => ({ status: 200, headers: {}, body: '{}' })), silentLogger, { token: 't' });
    reg.register(p);
    reg.setActive('none');
    expect(reg.getActiveProvider()).toBeNull();
  });

  it('returns the github provider when active', () => {
    const reg = new SourceControlRegistry();
    const p = new GitHubProvider(mockHttp(() => ({ status: 200, headers: {}, body: '{}' })), silentLogger, { token: 't' });
    reg.register(p);
    reg.setActive('github');
    expect(reg.getActiveProvider()?.id).toBe('github');
    expect(reg.listProviderIds()).toContain('github');
  });
});
