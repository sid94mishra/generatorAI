// ────────────────────────────────────────────────────────────────
// StageHistoryTab — one stage's executions across the runs of its
// workflow (P07 WP-7.6): the newest instances of the stage key, each with
// its run, status, start, duration, attempts, usage and error, linking to
// that run. Fetched only while the tab is open.
// ────────────────────────────────────────────────────────────────

import { Link as RouterLink } from 'react-router';
import { resolveStatus } from '@generatorai/shared';
import { runTitle } from '@generatorai/client-core';
import { useStageHistory } from '@/hooks/workflowQueries.js';
import { cn } from '@/ui/lib/cn.js';
import { InlineCode } from '@/ui/primitives/InlineCode/InlineCode.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { StatusBadge } from '@/ui/primitives/StatusBadge/StatusBadge.js';
import { focusRing } from '@/ui/lib/focus.js';
import { compactCount, formatMs, formatUsd, spanMs, usageNumbers } from '../model/format.js';

const LIMIT = 25;

export function StageHistoryTab({
  definitionId,
  stageKey,
  currentRunId,
  currentStageRunId,
}: {
  definitionId: string;
  stageKey: string;
  currentRunId?: string | undefined;
  currentStageRunId: string;
}) {
  const { data, isLoading, error } = useStageHistory(definitionId, stageKey, { limit: LIMIT });

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 text-small text-fg-3">
        <Spinner size={12} /> Loading the stage's history…
      </p>
    );
  }
  if (error) {
    return (
      <p role="alert" className="text-small text-err">
        {error instanceof Error ? error.message : 'Could not load the history'}
      </p>
    );
  }
  if (!data || data.length === 0) return <p className="text-small text-fg-3">This stage has not run before.</p>;

  return (
    <div className="flex flex-col gap-1.5" data-testid="stage-history">
      <p className="text-small text-fg-3">
        The last {data.length} executions of <InlineCode dense>{stageKey}</InlineCode> across this workflow's runs.
      </p>
      <ol className="flex flex-col gap-1">
        {data.map(({ stageRun: sr, run }) => {
          const usage = usageNumbers(sr.usage ?? undefined);
          const tokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
          const here = sr.id === currentStageRunId;
          const status = resolveStatus('stageRun', sr.status);
          const attempts = sr.currentAttempt ?? 0;
          return (
            <li key={sr.id}>
              <RouterLink
                to={`/workflows/${definitionId}/runs/${run.id}`}
                aria-current={here ? 'true' : undefined}
                className={cn(
                  'block rounded-control border px-2 py-1.5 text-small transition-control hover:bg-hover',
                  here ? 'border-line-strong bg-selected' : 'border-line-soft',
                  focusRing,
                )}
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  {status ? <StatusBadge state={status.state} label={status.label} /> : null}
                  <span className="min-w-0 flex-1 truncate font-medium text-fg" title={run.id}>
                    {runTitle(run.name)}
                    {run.id === currentRunId ? <span className="ml-1 text-fg-3">(this run)</span> : null}
                  </span>
                  <span className="shrink-0 text-fg-3">
                    {sr.startedAt
                      ? new Date(sr.startedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
                      : 'not started'}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 text-micro text-fg-3">
                  {sr.instancePath && sr.instancePath !== stageKey ? <span className="font-mono">{sr.instancePath}</span> : null}
                  <span>{formatMs(spanMs(sr.startedAt ?? undefined, sr.completedAt ?? undefined))}</span>
                  <span>
                    {attempts} attempt{attempts === 1 ? '' : 's'}
                  </span>
                  {usage.turns !== undefined ? <span>{usage.turns} turns</span> : null}
                  {tokens > 0 ? <span>{compactCount(tokens)} tokens</span> : null}
                  {usage.costUsd !== undefined ? <span>{formatUsd(usage.costUsd)}</span> : null}
                </div>
                {sr.error ? <p className="mt-0.5 line-clamp-2 text-micro text-err">{sr.error}</p> : null}
              </RouterLink>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
