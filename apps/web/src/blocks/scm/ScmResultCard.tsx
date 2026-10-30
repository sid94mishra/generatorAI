// ────────────────────────────────────────────────────────────────
// ScmResultCard — the transcript's `scm_result` block.
//
// Agent-native mode means the PLATFORM commits, not the agent, so the
// transcript has to account for it where it happened: one compact line
// ("Committed abc1234 · pushed · PR #12 ↗") when everything worked, the
// blocking reason when it did not, and the full conflict card — the same
// three actions the Changes tab offers — when the base branch collided.
// ────────────────────────────────────────────────────────────────

import type { ScmFlowResult } from '@generatorai/shared';
import { Icon } from '@/ui/icons/Icon.js';
import { Link } from '@/ui/primitives/Link/Link.js';
import { cn } from '@/ui/lib/cn.js';
import { ScmConflictActions } from '@/blocks/scm/ScmConflictActions.js';

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
          'flex flex-wrap items-center gap-2 rounded-card border border-line-soft bg-raised px-2.5 py-1.5 text-small',
          className,
        )}
        data-testid="scm-result-card"
      >
        <Icon concept="commit" size={14} className="shrink-0 text-ok" />
        {result.commit ? (
          <span>
            Committed <span className="font-mono text-fg">{result.commit.sha.slice(0, 7)}</span>
          </span>
        ) : (
          <span className="text-fg-3">Nothing to commit</span>
        )}
        {result.branch && <span className="font-mono text-fg-3">on {result.branch}</span>}
        {result.pushed && <span className="text-ok">· pushed</span>}
        {result.pullRequest && (
          <Link
            variant="external"
            href={result.pullRequest.url}
            className="text-accent"
            data-testid="scm-result-pr-link"
          >
            <Icon concept="pr" size={12} />
            PR #{result.pullRequest.number}
          </Link>
        )}
      </div>
    );
  }

  const failing = result.steps.find((s) => s.status === 'failed' || s.status === 'blocked');
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-card border border-line-soft bg-warn-bg px-2.5 py-1.5 text-small',
        className,
      )}
      data-testid="scm-result-card"
    >
      <Icon concept="warning" size={14} className="mt-px shrink-0 text-warn" />
      <span className="min-w-0 text-warn">
        Source control {result.status === 'blocked' ? 'was blocked' : 'failed'}
        {failing?.detail ? ` — ${failing.detail}` : result.error ? ` — ${result.error}` : '.'}
      </span>
    </div>
  );
}
