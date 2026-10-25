// ────────────────────────────────────────────────────────────────
// ShipButton + ShipDialog — commit / push / pull request from the Changes
// toolbar (D-163; ported from the CommitBar tests, same assertions).
//
// Everything is readiness-driven, so what these tests pin is: each state
// says what it can do and, when it cannot, exactly why — plus the request
// body the flow actually sends, which is the contract the server is built
// against.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { PlatformContext } from '@/providers/PlatformProvider.js';
import { ShipButton } from '@/blocks/scm/ShipDialog.js';
import type { IPlatformClient, RepoReadiness, ScmFlowResult } from '@generatorai/shared';

function repo(overrides: Partial<RepoReadiness> = {}): RepoReadiness {
  return {
    alias: '.',
    repoDir: '/w/repo',
    isRepo: true,
    hasRemote: true,
    connected: true,
    branch: 'generatorai/work',
    detached: false,
    defaultBranch: 'main',
    onDefaultBranch: false,
    dirty: true,
    changedFiles: 3,
    ahead: 2,
    behind: 0,
    hasUpstream: true,
    mergeInProgress: false,
    conflictedFiles: [],
    openPullRequest: null,
    can: { commit: true, push: true, pullRequest: true },
    reasons: {},
    ...overrides,
  };
}

function okFlow(): ScmFlowResult {
  return {
    status: 'ok',
    alias: '.',
    steps: [
      { id: 'commit', status: 'done' },
      { id: 'push', status: 'done' },
    ],
    commit: { sha: 'abc1234def', message: 'Update three files' },
    pushed: true,
    readiness: repo(),
  };
}

function conflictFlow(): ScmFlowResult {
  return {
    status: 'conflicts',
    alias: '.',
    steps: [
      { id: 'commit', status: 'done' },
      { id: 'sync', status: 'blocked', detail: '1 file conflicts' },
    ],
    conflicts: { base: 'release/2.0', head: 'generatorai/work', files: ['src/a.ts'], mergeStarted: false },
    readiness: repo(),
  };
}

function makePlatform(repos: RepoReadiness[], overrides: Record<string, unknown> = {}) {
  return {
    getWorkspaceScmReadiness: vi.fn().mockResolvedValue({ workspaceId: 'w1', repos }),
    runWorkspaceScmFlow: vi.fn().mockResolvedValue(okFlow()),
    generateScmText: vi.fn().mockResolvedValue({
      kind: 'commit',
      message: 'Refactor the auth module',
      source: 'model',
    }),
    startScmConflictResolution: vi.fn().mockResolvedValue({ ok: true }),
    continueScmConflictResolution: vi.fn().mockResolvedValue({ ok: true }),
    abortScmConflictResolution: vi.fn().mockResolvedValue({ ok: true }),
    resolveScmConflictWithAgent: vi.fn().mockResolvedValue({ ok: true }),
    getWorkspaceChangeSummary: vi.fn().mockResolvedValue({
      workspaceId: 'w1',
      stats: { files: 1, additions: 2, deletions: 0 },
      repos: [{ alias: '.', kind: 'git', hasBaseline: true, stats: { files: 1, additions: 2, deletions: 0 }, files: [{ path: 'src/a.ts', status: 'modified', additions: 2, deletions: 0, isBinary: false, isTooLarge: false }] }],
    }),
    getScmBranches: vi.fn().mockResolvedValue({ alias: '.', defaultBranch: 'main', current: 'generatorai/work', branches: ['main', 'release'], fresh: true }),
    getScmCompare: vi.fn().mockResolvedValue({
      alias: '.', base: 'main', head: 'generatorai/work', commits: [], files: [], additions: 0, deletions: 0, behind: 0,
      mergeable: 'clean', conflictFiles: [], uncommittedFiles: 3,
    }),
    getScmPullRequestOptions: vi.fn().mockResolvedValue({
      alias: '.', available: true, viewer: 'me', people: [{ login: 'me' }, { login: 'ana' }], labels: [{ name: 'bug', color: 'ff0000' }], issues: [{ number: 7, title: 'Broken' }],
    }),
    ...overrides,
  };
}

function renderPanel(platform: ReturnType<typeof makePlatform>, props: Record<string, unknown> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <PlatformContext.Provider value={platform as unknown as IPlatformClient}>
        <MemoryRouter>
          <ShipButton workspaceId="w1" {...props} />
        </MemoryRouter>
      </PlatformContext.Provider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});
afterEach(() => vi.unstubAllGlobals());

/** The toolbar button opens the dialog. */
async function openDialog() {
  fireEvent.click(await screen.findByTestId('scm-open-dialog'));
  return screen.findByTestId('scm-dialog');
}

describe('ShipButton / ShipDialog', () => {
  it('shows the branch, its standing against the base and what a push would send', async () => {
    renderPanel(makePlatform([repo({ vsBase: { branch: 'main', ahead: 3, behind: 1 } })]));
    await openDialog();
    const line = await screen.findByTestId('scm-status-line');
    expect(line).toHaveTextContent('generatorai/work');
    expect(line).toHaveTextContent('3 commits ahead of main, 1 behind');
    expect(line).toHaveTextContent('2 commits not pushed');
  });

  it('names an unborn branch, says it has no commits, and offers the commit', async () => {
    renderPanel(
      makePlatform([
        repo({
          alias: 'main',
          branch: 'main',
          unborn: true,
          hasRemote: false,
          connected: false,
          hasUpstream: false,
          onDefaultBranch: true,
          can: { commit: true, push: false, pullRequest: false },
          reasons: { push: 'No remote configured', pullRequest: 'No remote' },
        }),
      ]),
    );
    await openDialog();
    const line = await screen.findByTestId('scm-status-line');
    expect(line).toHaveTextContent('main');
    expect(line).not.toHaveTextContent('detached');
    expect(screen.getByTestId('scm-no-commits')).toHaveTextContent('No commits yet');
    expect(screen.queryByText('Nothing to commit')).toBeNull();
    expect(screen.getByTestId('scm-run-flow')).toBeEnabled();
  });

  it('links an already-open pull request', async () => {
    renderPanel(
      makePlatform([
        repo({
          openPullRequest: {
            provider: 'github',
            number: 12,
            url: 'https://github.com/o/r/pull/12',
            title: 'Work',
            state: 'open',
            head: 'generatorai/work',
            base: 'main',
          },
        }),
      ]),
    );
    await openDialog();
    const link = await screen.findByTestId('scm-open-pr-link');
    expect(link).toHaveTextContent('PR #12 open');
    expect(link).toHaveAttribute('href', 'https://github.com/o/r/pull/12');
  });

  it('offers no ship button when the mount is not a repo', async () => {
    const platform = makePlatform([
      repo({ isRepo: false, hasRemote: false, connected: false, can: { commit: false, push: false, pullRequest: false } }),
    ]);
    renderPanel(platform);
    await waitFor(() => expect(platform.getWorkspaceScmReadiness).toHaveBeenCalled());
    expect(screen.queryByTestId('scm-open-dialog')).toBeNull();
  });

  it('names the next step on the button: Push for unpushed commits, PR #n once one is open', async () => {
    renderPanel(makePlatform([repo({ dirty: false, changedFiles: 0, ahead: 1 })]));
    expect(await screen.findByTestId('scm-open-dialog')).toHaveTextContent('Push');
  });

  it('still lets you commit and push when only pull requests need an account', async () => {
    // The whole form used to disappear behind "Remote host is not connected".
    // Committing has nothing to do with a forge account, and the server said
    // so (`can.commit`, `can.push`) — the user just could not get at it.
    const platform = makePlatform([
      repo({
        connected: false,
        remoteUrl: 'https://github.com/acme/shop.git',
        can: { commit: true, push: true, pullRequest: false },
        reasons: { pullRequest: 'Remote host github.com is not connected — connect it in Settings → Source Control' },
      }),
    ]);
    renderPanel(platform);
    await openDialog();

    expect(await screen.findByTestId('scm-commit-message')).toBeInTheDocument();
    expect(screen.queryByTestId('scm-blocked')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Commit & open PR' })).toHaveAttribute('aria-disabled', 'true');
    // The one fixable thing is still one click away.
    expect(screen.getByTestId('scm-connect-github')).toHaveAttribute('href', '/settings/source-control');

    fireEvent.click(screen.getByTestId('scm-run-flow'));
    await waitFor(() =>
      expect(platform.runWorkspaceScmFlow).toHaveBeenCalledWith('w1', {
        alias: '.',
        commit: { generate: true },
        push: true,
      }),
    );
  });

  it('does not offer "Connect GitHub" for a remote that is a local path', async () => {
    renderPanel(
      makePlatform([
        repo({
          connected: false,
          remoteUrl: '../origin.git',
          can: { commit: true, push: true, pullRequest: false },
          reasons: { pullRequest: 'Remote host unknown is not connected — connect it in Settings → Source Control' },
        }),
      ]),
    );
    await openDialog();
    expect(await screen.findByTestId('scm-commit-message')).toBeInTheDocument();
    expect(screen.queryByTestId('scm-connect-github')).not.toBeInTheDocument();
  });

  it('commits locally, and asks for no push, when the repo has no remote', async () => {
    const platform = makePlatform([
      repo({
        hasRemote: false,
        connected: false,
        hasUpstream: false,
        can: { commit: true, push: false, pullRequest: false },
        reasons: { push: 'No git remote configured', pullRequest: 'No git remote configured' },
      }),
    ]);
    renderPanel(platform);
    await openDialog();

    const run = await screen.findByTestId('scm-run-flow');
    expect(run).toHaveTextContent(/^Commit$/);
    expect(screen.getByRole('radio', { name: 'Commit & push' })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(run);
    await waitFor(() =>
      expect(platform.runWorkspaceScmFlow).toHaveBeenCalledWith('w1', {
        alias: '.',
        commit: { generate: true },
        push: false,
      }),
    );
  });

  it('asks the server to generate a commit message', async () => {
    const platform = makePlatform([repo()]);
    renderPanel(platform, { hint: 'Refactor auth' });
    await openDialog();

    fireEvent.click(await screen.findByTestId('scm-generate-commit'));

    await waitFor(() =>
      expect(platform.generateScmText).toHaveBeenCalledWith('w1', {
        alias: '.',
        kind: 'commit',
        hint: 'Refactor auth',
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('scm-commit-message')).toHaveValue('Refactor the auth module'),
    );
  });

  it('sends commit+push by default, and asks the server to write the message', async () => {
    const platform = makePlatform([repo()]);
    renderPanel(platform);
    await openDialog();

    fireEvent.click(await screen.findByTestId('scm-run-flow'));

    await waitFor(() =>
      expect(platform.runWorkspaceScmFlow).toHaveBeenCalledWith('w1', {
        alias: '.',
        commit: { generate: true },
        push: true,
      }),
    );
  });

  it('composes the full request when a PR is requested', async () => {
    const platform = makePlatform([repo()]);
    renderPanel(platform, { hint: 'Chat name' });
    await openDialog();

    fireEvent.change(screen.getByTestId('scm-commit-message'), { target: { value: 'Fix the thing' } });
    fireEvent.change(screen.getByTestId('scm-commit-description'), { target: { value: 'It was broken.' } });
    await userEvent.click(screen.getByRole('radio', { name: 'Commit & open PR' }));
    await waitFor(() => expect(platform.getScmCompare).toHaveBeenCalledWith('w1', { alias: '.', base: 'main' }));
    expect(await screen.findByText(/Able to merge/)).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('scm-pr-title'), { target: { value: 'Fix the thing' } });
    fireEvent.change(screen.getByTestId('scm-pr-body'), { target: { value: 'Because it was broken.' } });
    await userEvent.click(await screen.findByRole('button', { name: 'Assign yourself' }));
    // Draft lives behind the split button, the way GitHub offers it.
    await userEvent.click(screen.getByRole('button', { name: 'More ways to open it' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Create draft pull request' }));

    await waitFor(() =>
      expect(platform.runWorkspaceScmFlow).toHaveBeenCalledWith('w1', {
        alias: '.',
        commit: { message: 'Fix the thing\n\nIt was broken.' },
        push: true,
        pullRequest: {
          title: 'Fix the thing',
          body: 'Because it was broken.',
          base: 'main',
          draft: true,
          assignees: ['me'],
        },
        hint: 'Chat name',
      }),
    );
  });

  it('reports the commit and the push when the flow succeeds', async () => {
    renderPanel(makePlatform([repo()]));
    await openDialog();
    fireEvent.click(await screen.findByTestId('scm-run-flow'));
    const ok = await screen.findByTestId('scm-result-ok');
    expect(ok).toHaveTextContent('abc1234');
    expect(ok).toHaveTextContent('pushed');
  });

  it('shows the failing step when the flow is blocked', async () => {
    const platform = makePlatform([repo()], {
      runWorkspaceScmFlow: vi.fn().mockResolvedValue({
        status: 'blocked',
        alias: '.',
        steps: [{ id: 'readiness', status: 'blocked', detail: 'Detached HEAD' }],
        readiness: repo(),
      } satisfies ScmFlowResult),
    });
    renderPanel(platform);
    await openDialog();
    fireEvent.click(await screen.findByTestId('scm-run-flow'));
    expect(await screen.findByTestId('scm-result-problem')).toHaveTextContent('Detached HEAD');
  });

  describe('conflicts', () => {
    it('renders the conflict card with the file list and the three actions', async () => {
      const platform = makePlatform([repo()], {
        runWorkspaceScmFlow: vi.fn().mockResolvedValue(conflictFlow()),
      });
      renderPanel(platform, { chatId: 'c1' });
      await openDialog();
      fireEvent.click(await screen.findByTestId('scm-run-flow'));

      expect(await screen.findByTestId('scm-conflict-card')).toHaveTextContent('release/2.0');
      expect(screen.getByTestId('scm-conflict-files')).toHaveTextContent('src/a.ts');
      expect(screen.getByTestId('scm-conflict-manual')).toBeInTheDocument();
      expect(screen.getByTestId('scm-conflict-agent')).toBeInTheDocument();
      expect(screen.getByTestId('scm-conflict-abort')).toBeInTheDocument();
    });

    it('hides "Ask the agent" where no chat is in scope (a workflow run)', async () => {
      const platform = makePlatform([repo()], {
        runWorkspaceScmFlow: vi.fn().mockResolvedValue(conflictFlow()),
      });
      renderPanel(platform);
      await openDialog();
      fireEvent.click(await screen.findByTestId('scm-run-flow'));
      await screen.findByTestId('scm-conflict-card');
      expect(screen.queryByTestId('scm-conflict-agent')).toBeNull();
    });

    it('Resolve manually applies the merge, then Continue re-runs the flow', async () => {
      const runFlow = vi
        .fn()
        .mockResolvedValueOnce(conflictFlow())
        .mockResolvedValueOnce(okFlow());
      const platform = makePlatform([repo()], { runWorkspaceScmFlow: runFlow });
      renderPanel(platform, { chatId: 'c1' });
      await openDialog();

      fireEvent.click(await screen.findByTestId('scm-run-flow'));
      fireEvent.click(await screen.findByTestId('scm-conflict-manual'));

      await waitFor(() =>
        expect(platform.startScmConflictResolution).toHaveBeenCalledWith('w1', { alias: '.', base: 'release/2.0' }),
      );
      expect(await screen.findByTestId('scm-conflict-instructions')).toHaveTextContent(
        /conflict markers/,
      );

      fireEvent.click(screen.getByTestId('scm-conflict-continue'));
      await waitFor(() =>
        expect(platform.continueScmConflictResolution).toHaveBeenCalledWith('w1', { alias: '.', base: 'release/2.0' }),
      );
      // The push only happens after Continue — that is the guardrail.
      await waitFor(() => expect(runFlow).toHaveBeenCalledTimes(2));
      expect(await screen.findByTestId('scm-result-ok')).toHaveTextContent('abc1234');
    });

    it('Ask the agent hands the files to this chat and waits for a review', async () => {
      const platform = makePlatform([repo()], {
        runWorkspaceScmFlow: vi.fn().mockResolvedValue(conflictFlow()),
      });
      renderPanel(platform, { chatId: 'c1' });
      await openDialog();

      fireEvent.click(await screen.findByTestId('scm-run-flow'));
      fireEvent.click(await screen.findByTestId('scm-conflict-agent'));

      await waitFor(() =>
        expect(platform.resolveScmConflictWithAgent).toHaveBeenCalledWith('w1', {
          alias: '.',
          base: 'release/2.0',
          chatId: 'c1',
        }),
      );
      expect(await screen.findByTestId('scm-conflict-instructions')).toHaveTextContent(
        /agent is resolving/i,
      );
    });

    it('Abort clears the result without touching the branch', async () => {
      const platform = makePlatform([repo()], {
        runWorkspaceScmFlow: vi.fn().mockResolvedValue(conflictFlow()),
      });
      renderPanel(platform);
      await openDialog();

      fireEvent.click(await screen.findByTestId('scm-run-flow'));
      fireEvent.click(await screen.findByTestId('scm-conflict-abort'));

      await waitFor(() =>
        expect(platform.abortScmConflictResolution).toHaveBeenCalledWith('w1', { alias: '.', base: 'release/2.0' }),
      );
      await waitFor(() => expect(screen.queryByTestId('scm-conflict-card')).toBeNull());
    });

    it('surfaces paths still unresolved when Continue is premature', async () => {
      const platform = makePlatform([repo()], {
        runWorkspaceScmFlow: vi.fn().mockResolvedValue({
          ...conflictFlow(),
          conflicts: { base: 'main', head: 'generatorai/work', files: ['src/a.ts'], mergeStarted: true },
        }),
        continueScmConflictResolution: vi
          .fn()
          .mockResolvedValue({ ok: false, unmerged: ['src/a.ts'] }),
      });
      renderPanel(platform);
      await openDialog();

      fireEvent.click(await screen.findByTestId('scm-run-flow'));
      // `mergeStarted` means the card opens straight into "edit, then Continue".
      fireEvent.click(await screen.findByTestId('scm-conflict-continue'));

      expect(await screen.findByTestId('scm-conflict-error')).toHaveTextContent('src/a.ts');
    });
  });

  it('lets the user pick which mount to act on', async () => {
    const platform = makePlatform([repo(), repo({ alias: 'docs', dirty: false })]);
    renderPanel(platform);
    await openDialog();

    fireEvent.click(await screen.findByRole('button', { name: 'docs' }));
    fireEvent.click(screen.getByTestId('scm-run-flow'));

    await waitFor(() =>
      expect(platform.runWorkspaceScmFlow).toHaveBeenCalledWith(
        'w1',
        expect.objectContaining({ alias: 'docs' }),
      ),
    );
  });
});
