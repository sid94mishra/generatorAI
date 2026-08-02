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

import { useState } from 'react';
import { History, RotateCcw, X, AlertTriangle, Check } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { Spinner } from '@/components/ui/index.js';
import {
  useWorkspaceCheckpoints,
  useRestoreWorkspaceCheckpoint,
} from '@/hooks/queries.js';
import type { CheckpointRecord, RestoreCheckpointResult } from '@/types/changes.js';

const KIND_LABEL: Record<string, string> = {
  baseline: 'Session start',
  turn: 'Chat turn',
  stage: 'Stage',
  autorun: 'Automation',
  live: 'Auto-save',
  manual: 'Manual snapshot',
  pre_restore: 'Before rewind',
};

/** Snapshots that exist for bookkeeping rather than as rewind targets. */
const NOISE_KINDS = new Set(['live']);

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
  /** Preview a checkpoint as the diff base instead of rewinding to it. */
  onCompare?: (checkpointId: string) => void;
}

export function CheckpointTimeline({
  workspaceId,
  onClose,
  onCompare,
}: CheckpointTimelineProps) {
  const { data, isLoading } = useWorkspaceCheckpoints(workspaceId);
  const restore = useRestoreWorkspaceCheckpoint(workspaceId);

  const [confirming, setConfirming] = useState<CheckpointRecord | null>(null);
  const [result, setResult] = useState<RestoreCheckpointResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkpoints = (data?.checkpoints ?? []).filter(
    (c) => !NOISE_KINDS.has(c.kind),
  );

  const doRestore = async (checkpoint: CheckpointRecord) => {
    setError(null);
    try {
      const res = await restore.mutateAsync({ checkpointId: checkpoint.id });
      setResult(res);
      setConfirming(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setConfirming(null);
    }
  };

  return (
    <div className="flex h-full flex-col border-l border-border bg-card text-xs">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <History className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-medium text-foreground">Checkpoints</span>
        <button
          onClick={onClose}
          className="ml-auto rounded p-0.5 text-muted-foreground hover:bg-accent"
          title="Close checkpoints"
          aria-label="Close checkpoints"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {error && (
        <div className="m-2 flex items-start gap-1.5 rounded bg-danger-muted p-2 text-danger">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {result && (
        <div className="m-2 rounded bg-emerald-500/10 p-2 text-emerald-600">
          <div className="flex items-center gap-1.5 font-medium">
            <Check className="h-3 w-3" />
            Rewound the workspace
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {result.restoredPaths.length} file(s) restored, {result.deletedPaths.length}{' '}
            removed.
            {result.preRestoreCheckpointId && (
              <> A &ldquo;Before rewind&rdquo; checkpoint was saved so this is undoable.</>
            )}
          </div>
          {result.skipped.length > 0 && (
            // Symlinks and hard links can resolve outside the workspace, so the
            // server refuses to write through them. Silently dropping them
            // would leave the user believing the rewind was complete.
            <div className="mt-1.5 rounded bg-amber-500/10 p-1.5 text-[11px] text-amber-600">
              <div className="font-medium">
                {result.skipped.length} path(s) skipped for safety:
              </div>
              <ul className="mt-0.5 space-y-px">
                {result.skipped.slice(0, 8).map((s) => (
                  <li key={s.path} className="font-mono">
                    {s.path} — {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button
            onClick={() => setResult(null)}
            className="mt-1.5 text-[11px] underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {isLoading ? (
          <div className="flex justify-center p-4">
            <Spinner />
          </div>
        ) : checkpoints.length === 0 ? (
          <p className="p-3 text-center text-muted-foreground">No checkpoints yet.</p>
        ) : (
          <ol className="space-y-1">
            {checkpoints.map((c) => (
              <li
                key={c.id}
                className="rounded border border-border p-2 hover:bg-accent/40"
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-foreground">
                    {c.label ?? KIND_LABEL[c.kind] ?? c.kind}
                  </span>
                  {c.phase && (
                    <span className="rounded bg-muted px-1 text-[9px] text-muted-foreground">
                      {c.phase}
                    </span>
                  )}
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                    {formatTime(c.createdAt)}
                  </span>
                </div>

                {c.promptExcerpt && (
                  <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                    {describePrompt(c.promptExcerpt)}
                  </p>
                )}

                <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span>{c.fileCount} file(s)</span>
                  {c.additions > 0 && (
                    <span className="text-emerald-500">+{c.additions}</span>
                  )}
                  {c.deletions > 0 && <span className="text-rose-500">−{c.deletions}</span>}

                  <div className="ml-auto flex items-center gap-1">
                    {onCompare && (
                      <button
                        onClick={() => onCompare(c.id)}
                        className="rounded px-1.5 py-0.5 hover:bg-accent"
                        title="Use as the diff base"
                      >
                        Compare
                      </button>
                    )}
                    <button
                      onClick={() => setConfirming(c)}
                      disabled={restore.isPending}
                      className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent disabled:opacity-50"
                      title="Rewind the workspace to this checkpoint"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Rewind
                    </button>
                  </div>
                </div>

                {confirming?.id === c.id && (
                  <div className="mt-1.5 rounded bg-amber-500/10 p-2">
                    <p className="text-[11px] text-amber-700 dark:text-amber-400">
                      Rewind every file to this point? Current work is saved to a
                      &ldquo;Before rewind&rdquo; checkpoint first, so you can undo it.
                    </p>
                    <div className="mt-1.5 flex gap-1.5">
                      <button
                        onClick={() => void doRestore(c)}
                        disabled={restore.isPending}
                        className="rounded bg-amber-500 px-2 py-0.5 text-[11px] font-medium text-white disabled:opacity-50"
                      >
                        {restore.isPending ? 'Rewinding…' : 'Confirm rewind'}
                      </button>
                      <button
                        onClick={() => setConfirming(null)}
                        className="rounded px-2 py-0.5 text-[11px] hover:bg-accent"
                      >
                        Cancel
                      </button>
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
