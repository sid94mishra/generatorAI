// ────────────────────────────────────────────────────────────────
// Pure rules behind the PR page's Merge control and the issue pages (D-146):
// when a merge is offered and why not, what each merge method is called, the
// "Fix in chat" first message, and the label field's parsing.
// ────────────────────────────────────────────────────────────────

import type { IssueSummary, PullRequestDetail, PullRequestMergeMethod } from '@generatorai/shared';

export const MERGE_METHODS: readonly PullRequestMergeMethod[] = ['merge', 'squash', 'rebase'];

/** The primary button's label for each method (GitHub's own wording). */
export const MERGE_METHOD_LABEL: Record<PullRequestMergeMethod, string> = {
  merge: 'Merge pull request',
  squash: 'Squash and merge',
  rebase: 'Rebase and merge',
};

/** What each method does, for the method menu. */
export const MERGE_METHOD_HINT: Record<PullRequestMergeMethod, string> = {
  merge: 'Create a merge commit',
  squash: 'Combine every commit into one',
  rebase: 'Replay the commits onto the base',
};

type MergeFacts = Pick<PullRequestDetail, 'state' | 'draft' | 'mergeable' | 'mergeableState'>;

/** Why the PR cannot be merged from here, or null when the Merge control is live. */
export function mergeBlockReason(pr: MergeFacts): string | null {
  if (pr.state === 'merged') return 'This pull request is already merged.';
  if (pr.state === 'closed') return 'This pull request is closed. Reopen it on GitHub to merge it.';
  if (pr.draft) return 'Draft pull requests can’t be merged. Mark it ready for review on GitHub first.';
  if (pr.mergeable === null) return 'GitHub is still checking whether this can be merged…';
  if (pr.mergeable === false) {
    return pr.mergeableState === 'dirty'
      ? 'This branch has conflicts with the base branch. Resolve them before merging.'
      : 'GitHub reports that this pull request can’t be merged.';
  }
  return null;
}

/** A warning for a mergeable PR the host may still refuse (branch protection, failing checks). */
export function mergeCaution(pr: MergeFacts): string | null {
  if (mergeBlockReason(pr)) return null;
  switch (pr.mergeableState) {
    case 'blocked':
      return 'Branch protection may block this merge (required reviews or checks).';
    case 'unstable':
      return 'Some checks are failing or pending.';
    case 'behind':
      return 'The head branch is behind the base branch.';
    default:
      return null;
  }
}

/** The header's word for an open, mergeable PR that GitHub still holds back (U-74); null when it is plainly mergeable. */
export function mergeHoldLabel(pr: MergeFacts): string | null {
  if (mergeBlockReason(pr)) return null;
  switch (pr.mergeableState) {
    case 'blocked':
      return 'Branch protection may block the merge';
    case 'unstable':
      return 'Mergeable · checks failing or pending';
    case 'behind':
      return 'Behind the base branch';
    default:
      return null;
  }
}

/** The New chat draft's first message for "Fix in chat". */
export function issueFixPrompt(issue: Pick<IssueSummary, 'number' | 'title' | 'body'>): string {
  const body = issue.body.trim();
  return [`Fix #${issue.number}: ${issue.title}`, ...(body ? [body] : []), `Open a PR that closes #${issue.number}.`].join('\n\n');
}

/** `bug, ui ,, p1` → `['bug', 'ui', 'p1']` (unique, order kept). */
export function parseLabels(raw: string): string[] {
  return [...new Set(raw.split(',').map((l) => l.trim()).filter(Boolean))];
}
