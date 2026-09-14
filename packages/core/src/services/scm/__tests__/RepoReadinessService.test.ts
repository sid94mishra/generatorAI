import { describe, it, expect, vi } from 'vitest';
import type { IGitClient } from '@generatorai/git';
import type {
  ISourceControlProvider,
  SourceControlRegistry,
} from '@generatorai/source-control';
import type { PullRequestSummary, SourceControlAccount } from '@generatorai/shared';
import { RepoReadinessService } from '../RepoReadinessService.js';
import { silentLogger, settings } from './helpers.js';

type GitOverrides = Partial<{
  isGitRepo: (dir: string) => Promise<boolean>;
  getRemoteUrl: (dir: string) => Promise<string | null>;
  currentBranch: (dir: string) => Promise<string | null>;
  isDetached: (dir: string) => Promise<boolean>;
  defaultBranch: (dir: string) => Promise<string | null>;
  changedFilesSummary: (dir: string) => Promise<Array<{ code: string; path: string }>>;
  upstreamOf: (dir: string, branch: string) => Promise<string | null>;
  aheadBehind: (
    dir: string,
    ref: string,
    upstream: string,
  ) => Promise<{ ahead: number; behind: number } | null>;
  mergeInProgress: (dir: string) => Promise<boolean>;
  unmergedFiles: (dir: string) => Promise<string[]>;
}>;

function fakeGit(overrides: GitOverrides = {}): IGitClient {
  const base = {
    isGitRepo: async () => true,
    getRemoteUrl: async () => 'https://github.com/acme/web.git',
    currentBranch: async () => 'feature/x',
    isDetached: async () => false,
    defaultBranch: async () => 'main',
    changedFilesSummary: async () => [{ code: 'M', path: 'src/a.ts' }],
    upstreamOf: async () => null,
    aheadBehind: async () => null,
    mergeInProgress: async () => false,
    unmergedFiles: async () => [],
  };
  return { ...base, ...overrides } as unknown as IGitClient;
}

const account: SourceControlAccount = {
  id: 'acc-1',
  provider: 'github',
  label: 'octocat @ github.com',
  authMethod: 'token',
  createdAt: new Date().toISOString(),
};

function fakeRegistry(opts: {
  connected?: boolean;
  openPr?: PullRequestSummary | null;
  prThrows?: boolean;
} = {}): SourceControlRegistry {
  const connected = opts.connected !== false;
  const provider = {
    id: 'github',
    findOpenPullRequestForHead: vi.fn(async () => {
      if (opts.prThrows) throw new Error('rate limited');
      return opts.openPr ?? null;
    }),
  } as unknown as ISourceControlProvider;
  return {
    providerFor: () => (connected ? provider : null),
    accountFor: () => (connected ? account : null),
  } as unknown as SourceControlRegistry;
}

function service(git: IGitClient, registry: SourceControlRegistry, defaultBase: string | null = null) {
  return new RepoReadinessService({
    git,
    registry,
    logger: silentLogger,
    settings: () => settings({ defaultBase }),
  });
}

describe('RepoReadinessService', () => {
  it('reports every reason as "Not a git repository" when the dir is not a repo', async () => {
    const svc = service(fakeGit({ isGitRepo: async () => false }), fakeRegistry());
    const r = await svc.readiness({ repoDir: '/tmp/x', alias: '.' });
    expect(r.isRepo).toBe(false);
    expect(r.can).toEqual({ commit: false, push: false, pullRequest: false });
    expect(r.reasons).toEqual({
      commit: 'Not a git repository',
      push: 'Not a git repository',
      pullRequest: 'Not a git repository',
    });
    expect(r.hasRemote).toBe(false);
    expect(r.branch).toBeNull();
    expect(r.conflictedFiles).toEqual([]);
    expect(r.openPullRequest).toBeNull();
  });

  it('says "Nothing to commit" on a clean tree', async () => {
    const svc = service(fakeGit({ changedFilesSummary: async () => [] }), fakeRegistry());
    const r = await svc.readiness({ repoDir: '/repo', alias: '.' });
    expect(r.dirty).toBe(false);
    expect(r.changedFiles).toBe(0);
    expect(r.can.commit).toBe(false);
    expect(r.reasons.commit).toBe('Nothing to commit');
  });

  it('uses the two different no-remote strings for push and PR', async () => {
    const svc = service(fakeGit({ getRemoteUrl: async () => null }), fakeRegistry());
    const r = await svc.readiness({ repoDir: '/repo', alias: '.' });
    expect(r.hasRemote).toBe(false);
    expect(r.reasons.push).toBe('No git remote configured');
    expect(r.reasons.pullRequest).toBe('No git remote');
    expect(r.can.commit).toBe(true);
  });

  it('names the host and points at Settings when it is not connected', async () => {
    const svc = service(fakeGit(), fakeRegistry({ connected: false }));
    const r = await svc.readiness({ repoDir: '/repo', alias: '.' });
    expect(r.connected).toBe(false);
    expect(r.reasons.pullRequest).toBe(
      'Remote host github.com is not connected — connect it in Settings → Source Control',
    );
    expect(r.providerId).toBeUndefined();
    expect(r.accountId).toBeUndefined();
  });

  it('blocks the PR on a detached HEAD', async () => {
    const svc = service(fakeGit({ isDetached: async () => true }), fakeRegistry());
    const r = await svc.readiness({ repoDir: '/repo', alias: '.' });
    expect(r.detached).toBe(true);
    expect(r.can.pullRequest).toBe(false);
    expect(r.reasons.pullRequest).toBe('Detached HEAD');
  });

  it('blocks the PR when there is nothing to propose', async () => {
    const svc = service(
      fakeGit({
        changedFilesSummary: async () => [],
        upstreamOf: async () => 'origin/feature/x',
        aheadBehind: async () => ({ ahead: 0, behind: 3 }),
      }),
      fakeRegistry(),
    );
    const r = await svc.readiness({ repoDir: '/repo', alias: '.' });
    expect(r.ahead).toBe(0);
    expect(r.behind).toBe(3);
    expect(r.hasUpstream).toBe(true);
    expect(r.reasons.pullRequest).toBe(
      'Nothing to open a PR from (branch has no commits ahead of base)',
    );
  });

  it('gives a merge in progress priority over "Nothing to commit"', async () => {
    const svc = service(
      fakeGit({
        changedFilesSummary: async () => [],
        mergeInProgress: async () => true,
        unmergedFiles: async () => ['src/a.ts'],
      }),
      fakeRegistry(),
    );
    const r = await svc.readiness({ repoDir: '/repo', alias: '.' });
    expect(r.mergeInProgress).toBe(true);
    expect(r.conflictedFiles).toEqual(['src/a.ts']);
    expect(r.reasons.commit).toBe('Merge in progress — resolve conflicts first');
  });

  it('swallows a provider error when looking up the open PR', async () => {
    const svc = service(fakeGit(), fakeRegistry({ prThrows: true }));
    const r = await svc.readiness({ repoDir: '/repo', alias: '.' });
    expect(r.openPullRequest).toBeNull();
    expect(r.can.pullRequest).toBe(true);
  });

  it('returns the open PR and the matched account when connected', async () => {
    const pr: PullRequestSummary = {
      provider: 'github',
      number: 7,
      url: 'https://github.com/acme/web/pull/7',
      title: 'Add a thing',
      state: 'open',
      head: 'feature/x',
      base: 'main',
    };
    const svc = service(fakeGit(), fakeRegistry({ openPr: pr }));
    const r = await svc.readiness({ repoDir: '/repo', alias: '.' });
    expect(r.openPullRequest).toEqual(pr);
    expect(r.providerId).toBe('github');
    expect(r.accountId).toBe('acc-1');
    expect(r.slug).toEqual({ owner: 'acme', repo: 'web', host: 'github.com' });
  });

  it('falls back to settings.defaultBase when git cannot resolve the default branch', async () => {
    const svc = service(fakeGit({ defaultBranch: async () => null }), fakeRegistry(), 'trunk');
    const r = await svc.readiness({ repoDir: '/repo', alias: '.' });
    expect(r.defaultBranch).toBe('trunk');
    expect(r.onDefaultBranch).toBe(false);
  });

  it('flags onDefaultBranch and never throws when a probe fails', async () => {
    const svc = service(
      fakeGit({
        currentBranch: async () => 'main',
        isDetached: async () => {
          throw new Error('git blew up');
        },
      }),
      fakeRegistry(),
    );
    const r = await svc.readiness({ repoDir: '/repo', alias: '.' });
    expect(r.onDefaultBranch).toBe(true);
    expect(r.detached).toBe(false);
  });
});
