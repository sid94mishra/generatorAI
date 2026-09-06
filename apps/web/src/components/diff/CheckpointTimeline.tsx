// ────────────────────────────────────────────────────────────────
// CheckpointTimeline — browse workspace snapshots and rewind to one
// ────────────────────────────────────────────────────────────────
//
// Every checkpoint is a git tree reachable only from a private
// `refs/generatorai/checkpoints/…` ref, so listing and restoring never touch
// the user's index, HEAD, branches or remotes.
//
// Restoring is deliberately presented as a normal, recoverable action rather
// than a destructive one: the server writes a `pre_restore` checkpoint before
// touching the working tree, so the immediate follow-up question ("how do I
// get back?") is answered by the timeline itself.

import { useMemo, useState } from 'react';
import { History, Layers, RotateCcw, X, AlertTriangle, Check } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { Button, Spinner } from '@/components/ui/index.js';
import {
  useWorkspaceCheckpoints,
  useRestoreWorkspaceCheckpoint,
} from '@/hooks/queries.js';
import type { RestoreCheckpointResult } from '@/types/changes.js';
import {
  checkpointLabel,
  formatAliasList,
  groupCheckpoints,
  type CheckpointGroup,
} from './checkpointGroups.js';

/** One rewind's outcome, per mount. */
interface RewindReport {
  group: CheckpointGroup;
  perMount: Array<{ alias: string; result?: RestoreCheckpointResult; error?: string }>;
}

/**
 * Human-readable one-liner for the prompt that produced a checkpoint.
 *
 * Review submissions are machine-formatted XML, so showing the excerpt raw
 * fills the timeline with `<review_feedback …>` noise. Surface the reviewer's
 * actual comments instead — that is what identifies the checkpoint.
 *
 * The excerpt is truncated server-side (200 chars), so the markup is usually
 * cut mid-tag: the closing `</comment>` is treated as optional and the file
 * path is used as a fallback when the excerpt ends before any comment body.
 */
function describePrompt(excerpt: string): string {
  if (!excerpt.includes('<review_feedback')) return excerpt;

  const comments = [...excerpt.matchAll(/<comment\b[^>]*>([\s\S]*?)(?:<\/comment>|$)/g)]
    .map((m) => (m[1] ?? '').trim())
    .filter(Boolean);
  if (comments.length > 0) return `Review: ${comments.join(' · ')}`;

  const path = /<file\b[^>]*\bpath="([^"]+)"/.exec(excerpt)?.[1];
  return path ? `Review on ${path}` : 'Review feedback';
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export interface CheckpointTimelineProps {
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

export function CheckpointTimeline({
  workspaceId,
  onClose,
  onCompare,
}: CheckpointTimelineProps) {
  const { data, isLoading } = useWorkspaceCheckpoints(workspaceId);
  const restore = useRestoreWorkspaceCheckpoint(workspaceId);

  const [confirming, setConfirming] = useState<string | null>(null);
  const [report, setReport] = useState<RewindReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(() => groupCheckpoints(data?.checkpoints ?? []), [data]);

  /**
   * Rewind every mount the turn touched.
   *
   * One request per mount, because a checkpoint IS one mount's tree — there
   * is no workspace-wide restore to call. They run in sequence rather than in
   * parallel so a failure halfway through leaves a comprehensible state, and
   * every outcome is reported per mount: a rewind that restored two of three
   * repositories must not look like a clean success.
   */
  const doRestore = async (group: CheckpointGroup) => {
    setError(null);
    const perMount: RewindReport['perMount'] = [];
    for (const target of group.restoreTargets) {
      try {
        const res = await restore.mutateAsync({ checkpointId: target.id });
        perMount.push({ alias: target.repoAlias, result: res });
      } catch (err) {
        perMount.push({
          alias: target.repoAlias,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    setReport({ group, perMount });
    setConfirming(null);
    if (perMount.length > 0 && perMount.every((m) => m.error)) {
      setError(perMount[0]?.error ?? 'The rewind failed.');
    }
  };

  return (
    <div className="flex h-full flex-col border-l border-border bg-card text-xs">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <History className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-medium text-foreground">Checkpoints</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          className="ml-auto h-5 w-5"
          title="Close checkpoints"
          aria-label="Close checkpoints"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {error && (
        <div className="m-2 flex items-start gap-1.5 rounded bg-danger-muted p-2 text-danger">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {report && <RewindResult report={report} onDismiss={() => setReport(null)} />}

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {isLoading ? (
          <div className="flex justify-center p-4">
            <Spinner />
          </div>
        ) : groups.length === 0 ? (
          <p className="p-3 text-center text-muted-foreground">No checkpoints yet.</p>
        ) : (
          <ol className="space-y-1">
            {groups.map((group) => (
              <li
                key={group.key}
                className="rounded border border-border p-2 hover:bg-accent/40"
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-foreground">{checkpointLabel(group)}</span>
                  {group.phase && (
                    <span className="rounded bg-muted px-1 text-[9px] text-muted-foreground">
                      {group.phase}
                    </span>
                  )}
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                    {formatTime(group.createdAt)}
                  </span>
                </div>

                {group.promptExcerpt && (
                  <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                    {describePrompt(group.promptExcerpt)}
                  </p>
                )}

                {/* Which mounts this turn touched. Without it a rewind in a
                    multi-source chat is a blind action. */}
                {group.aliases.length > 1 && (
                  <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                    <Layers className="h-2.5 w-2.5" />
                    {group.aliases.map((alias) => (
                      <span key={alias} className="rounded bg-muted px-1 font-mono">
                        {alias === '.' ? 'workspace' : alias}
                      </span>
                    ))}
                  </p>
                )}

                <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span>{group.fileCount} file(s)</span>
                  {group.additions > 0 && (
                    <span className="text-success">+{group.additions}</span>
                  )}
                  {group.deletions > 0 && (
                    <span className="text-danger">−{group.deletions}</span>
                  )}

                  <div className="ml-auto flex items-center gap-1">
                    {onCompare && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onCompare(group.compareValue)}
                        className="h-5 px-1.5 text-[10px]"
                        title="Use as the diff base"
                      >
                        Compare
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirming(group.key)}
                      disabled={restore.isPending || group.restoreTargets.length === 0}
                      className="h-5 gap-1 px-1.5 text-[10px]"
                      title="Rewind the workspace to this point"
                      leftIcon={<RotateCcw className="h-3 w-3" />}
                    >
                      Rewind
                    </Button>
                  </div>
                </div>

                {confirming === group.key && (
                  <div className="mt-1.5 rounded bg-warning-muted p-2">
                    <p className="text-[11px] text-warning">
                      Rewind {formatAliasList(group.aliases)}{' '}
                      {group.undoesTurn ? 'to before this turn' : 'to this checkpoint'}? Current
                      work is saved to a &ldquo;Redo point&rdquo; first, so you can undo it.
                    </p>
                    <div className="mt-1.5 flex gap-1.5">
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={() => void doRestore(group)}
                        disabled={restore.isPending}
                        className="h-auto rounded bg-warning px-2 py-0.5 text-[11px] font-medium text-background"
                      >
                        {restore.isPending
                          ? 'Rewinding…'
                          : group.restoreTargets.length > 1
                            ? `Rewind ${String(group.restoreTargets.length)} sources`
                            : 'Confirm rewind'}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirming(null)}
                        className="h-auto rounded px-2 py-0.5 text-[11px] font-normal text-foreground hover:bg-accent hover:text-foreground"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className={cn('border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground')}>
        Checkpoints are private snapshots. They never change your branches or commits.
      </div>
    </div>
  );
}


// ── Sub-components ─────────────────────────────────────────────

/**
 * What the rewind actually did, mount by mount.
 *
 * Per-mount rather than one total because a multi-source rewind can partly
 * fail — a repository that went dirty in the meantime, a path the server
 * refused to write through — and a single "restored 12 files" line would
 * hide exactly the half the user needs to act on.
 */
function RewindResult({ report, onDismiss }: { report: RewindReport; onDismiss: () => void }) {
  const failures = report.perMount.filter((m) => m.error);
  const successes = report.perMount.filter((m) => m.result);
  const undoable = successes.some((m) => m.result?.preRestoreCheckpointId);

  return (
    <div
      className={cn(
        'm-2 rounded p-2',
        failures.length === 0 ? 'bg-success-muted text-success' : 'bg-warning-muted text-warning',
      )}
      role="status"
    >
      <div className="flex items-center gap-1.5 font-medium">
        {failures.length === 0 ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
        {failures.length === 0
          ? `Rewound ${formatAliasList(successes.map((m) => m.alias))}`
          : `Rewound ${String(successes.length)} of ${String(report.perMount.length)} sources`}
      </div>

      <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
        {report.perMount.map((entry) => (
          <li key={entry.alias}>
            <span className="font-mono">{entry.alias === '.' ? 'workspace' : entry.alias}</span>
            {entry.result ? (
              <>
                {' '}— {entry.result.restoredPaths.length} restored,{' '}
                {entry.result.deletedPaths.length} removed
                {entry.result.skipped.length > 0 && (
                  <>
                    ,{' '}
                    <span className="text-warning">
                      {entry.result.skipped.length} skipped for safety
                    </span>
                  </>
                )}
              </>
            ) : (
              <span className="text-danger"> — {entry.error}</span>
            )}
          </li>
        ))}
      </ul>

      {/* Symlinks and hard links can resolve outside the workspace, so the
          server refuses to write through them. Naming the paths is the only
          way the user can tell what was left behind. */}
      {successes.some((m) => (m.result?.skipped.length ?? 0) > 0) && (
        <ul className="mt-1.5 space-y-px rounded bg-warning-muted p-1.5 text-[11px] text-warning">
          {successes.flatMap((m) =>
            (m.result?.skipped ?? []).slice(0, 6).map((sk) => (
              <li key={`${m.alias}:${sk.path}`} className="font-mono">
                {m.alias === '.' ? '' : `${m.alias}/`}
                {sk.path} — {sk.reason}
              </li>
            )),
          )}
        </ul>
      )}

      {undoable && (
        <div className="mt-1 text-[11px] text-muted-foreground">
          A &ldquo;Redo point&rdquo; was saved first, so this is undoable.
        </div>
      )}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onDismiss}
        className="mt-1.5 h-auto rounded-none p-0 text-[11px] font-normal normal-case text-current underline hover:bg-transparent hover:text-current"
      >
        Dismiss
      </Button>
    </div>
  );
}
