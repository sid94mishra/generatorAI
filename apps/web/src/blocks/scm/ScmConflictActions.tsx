// ────────────────────────────────────────────────────────────────
// ScmConflictActions — the conflict card, shared by the Changes panel's
// CommitBar and the transcript's `scm_result` block (ScmResultCard).
//
// Wires ScmConflictCard to the four conflict verbs (`useScmConflictAction`).
// Nothing is pushed until Continue succeeds and the host re-runs the flow
// (`onContinued`), which is the guardrail the design calls for.
// ────────────────────────────────────────────────────────────────

import { useCallback, useState } from 'react';
import type { ScmConflictReport } from '@generatorai/shared';
import { useScmConflictAction } from '@/hooks/queries.js';
import { ScmConflictCard, type ScmConflictMode } from './ScmConflictCard.js';

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

type ConflictVerb = 'start' | 'continue' | 'abort' | 'resolve-with-agent';

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
  // `mergeStarted`: a previous attempt already applied the merge, so the card
  // opens straight into "edit, then Continue".
  const [mode, setMode] = useState<ScmConflictMode>(conflicts.mergeStarted ? 'manual' : 'idle');
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (verb: ConflictVerb, next: ScmConflictMode, after?: () => void) => {
      setError(null);
      try {
        const result = await action.mutateAsync({
          action: verb,
          alias,
          ...(verb === 'resolve-with-agent' && chatId ? { chatId } : {}),
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

  return (
    <ScmConflictCard
      className={className}
      conflicts={conflicts}
      mode={mode}
      busy={action.isPending}
      error={error}
      canAskAgent={!!chatId}
      onResolveManually={() => void run('start', 'manual')}
      onAskAgent={() => void run('resolve-with-agent', 'agent')}
      onContinue={() => void run('continue', 'resolved', onContinued)}
      onAbort={() => void run('abort', 'idle', onAborted)}
      {...(onOpenFile ? { onOpenFile } : {})}
    />
  );
}
