// ────────────────────────────────────────────────────────────────
// The in-app pull-request view.
//
// Reading a PR in the app only pays for itself if it answers the questions
// GitHub's page would — can it merge, did the checks pass, what changed —
// and then does the thing GitHub cannot: hand the diff to an agent. These
// tests pin that, plus the two states that are easy to get silently wrong
// (mergeability still computing, a file with no patch).
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { PlatformContext } from '@/providers/PlatformProvider.js';
import { PullRequestPage } from '@/pages/PullRequestPage.js';
import type { IPlatformClient, PullRequestDetail } from '@generatorai/shared';

const PATH = '/projects/p1/codebases/cb1/pull-requests/12';

function detail(overrides: Partial<PullRequestDetail> = {}): PullRequestDetail {
  return {
    provider: 'github',
    number: 12,
    url: 'https://github.com/o/r/pull/12',
    title: 'Refactor the auth module',
    state: 'open',
    head: 'generatorai/auth',
    base: 'main',
    draft: false,
    author: 'octocat',
    body: '## Why\n\nThe module had grown three ways to do the same thing.',
    mergeable: true,
    mergeableState: 'clean',
    additions: 42,
    deletions: 17,
    changedFiles: 2,
    commits: 3,
    headSha: 'aaa',
    baseSha: 'bbb',
    labels: [],
    checks: { total: 4, passed: 4, failed: 0, pending: 0, conclusion: 'success' },
    ...overrides,
  };
}

function makePlatform(overrides: Record<string, unknown> = {}) {
  return {
    getPullRequest: vi.fn().mockResolvedValue(detail()),
    getPullRequestFiles: vi.fn().mockResolvedValue([
      {
        path: 'src/auth.ts',
        status: 'modified',
        additions: 2,
        deletions: 1,
        patch: '@@ -1,3 +1,4 @@\n const a = 1;\n-const b = 2;\n+const b = 3;\n+const c = 4;\n',
      },
      { path: 'assets/logo.png', status: 'added', additions: 0, deletions: 0 },
    ]),
    getPullRequestComments: vi.fn().mockResolvedValue([
      {
        id: 'c1',
        author: 'reviewer',
        body: 'Looks good, one nit.',
        createdAt: '2026-02-01T10:00:00Z',
        kind: 'issue',
      },
    ]),
    createPullRequestReviewChat: vi.fn().mockResolvedValue({ chat: { id: 'chat-9' } }),
    ...overrides,
  };
}

function renderPage(platform: ReturnType<typeof makePlatform>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      { path: '/projects/:id/codebases/:cid/pull-requests/:number', element: <PullRequestPage /> },
      { path: '/chats/:id', element: <div data-testid="chat-page">Chat</div> },
      { path: '/projects/:id', element: <div data-testid="project-page">Project</div> },
    ],
    { initialEntries: [PATH] },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <PlatformContext.Provider value={platform as unknown as IPlatformClient}>
        <RouterProvider router={router} />
      </PlatformContext.Provider>
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});
afterEach(() => vi.unstubAllGlobals());

describe('PullRequestPage', () => {
  it('renders the header, the branches and the link back to the host', async () => {
    renderPage(makePlatform());
    expect(await screen.findByText('Refactor the auth module')).toBeInTheDocument();
    expect(screen.getByText('open')).toBeInTheDocument();
    expect(screen.getByText('octocat')).toBeInTheDocument();
    expect(screen.getByText('generatorai/auth → main')).toBeInTheDocument();
    expect(screen.getByTestId('pr-open-on-github')).toHaveAttribute(
      'href',
      'https://github.com/o/r/pull/12',
    );
  });

  it('reports mergeability and the checks roll-up', async () => {
    renderPage(makePlatform());
    expect(await screen.findByTestId('pr-mergeable')).toHaveTextContent('Mergeable');
    expect(screen.getByTestId('pr-checks')).toHaveTextContent('4/4 checks passed');
  });

  it('says mergeability is still being computed rather than claiming "not mergeable"', async () => {
    renderPage(makePlatform({ getPullRequest: vi.fn().mockResolvedValue(detail({ mergeable: null })) }));
    expect(await screen.findByTestId('pr-mergeable')).toHaveTextContent(/computing/i);
  });

  it('renders the description as markdown', async () => {
    renderPage(makePlatform());
    const body = await screen.findByTestId('pr-body');
    expect(body).toHaveTextContent('The module had grown three ways to do the same thing.');
  });

  it('lists the files and renders a diff only once one is expanded', async () => {
    renderPage(makePlatform());
    const rows = await screen.findAllByTestId('pr-file-row');
    expect(rows).toHaveLength(2);
    expect(screen.queryByTestId('inline-diff')).toBeNull();

    fireEvent.click(rows[0]!);
    expect(await screen.findByTestId('inline-diff')).toHaveTextContent('const b = 3;');
  });

  it('explains a file that carries no patch instead of rendering an empty box', async () => {
    renderPage(makePlatform());
    const rows = await screen.findAllByTestId('pr-file-row');
    fireEvent.click(rows[1]!);
    expect(await screen.findByText(/No diff available for this file/)).toBeInTheDocument();
  });

  it('lists the comments', async () => {
    renderPage(makePlatform());
    expect(await screen.findByText('Looks good, one nit.')).toBeInTheDocument();
    expect(screen.getByText('reviewer')).toBeInTheDocument();
  });

  it('starts a review chat with the typed instructions and lands in it', async () => {
    const platform = makePlatform();
    const router = renderPage(platform);

    fireEvent.change(await screen.findByTestId('pr-review-instructions'), {
      target: { value: 'Focus on the token refresh path.' },
    });
    fireEvent.click(screen.getByTestId('pr-review-start'));

    await waitFor(() =>
      expect(platform.createPullRequestReviewChat).toHaveBeenCalledWith('p1', 'cb1', 12, {
        instructions: 'Focus on the token refresh path.',
      }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/chats/chat-9'));
  });

  it('shows the failure rather than a blank page when the PR cannot be loaded', async () => {
    renderPage(
      makePlatform({ getPullRequest: vi.fn().mockRejectedValue(new Error('404 Not Found')) }),
    );
    expect(await screen.findByText('404 Not Found')).toBeInTheDocument();
  });
});
