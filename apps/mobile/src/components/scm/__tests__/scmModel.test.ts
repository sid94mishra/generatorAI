import { describe, expect, it } from 'vitest';
import type { RepoReadiness, ScmFlowResult } from '@generatorai/shared';

import {
  CONNECT_ON_DESKTOP,
  actionReason,
  blockedReason,
  buildFlowRequest,
  describeFlowResult,
  emptyFlowForm,
  hasAnyAction,
  pickRepo,
  plannedSteps,
  readinessLine,
  resumeAfterConflictsRequest,
  runLabel,
  summarizeFlow,
} from '../scmModel';

function readiness(over: Partial<RepoReadiness> = {}): RepoReadiness {
  return {
    alias: '.',
    repoDir: '/w/app',
    isRepo: true,
    hasRemote: true,
    remoteUrl: 'git@github.com:acme/app.git',
    slug: { owner: 'acme', repo: 'app', host: 'github.com' },
    providerId: 'github',
    accountId: 'acc-1',
    connected: true,
    branch: 'generatorai/cart-fix',
    detached: false,
    defaultBranch: 'main',
    onDefaultBranch: false,
    dirty: true,
    changedFiles: 3,
    ahead: 2,
    behind: 1,
    hasUpstream: true,
    mergeInProgress: false,
    conflictedFiles: [],
    openPullRequest: null,
    can: { commit: true, push: true, pullRequest: true },
    reasons: {},
    ...over,
  };
}

/** The four states the commit bar has to get right. */
const NOT_A_REPO = readiness({
  isRepo: false,
  hasRemote: false,
  connected: false,
  branch: null,
  defaultBranch: null,
  dirty: false,
  changedFiles: 0,
  ahead: null,
  behind: null,
  hasUpstream: false,
  can: { commit: false, push: false, pullRequest: false },
  reasons: { commit: 'Not a git repository', push: 'No git remote configured' },
});

const NOT_CONNECTED = readiness({
  connected: false,
  accountId: undefined,
  can: { commit: true, push: true, pullRequest: false },
  reasons: {
    pullRequest: 'Remote host github.com is not connected — connect it in Settings → Source Control',
  },
});

const IN_CONFLICT = readiness({
  mergeInProgress: true,
  conflictedFiles: ['src/a.ts', 'src/b.ts'],
  can: { commit: false, push: false, pullRequest: false },
  reasons: { commit: 'Merge in progress — resolve conflicts first' },
});

describe('readiness states', () => {
  it('describes a ready mount on one line', () => {
    expect(readinessLine(readiness())).toBe('generatorai/cart-fix · ↑2 ↓1 · 3 files');
    expect(readinessLine(readiness({ ahead: 0, behind: 0, changedFiles: 0, dirty: false }))).toBe(
      'generatorai/cart-fix · in sync',
    );
    expect(readinessLine(readiness({ detached: true }))).toMatch(/^detached HEAD/);
    expect(readinessLine(IN_CONFLICT)).toContain('merge in progress');
  });

  it('says a folder is not a repository, and offers nothing', () => {
    expect(readinessLine(NOT_A_REPO)).toBe('Not a git repository');
    expect(hasAnyAction(NOT_A_REPO)).toBe(false);
    expect(actionReason(NOT_A_REPO, 'commit')).toBe('Not a git repository');
  });

  it('rewrites the not-connected reason for a device that cannot connect anything', () => {
    const reason = actionReason(NOT_CONNECTED, 'pullRequest');
    expect(reason).toContain('Remote host github.com is not connected');
    expect(reason).toContain(CONNECT_ON_DESKTOP);
    // The server's desktop wording is replaced by the phone's own path
    // (Settings › Source control now connects GitHub via the device flow).
    expect(reason).not.toContain('Settings → Source Control');
    // Committing and pushing are still possible without a host account.
    expect(actionReason(NOT_CONNECTED, 'commit')).toBeNull();
    expect(hasAnyAction(NOT_CONNECTED)).toBe(true);
  });

  it('falls back to the host when the server gave no reason at all', () => {
    const bare = readiness({
      connected: false,
      can: { commit: true, push: false, pullRequest: false },
      reasons: {},
    });
    expect(actionReason(bare, 'push')).toBe(`github.com is not connected. ${CONNECT_ON_DESKTOP}`);
  });

  it('reports a merge in progress rather than an empty bar', () => {
    expect(hasAnyAction(IN_CONFLICT)).toBe(false);
    expect(actionReason(IN_CONFLICT, 'commit')).toBe('Merge in progress — resolve conflicts first');
  });

  it('acts on the named mount, else the first that can commit', () => {
    const repos = [NOT_A_REPO, readiness({ alias: 'api' })];
    expect(pickRepo(repos, 'api')?.alias).toBe('api');
    expect(pickRepo(repos)?.alias).toBe('api');
    expect(pickRepo(repos, 'gone')?.alias).toBe('api');
    expect(pickRepo([])).toBeNull();
  });
});

describe('buildFlowRequest', () => {
  it('generates a message when none was typed, and asks for nothing else', () => {
    expect(buildFlowRequest(emptyFlowForm('.'))).toEqual({
      alias: '.',
      commit: { generate: true },
      push: false,
    });
  });

  it('sends the typed message and the pull request the user filled in', () => {
    expect(
      buildFlowRequest({
        alias: 'api',
        message: '  fix the cart  ',
        push: false,
        pullRequest: true,
        title: ' Fix the cart ',
        body: ' Details ',
        base: ' main ',
        draft: true,
        hint: ' Cart fix ',
      }),
    ).toEqual({
      alias: 'api',
      commit: { message: 'fix the cart' },
      // A pull request implies a push.
      push: true,
      pullRequest: { title: 'Fix the cart', body: 'Details', base: 'main', draft: true },
      hint: 'Cart fix',
    });
  });

  it('asks the server to write the pull request when the text is incomplete', () => {
    const request = buildFlowRequest({ ...emptyFlowForm('.'), pullRequest: true, title: 'Only a title' });
    expect(request.pullRequest).toEqual({ title: 'Only a title', generate: true });
  });

  it('plans the steps the request will run', () => {
    expect(plannedSteps(buildFlowRequest(emptyFlowForm('.')))).toEqual(['readiness', 'commit']);
    expect(
      plannedSteps(buildFlowRequest({ ...emptyFlowForm('.'), push: true, pullRequest: true })),
    ).toEqual(['readiness', 'branch', 'commit', 'sync', 'push', 'pull_request']);
  });

  it('finishes a conflicted run without committing or syncing again', () => {
    const form = { ...emptyFlowForm('.'), push: true, pullRequest: true, title: 'T', body: 'B' };
    const resume = resumeAfterConflictsRequest(form);
    expect(resume.commit).toBeUndefined();
    expect(resume.sync).toBe(false);
    expect(resume.push).toBe(true);
    expect(plannedSteps(resume)).toEqual(['readiness', 'branch', 'push', 'pull_request']);
  });

  it('labels the action it will perform', () => {
    expect(runLabel({ push: false, pullRequest: false })).toBe('Commit');
    expect(runLabel({ push: true, pullRequest: false })).toBe('Commit & push');
    expect(runLabel({ push: true, pullRequest: true })).toBe('Commit, push & open PR');
  });
});

function flowResult(over: Partial<ScmFlowResult> = {}): ScmFlowResult {
  return {
    status: 'ok',
    alias: '.',
    steps: [{ id: 'commit', status: 'done' }],
    readiness: readiness(),
    ...over,
  };
}

describe('flow results', () => {
  it('summarises what happened', () => {
    expect(
      summarizeFlow(
        flowResult({
          commit: { sha: 'abc1234def', message: 'fix' },
          pushed: true,
          pullRequest: {
            provider: 'github',
            number: 12,
            url: 'https://github.com/acme/app/pull/12',
            title: 'Fix',
            state: 'open',
            head: 'f',
            base: 'main',
          },
        }),
      ),
    ).toBe('Committed abc1234 · pushed · PR #12');
    expect(summarizeFlow(flowResult())).toBe('Nothing to commit');
  });

  it('offers the pull request as the toast action', () => {
    const outcome = describeFlowResult(
      flowResult({
        commit: { sha: 'abc1234', message: 'fix' },
        pushed: true,
        pullRequest: {
          provider: 'github',
          number: 7,
          url: 'https://example.test/pr/7',
          title: 'Fix',
          state: 'open',
          head: 'f',
          base: 'main',
        },
      }),
    );
    expect(outcome).toMatchObject({ tone: 'success', url: 'https://example.test/pr/7', prNumber: 7, conflicts: false });
  });

  it('turns conflicts into the conflict card, not a failure', () => {
    const outcome = describeFlowResult(
      flowResult({
        status: 'conflicts',
        conflicts: { base: 'main', head: 'feat', files: ['a.ts', 'b.ts'], mergeStarted: false },
      }),
    );
    expect(outcome).toMatchObject({ conflicts: true, tone: 'warning' });
    expect(outcome.message).toBe('Merge conflicts in 2 files');
  });

  it('reports a blocked run in the words a phone can act on', () => {
    const outcome = describeFlowResult(
      flowResult({
        status: 'blocked',
        readiness: NOT_CONNECTED,
        steps: [
          { id: 'readiness', status: 'blocked', detail: 'Remote host github.com is not connected — connect it in Settings → Source Control' },
        ],
      }),
    );
    expect(outcome.tone).toBe('warning');
    expect(outcome.message).toContain(CONNECT_ON_DESKTOP);
  });

  it('prefers the error a failed run carried', () => {
    expect(blockedReason(flowResult({ status: 'failed', error: 'push rejected' }))).toBe('push rejected');
    expect(describeFlowResult(flowResult({ status: 'failed', error: 'push rejected' })).tone).toBe('danger');
  });
});

describe('emptyFlowForm push default', () => {
  it('matches the desktop Changes tab: on when the mount can push, off when it cannot', () => {
    expect(emptyFlowForm('.', true).push).toBe(true);
    expect(emptyFlowForm('.', false).push).toBe(false);
    expect(emptyFlowForm('.').push).toBe(false);
  });
});
