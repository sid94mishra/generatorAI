// ────────────────────────────────────────────────────────────────
// ScmConflictActions — the conflict card, shared by the Changes tab and
// the transcript's `scm_result` block.
//
// A conflict is reported with the working tree UNTOUCHED (the flow
// dry-runs the merge), so the three options here are genuinely different
// decisions rather than three ways out of a half-applied merge:
//
//   Resolve manually  → apply the merge, edit the files, Continue
//   Ask the agent     → apply the merge and hand the files to this chat's
//                       agent as a normal, watchable turn; the user still
//                       clicks Continue afterwards
//   Abort             → `git merge --abort`, nothing changed
//
// Nothing is pushed until Continue succeeds and the caller re-runs the
// flow, which is the guardrail the design calls for.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useState } from 'react';
import { AlertTriangle, Bot, FilePen, Play, X } from 'lucide-react';
import { Button, Spinner } from '@/components/ui/index.js';
import { toast } from '@/components/Toast.js';
import { cn } from '@/lib/utils.js';
import { useScmConflictAction } from '@/hooks/queries.js';
import type { ScmConflictReport } from '@generatorai/shared';

export interface ScmConflictActionsProps {
  workspaceId: string | undefined;
  conflicts: ScmConflictReport;
  alias: string;
  /** Present only where a chat is in scope — gates "Ask the agent". */
  chatId?: string;
  /** Re-run the flow for the remaining steps after a successful Continue. */
  onContinued?: () => void;
  /** Called after a successful abort so the host can drop its stale result. */
  onAborted?: () => void;
  /** Opens one conflicted file in the user's editor, when that is possible. */
  onOpenFile?: (path: string) => void;
  className?: string;
}

type Mode = 'idle' | 'manual' | 'agent';

export function ScmConflictActions({
  workspaceId,
  conflicts,
  alias,
  chatId,
  onContinued,
  onAborted,
  onOpenFile,
  className,
}: ScmConflictActionsProps) {
  const action = useScmConflictAction(workspaceId);
  // `mergeStarted` means a previous attempt already applied the merge — the
  // card then opens straight into the "edit, then Continue" state instead of
  // offering to start something that is already started.
  const [mode, setMode] = useState<Mode>(conflicts.mergeStarted ? 'manual' : 'idle');
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (
      kind: 'start' | 'continue' | 'abort' | 'resolve-with-agent',
      next: Mode,
      after?: () => void,
    ) => {
      setError(null);
      try {
        const result = await action.mutateAsync({
          action: kind,
          alias,
          ...(kind === 'resolve-with-agent' ? { chatId: chatId! } : {}),
        });
        if (!result.ok) {
          setError(
            result.unmerged?.length
              ? `Still unresolved: ${result.unmerged.join(', ')}`
              : (result.error ?? 'That did not work.'),
          );
          return;
        }
        setMode(next);
        after?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [action, alias, chatId],
  );

  const busy = action.isPending;

  return (
    <div
      className={cn('rounded-md border border-warning/40 bg-warning-muted/40 p-3', className)}
      data-testid="scm-conflict-card"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">
            Merging <span className="font-mono">{conflicts.base}</span> into{' '}
            <span className="font-mono">{conflicts.head}</span> conflicts
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {conflicts.files.length} {conflicts.files.length === 1 ? 'file' : 'files'} need a
            decision before this branch can be pushed.
          </p>
        </div>
      </div>

      <ul className="mt-2 space-y-0.5" data-testid="scm-conflict-files">
        {conflicts.files.map((file) => (
          <li key={file} className="flex items-center gap-1.5 text-[11px]">
            <span className="truncate font-mono text-foreground">{file}</span>
            {onOpenFile && mode !== 'idle' && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onOpenFile(file)}
                className="h-auto rounded px-1 py-0 text-[10px] font-normal"
              >
                Open in editor
              </Button>
            )}
          </li>
        ))}
      </ul>

      {mode === 'idle' ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            leftIcon={<FilePen className="h-3 w-3" />}
            data-testid="scm-conflict-manual"
            onClick={() => void run('start', 'manual')}
          >
            Resolve manually
          </Button>
          {chatId && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy}
              leftIcon={<Bot className="h-3 w-3" />}
              data-testid="scm-conflict-agent"
              onClick={() => void run('resolve-with-agent', 'agent')}
            >
              Ask the agent
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            leftIcon={<X className="h-3 w-3" />}
            data-testid="scm-conflict-abort"
            className="text-danger hover:bg-danger-muted"
            onClick={() => void run('abort', 'idle', onAborted)}
          >
            Abort
          </Button>
          {busy && <Spinner size="xs" />}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted-foreground" data-testid="scm-conflict-instructions">
            {mode === 'agent'
              ? 'The agent is resolving the conflicts in this chat. Review the files, then Continue.'
              : 'The merge is applied to the working tree with conflict markers. Edit the files above, then Continue.'}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              variant="primary"
              size="sm"
              loading={busy}
              leftIcon={<Play className="h-3 w-3" />}
              data-testid="scm-conflict-continue"
              onClick={() =>
                void run('continue', 'idle', () => {
                  toast({ variant: 'success', title: 'Merge resolved', description: alias });
                  onContinued?.();
                })
              }
            >
              Continue
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              leftIcon={<X className="h-3 w-3" />}
              className="text-danger hover:bg-danger-muted"
              data-testid="scm-conflict-abort"
              onClick={() => void run('abort', 'idle', onAborted)}
            >
              Abort
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-2 text-[11px] text-danger" role="alert" data-testid="scm-conflict-error">
          {error}
        </p>
      )}
    </div>
  );
}
