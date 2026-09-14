// ────────────────────────────────────────────────────────────────
// ScmResultCard — the transcript's `scm_result` block.
//
// Agent-native mode means the PLATFORM commits, not the agent, so the
// transcript has to account for it where it happened: one compact line
// ("Committed abc1234 · pushed · PR #12 ↗") when everything worked, the
// blocking reason when it did not, and the full conflict card — the same
// three actions the Changes tab offers — when the base branch collided.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { AlertTriangle, ExternalLink, GitCommit, GitPullRequest } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { ScmConflictActions } from './ScmConflictActions.js';
import type { ScmFlowResult } from '@generatorai/shared';

export interface ScmResultCardProps {
  result: ScmFlowResult;
  /** Needed for the conflict actions; without it the card is read-only. */
  workspaceId?: string;
  /** Gates "Ask the agent" — it is a turn in THIS chat. */
  chatId?: string;
  className?: string;
}

export function ScmResultCard({ result, workspaceId, chatId, className }: ScmResultCardProps) {
  if (result.status === 'conflicts' && result.conflicts) {
    return (
      <ScmConflictActions
        className={className}
        workspaceId={workspaceId}
        conflicts={result.conflicts}
        alias={result.alias}
        {...(chatId ? { chatId } : {})}
      />
    );
  }

  if (result.status === 'ok') {
    return (
      <div
        className={cn(
          'flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-[11px]',
          className,
        )}
        data-testid="scm-result-card"
      >
        <GitCommit className="h-3.5 w-3.5 shrink-0 text-success" />
        {result.commit ? (
          <span>
            Committed <span className="font-mono text-foreground">{result.commit.sha.slice(0, 7)}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">Nothing to commit</span>
        )}
        {result.branch && (
          <span className="font-mono text-muted-foreground">on {result.branch}</span>
        )}
        {result.pushed && <span className="text-success">· pushed</span>}
        {result.pullRequest && (
          <a
            href={result.pullRequest.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
            data-testid="scm-result-pr-link"
          >
            <GitPullRequest className="h-3 w-3" />
            PR #{result.pullRequest.number}
            <ExternalLink className="h-2.5 w-2.5 opacity-70" />
          </a>
        )}
      </div>
    );
  }

  const failing = result.steps.find((s) => s.status === 'failed' || s.status === 'blocked');
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-md border border-warning/40 bg-warning-muted/40 px-2.5 py-1.5 text-[11px]',
        className,
      )}
      data-testid="scm-result-card"
    >
      <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-warning" />
      <span className="min-w-0">
        Source control {result.status === 'blocked' ? 'was blocked' : 'failed'}
        {failing?.detail ? ` — ${failing.detail}` : result.error ? ` — ${result.error}` : '.'}
      </span>
    </div>
  );
}
