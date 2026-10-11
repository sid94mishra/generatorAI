// The PR page's Merge control (D-146): disabled with the reason when the PR
// cannot be merged, and a confirmed merge sends the chosen method and the
// delete-branch choice. The platform is a stub — nothing reaches a server.

import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PullRequestDetail } from '@generatorai/shared';
import { PlatformContext } from '@/providers/PlatformProvider.js';
import { MergePullRequestCard } from './MergePullRequestCard.js';

const PR: PullRequestDetail = {
  provider: 'github',
  number: 7,
  url: 'https://github.com/acme/web/pull/7',
  title: 'Add widget',
  state: 'open',
  head: 'feature/widget',
  base: 'main',
  draft: false,
  body: '',
  mergeable: true,
  mergeableState: 'clean',
  additions: 1,
  deletions: 0,
  changedFiles: 1,
  commits: 1,
  headSha: 'a',
  baseSha: 'b',
  labels: [],
};

function wrap(node: ReactNode, platform: Record<string, unknown>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PlatformContext.Provider value={platform as never}>{node}</PlatformContext.Provider>
    </QueryClientProvider>,
  );
}

describe('MergePullRequestCard', () => {
  it('is disabled with the reason when the PR is already merged', () => {
    wrap(<MergePullRequestCard projectId="p1" codebaseId="cb" pr={{ ...PR, state: 'merged' }} />, {});
    expect(screen.getByTestId('pr-merge-blocked').textContent).toContain('already merged');
    expect(screen.getByRole('button', { name: 'Merge pull request' })).toHaveProperty('disabled', true);
  });

  it('is disabled while GitHub computes mergeability, and on conflicts', () => {
    const { unmount } = wrap(<MergePullRequestCard projectId="p1" codebaseId="cb" pr={{ ...PR, mergeable: null }} />, {});
    expect(screen.getByTestId('pr-merge-blocked').textContent).toContain('still checking');
    unmount();
    wrap(<MergePullRequestCard projectId="p1" codebaseId="cb" pr={{ ...PR, mergeable: false, mergeableState: 'dirty' }} />, {});
    expect(screen.getByTestId('pr-merge-blocked').textContent).toContain('conflicts');
  });

  it('confirms, then merges with the method and the delete-branch choice', async () => {
    const mergePullRequest = vi.fn(async () => ({ merged: true, sha: 'abc', message: 'Pull Request successfully merged', branchDeleted: true }));
    const invalidated = vi.fn(async () => undefined);
    wrap(<MergePullRequestCard projectId="p1" codebaseId="cb" pr={PR} />, { mergePullRequest, getPullRequest: invalidated });
    const user = userEvent.setup();

    await user.click(screen.getByRole('checkbox', { name: /Delete feature\/widget after merging/ }));
    await user.click(screen.getByRole('button', { name: 'Merge pull request' }));
    const dialog = await screen.findByTestId('pr-merge-confirm');
    expect(dialog.textContent).toContain('delete the head branch');
    expect(mergePullRequest).not.toHaveBeenCalled();

    const confirmButtons = screen.getAllByRole('button', { name: 'Merge pull request' });
    await user.click(confirmButtons[confirmButtons.length - 1]!);
    await waitFor(() => expect(mergePullRequest).toHaveBeenCalledWith('p1', 'cb', 7, { method: 'merge', deleteBranch: true }));
  });
});
