// ────────────────────────────────────────────────────────────────
// MergePullRequestCard — the PR page's Merge control (D-146).
//
// A split button (the primary part merges with the chosen method, the
// chevron picks Merge commit / Squash / Rebase), an optional "Delete the
// head branch" checkbox, and a confirmation AlertDialog before anything
// reaches GitHub. When the PR cannot be merged from here (merged, closed,
// draft, conflicts, mergeability still computing) the controls are disabled
// and the reason is said in the card; a merged or closed PR shows only that outcome
// (no dead checkbox and button, U-59). A merge is a background job on the
// host, so its completion is a toast; the PR refetches to "merged".
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import type { PullRequestDetail, PullRequestMergeMethod } from '@generatorai/shared';
import { useMergePullRequest } from '@/hooks/queries.js';
import { MenuButton } from '@/ui/patterns/MenuButton/MenuButton.js';
import { AlertDialog } from '@/ui/primitives/AlertDialog/AlertDialog.js';
import { Card } from '@/ui/primitives/Card/Card.js';
import { Checkbox } from '@/ui/primitives/Checkbox/Checkbox.js';
import { toast } from '@/ui/primitives/Toast/Toast.js';
import {
  MERGE_METHOD_HINT,
  MERGE_METHOD_LABEL,
  MERGE_METHODS,
  mergeBlockReason,
  mergeCaution,
} from './githubActions.js';

export function MergePullRequestCard({
  projectId,
  codebaseId,
  pr,
}: {
  projectId: string | undefined;
  codebaseId: string | undefined;
  pr: PullRequestDetail;
}) {
  const merge = useMergePullRequest(projectId, codebaseId, pr.number);
  const [method, setMethod] = useState<PullRequestMergeMethod>('merge');
  const [deleteBranch, setDeleteBranch] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const blocked = mergeBlockReason(pr);
  const caution = mergeCaution(pr);
  const disabled = blocked !== null || merge.isPending;
  const settled = pr.state === 'merged' || pr.state === 'closed';

  const run = async () => {
    try {
      const result = await merge.mutateAsync({ method, ...(deleteBranch ? { deleteBranch: true } : {}) });
      if (result.branchDeleteError) {
        toast.error(`Merged #${pr.number}, but ${pr.head} wasn't deleted`, { description: result.branchDeleteError });
      } else {
        toast.done(`Merged #${pr.number} into ${pr.base}`, {
          description: [result.message, result.branchDeleted ? `${pr.head} deleted` : null].filter(Boolean).join(' · '),
        });
      }
    } catch (err) {
      toast.error("Couldn't merge the pull request", { description: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <Card data-testid="pr-merge-panel">
      <Card.Header title="Merge" />
      <Card.Body>
        {blocked ? (
          <p className="text-small text-fg-3" data-testid="pr-merge-blocked">
            {blocked}
          </p>
        ) : caution ? (
          <p className="text-small text-warn" data-testid="pr-merge-caution">
            {caution}
          </p>
        ) : (
          <p className="text-small text-fg-3">
            Merges <span className="font-mono">{pr.head}</span> into <span className="font-mono">{pr.base}</span> on
            GitHub.
          </p>
        )}
        {settled ? null : (
          <>
            <Checkbox
              label={
                <span className="min-w-0 break-all">
                  Delete <span className="font-mono">{pr.head}</span> after merging
                </span>
              }
              checked={deleteBranch}
              onCheckedChange={setDeleteBranch}
              disabled={disabled}
              data-testid="pr-merge-delete-branch"
            />
            <MenuButton
              split
              variant="primary"
              icon="merge"
              label={MERGE_METHOD_LABEL[method]}
              menuLabel="Merge method"
              onPrimary={() => setConfirming(true)}
              disabled={disabled}
              align="start"
              className="self-start"
              data-testid="pr-merge"
              items={MERGE_METHODS.map((m) => ({
                id: m,
                label: (
                  <span className="flex flex-col">
                    <span className={m === method ? 'font-medium text-fg' : undefined}>{MERGE_METHOD_LABEL[m]}</span>
                    <span className="text-micro text-fg-3">{MERGE_METHOD_HINT[m]}</span>
                  </span>
                ),
                onSelect: () => setMethod(m),
              }))}
            />
          </>
        )}
      </Card.Body>
      <AlertDialog
        open={confirming}
        onOpenChange={setConfirming}
        tone="primary"
        title={`${MERGE_METHOD_LABEL[method]} #${pr.number}?`}
        description={
          <>
            {MERGE_METHOD_HINT[method]} on <span className="font-mono">{pr.base}</span> from{' '}
            <span className="font-mono">{pr.head}</span>
            {deleteBranch ? ', then delete the head branch' : ''}. This can’t be undone from GeneratorAI.
          </>
        }
        confirmLabel={MERGE_METHOD_LABEL[method]}
        onConfirm={run}
        data-testid="pr-merge-confirm"
      />
    </Card>
  );
}
