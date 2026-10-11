// ────────────────────────────────────────────────────────────────
// mergePullRequest — merge a PR and (optionally) delete its head branch.
//
// One sequence for the project route and the agent's merge tool (D-146):
// read the PR (a merged or closed PR is refused with a plain reason before
// the host is asked), merge with the chosen method, then delete the head
// branch when asked. A branch that cannot be deleted never turns a merge
// that happened into a failure: the result says so instead.
// ────────────────────────────────────────────────────────────────

import type { MergePullRequestResult, PullRequestMergeMethod } from '@generatorai/shared';
import {
  PullRequestNotMergeableError,
  type ISourceControlProvider,
  type PullRequestRef,
} from '@generatorai/source-control';
import { redactTokens } from './redact.js';

export interface MergePullRequestOptions {
  method: PullRequestMergeMethod;
  deleteBranch?: boolean;
  commitTitle?: string;
  commitMessage?: string;
}

export async function mergePullRequest(
  provider: ISourceControlProvider,
  ref: PullRequestRef,
  opts: MergePullRequestOptions,
): Promise<MergePullRequestResult> {
  const detail = await provider.getPullRequestDetail(ref);
  if (detail.state === 'merged') throw new PullRequestNotMergeableError(`Pull request #${ref.number} is already merged`);
  if (detail.state === 'closed') throw new PullRequestNotMergeableError(`Pull request #${ref.number} is closed`);
  if (detail.draft) {
    throw new PullRequestNotMergeableError(`Pull request #${ref.number} is a draft — mark it ready for review first`);
  }

  const result = await provider.mergePullRequest(ref, {
    method: opts.method,
    ...(opts.commitTitle ? { commitTitle: opts.commitTitle } : {}),
    ...(opts.commitMessage ? { commitMessage: opts.commitMessage } : {}),
  });

  if (opts.deleteBranch && result.merged && detail.head) {
    try {
      result.branchDeleted = await provider.deleteBranch(ref.owner, ref.repo, detail.head, ref.host);
    } catch (err) {
      result.branchDeleted = false;
      result.branchDeleteError = redactTokens(err instanceof Error ? err.message : String(err));
    }
  }
  return result;
}
