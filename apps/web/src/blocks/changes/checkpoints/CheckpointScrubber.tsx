// ────────────────────────────────────────────────────────────────
// CheckpointScrubber — browse workspace snapshots and rewind to one
// ────────────────────────────────────────────────────────────────
//
// Every checkpoint is a git tree reachable only from a private
// `refs/generatorai/checkpoints/…` ref, so listing and restoring never touch
// the user's index, HEAD, branches or remotes.
//
// Data half of the scrubber: lists the workspace's checkpoints, groups them
// by turn and runs the rewind. CheckpointScrubberView draws it.
// ────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import { useRestoreWorkspaceCheckpoint, useWorkspaceCheckpoints } from '@/hooks/queries.js';
import { groupCheckpoints, type CheckpointGroup } from './checkpointGroups.js';
import { CheckpointScrubberView, type RewindReport } from './CheckpointScrubberView.js';

export interface CheckpointScrubberProps {
  workspaceId: string;
  onClose: () => void;
  /**
   * Preview this point as the diff base instead of rewinding to it. Receives
   * a revision SELECTOR (`turn:<turnId>` for a grouped turn, otherwise
   * `checkpoint:<id>`) — a turn spans several mounts, so a bare checkpoint id
   * could only ever name one of them.
   */
  onCompare?: (revisionSelector: string) => void;
}

/** The Changes dock's checkpoint strip for one workspace. */
export function CheckpointScrubber({ workspaceId, onClose, onCompare }: CheckpointScrubberProps) {
  const { data, isLoading } = useWorkspaceCheckpoints(workspaceId);
  const restore = useRestoreWorkspaceCheckpoint(workspaceId);

  const [rewinding, setRewinding] = useState(false);
  const [report, setReport] = useState<RewindReport | null>(null);

  const groups = useMemo(() => groupCheckpoints(data?.checkpoints ?? []), [data]);

  /**
   * Rewind every mount the group touched.
   *
   * One request per mount, because a checkpoint IS one mount's tree — there
   * is no workspace-wide restore to call. They run in sequence rather than in
   * parallel so a failure halfway through leaves a comprehensible state, and
   * every outcome is reported per mount: a rewind that restored two of three
   * repositories must not look like a clean success.
   */
  const rewind = async (group: CheckpointGroup) => {
    setRewinding(true);
    setReport(null);
    const perMount: RewindReport['perMount'] = [];
    for (const target of group.restoreTargets) {
      try {
        const result = await restore.mutateAsync({ checkpointId: target.id });
        perMount.push({ alias: target.repoAlias, result });
      } catch (err) {
        perMount.push({ alias: target.repoAlias, error: err instanceof Error ? err.message : String(err) });
      }
    }
    setReport({ group, perMount });
    setRewinding(false);
  };

  return (
    <CheckpointScrubberView
      groups={groups}
      loading={isLoading}
      rewinding={rewinding}
      report={report}
      onClose={onClose}
      {...(onCompare ? { onCompare } : {})}
      onRewind={rewind}
      onDismissReport={() => setReport(null)}
    />
  );
}
