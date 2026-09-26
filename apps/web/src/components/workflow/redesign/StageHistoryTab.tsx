// ────────────────────────────────────────────────────────────────
// StageHistoryTab — one stage's executions across the runs of its
// workflow (P07 WP-7.6): the newest instances of the stage key, each with
// its run, status, start, duration, attempts, usage and error, linking to
// that run. Fetched only while the tab is open.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Link } from 'react-router-dom';
import { Spinner, StatusBadge } from '@/components/ui/index.js';
import { cn } from '@/lib/utils.js';
import { useStageHistory } from '@/hooks/workflowQueries.js';
import { runTitle } from '@generatorai/client-core';
import { compactCount, formatUsd } from './RunHeaderBar.js';
import { formatMs, spanMs, usageNumbers } from './RunUsagePanel.js';

const LIMIT = 25;

export function StageHistoryTab({
  definitionId,
  stageKey,
  currentRunId,
  currentStageRunId,
}: {
  definitionId: string;
  stageKey: string;
  currentRunId?: string;
  currentStageRunId: string;
}) {
  const { data, isLoading, error } = useStageHistory(definitionId, stageKey, { limit: LIMIT });

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <Spinner size="sm" /> Loading the stage's history…
      </p>
    );
  }
  if (error) return <p className="text-[11px] text-danger">{error instanceof Error ? error.message : 'Could not load the history'}</p>;
  if (!data || data.length === 0) return <p className="text-[11px] text-muted-foreground">This stage has not run before.</p>;

  return (
    <div className="space-y-1.5" data-testid="stage-history">
      <p className="text-[10.5px] text-muted-foreground">
        The last {data.length} executions of <span className="font-mono">{stageKey}</span> across this workflow's runs.
      </p>
      <ol className="space-y-1">
        {data.map(({ stageRun: sr, run }) => {
          const usage = usageNumbers(sr.usage ?? undefined);
          const tokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
          const here = sr.id === currentStageRunId;
          return (
            <li key={sr.id}>
              <Link
                to={`/workflows/${definitionId}/runs/${run.id}`}
                className={cn(
                  'block rounded-md border px-2 py-1.5 text-[11px] transition-colors hover:bg-subtle',
                  here ? 'border-primary/50 bg-primary/5' : 'border-border',
                )}
              >
                <div className="flex items-center gap-1.5">
                  <StatusBadge status={sr.status} size="sm" />
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={run.id}>
                    {runTitle(run.name)}
                    {run.id === currentRunId && <span className="ml-1 text-muted-foreground">(this run)</span>}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {sr.startedAt ? new Date(sr.startedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : 'not started'}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 text-[10.5px] text-muted-foreground">
                  {sr.instancePath && sr.instancePath !== stageKey && <span className="font-mono">{sr.instancePath}</span>}
                  <span>{formatMs(spanMs(sr.startedAt ?? undefined, sr.completedAt ?? undefined))}</span>
                  <span>
                    {sr.currentAttempt ?? 0} attempt{(sr.currentAttempt ?? 0) === 1 ? '' : 's'}
                  </span>
                  {usage.turns !== undefined && <span>{usage.turns} turns</span>}
                  {tokens > 0 && <span>{compactCount(tokens)} tokens</span>}
                  {usage.costUsd !== undefined && <span>{formatUsd(usage.costUsd)}</span>}
                </div>
                {sr.error && <p className="mt-0.5 line-clamp-2 text-[10.5px] text-danger">{sr.error}</p>}
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
