// ────────────────────────────────────────────────────────────────
// WorkflowDetail rail — Runs (board WorkflowDetail): G-10 stats for this
// definition (last 30 days), the server run search (name/id, statuses,
// triggers, dates, variables; P07 WP-7.6) and the newest runs with their
// pinned version (WF-01 "v7", from the definition's versions) and trigger
// (WF-20). Cost is not shown: providers report it unevenly (D-35 tokens-only).
// ────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { toStatus, type WorkflowRun } from '@generatorai/shared';
import { runTitle } from '@generatorai/client-core';
import { useWorkflowRuns } from '@/hooks/workflowQueries.js';
import { useStatsSummary } from '@/hooks/statsQueries.js';
import { TriggerChip } from '@/blocks/workflow/index.js';
import { formatRelativeTime } from '@/utils/formatRelativeTime.js';
import { StatStrip, type StatTileItem } from '@/ui/patterns/StatStrip/StatStrip.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Card } from '@/ui/primitives/Card/Card.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { Link } from '@/ui/primitives/Link/Link.js';
import { SearchInput } from '@/ui/primitives/SearchInput/SearchInput.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { StatusDot } from '@/ui/primitives/StatusDot/StatusDot.js';
import { Table, TableBody, TableCell, TableHeadCell, TableHeader, TableRow } from '@/ui/primitives/Table/Table.js';
import { formatDuration, formatPercent, last30Days } from '../workflowFormat.js';
import { RunFilterChips, RunFilterPopover } from './RunFilterPopover.js';
import { EMPTY_RUN_FILTERS, activeFilterCount, toRunListFilter, type RunFilters } from './runFilters.js';

const PAGE = 10;

function runStart(run: WorkflowRun): number {
  return new Date(run.startedAt ?? run.createdAt).getTime();
}

export function RunsRail({ definitionId, versionLabels }: { definitionId: string; versionLabels: ReadonlyMap<string, string> }) {
  // The run list is a server search: typing settles for a moment before it is sent.
  const [filters, setFilters] = useState<RunFilters>(EMPTY_RUN_FILTERS);
  const [searched, setSearched] = useState<RunFilters>(EMPTY_RUN_FILTERS);
  const [visible, setVisible] = useState(PAGE);
  useEffect(() => {
    const t = setTimeout(() => setSearched(filters), 300);
    return () => clearTimeout(t);
  }, [filters]);
  const search = useMemo(() => toRunListFilter(searched, { definitionId }), [searched, definitionId]);
  const filtering = !!searched.q.trim() || activeFilterCount(searched) > 0;
  const { data: runs, isLoading, isFetching, isError, error } = useWorkflowRuns(search);

  const range = useMemo(() => last30Days(), []);
  const stats = useStatsSummary(useMemo(() => ({ ...range, definitionId }), [range, definitionId]));

  // Newest first (the API returns createdAt ascending).
  const sorted = useMemo(() => [...(runs ?? [])].sort((a, b) => runStart(b) - runStart(a)), [runs]);
  const shown = sorted.slice(0, visible);

  const tiles: StatTileItem[] = [];
  if (stats.data) {
    const { runs: r } = stats.data;
    if (r.successRate !== undefined) tiles.push({ value: formatPercent(r.successRate), label: 'Succeeded' });
    if (r.medianDurationMs !== undefined) tiles.push({ value: formatDuration(r.medianDurationMs), label: 'Median run' });
    if (tiles.length > 0) tiles.push({ value: r.total, label: '30-day runs' });
  }

  const change = (next: RunFilters) => {
    setFilters(next);
    setVisible(PAGE);
  };

  return (
    <Card data-testid="workflow-runs-rail">
      <Card.Header
        title={
          <span className="flex items-center gap-2">
            {filtering ? 'Matching runs' : 'Runs'}
            {runs ? <span className="font-mono text-micro text-fg-3">{sorted.length}</span> : null}
            {isFetching && !isLoading ? <Spinner size={12} label="Refreshing runs" /> : null}
          </span>
        }
        action={<RunFilterPopover value={filters} onChange={change} />}
      />
      <div className="flex flex-col gap-2 px-3 pb-3">
        {tiles.length > 0 ? <StatStrip items={tiles} /> : null}
        <SearchInput value={filters.q} onValueChange={(q) => change({ ...filters, q })} label="Search runs" placeholder="Search runs by name or id" shortcut={null} size="sm" />
        <RunFilterChips value={filters} onChange={change} />
      </div>
      {isError ? (
        <EmptyState tone="error" icon="warning" title="Couldn't load runs" description={String(error)} />
      ) : isLoading ? (
        <div className="flex justify-center py-6">
          <Spinner size={16} label="Loading runs" />
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState
          icon="play"
          title={filtering ? 'No runs match these filters' : 'No runs yet'}
          description={filtering ? undefined : 'Run this workflow to see its history.'}
        />
      ) : (
        <>
          <Table columns={[16, 'minmax(0,1fr)', 36, 24, 64]} size="dense" inset="card" bare label="Runs">
            <TableHeader>
              <TableHeadCell>
                <span className="sr-only">Status</span>
              </TableHeadCell>
              <TableHeadCell>Run</TableHeadCell>
              <TableHeadCell>Ver</TableHeadCell>
              <TableHeadCell><span className="sr-only">Trigger</span></TableHeadCell>
              <TableHeadCell align="end">Started</TableHeadCell>
            </TableHeader>
            <TableBody>
              {shown.map((run) => (
                <RunRow key={run.id} run={run} version={versionLabels.get(run.definitionVersionId)} />
              ))}
            </TableBody>
          </Table>
          {sorted.length > PAGE ? (
            <div className="flex items-center justify-between border-t border-line-soft px-3 py-2 text-small text-fg-3">
              <span>
                Showing {shown.length} of {sorted.length}
              </span>
              <span className="flex gap-1">
                {sorted.length > shown.length ? (
                  <Button size="sm" variant="ghost" onClick={() => setVisible((n) => n + PAGE)}>
                    Show more
                  </Button>
                ) : null}
                {visible > PAGE ? (
                  <Button size="sm" variant="ghost" onClick={() => setVisible(PAGE)}>
                    Show less
                  </Button>
                ) : null}
              </span>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}

function RunRow({ run, version }: { run: WorkflowRun; version: string | undefined }) {
  const status = toStatus('workflowRun', run.status);
  const elapsed = run.startedAt ? new Date(run.completedAt ?? Date.now()).getTime() - new Date(run.startedAt).getTime() : undefined;
  return (
    <TableRow>
      <TableCell>{status ? <StatusDot state={status.state} label={status.label} title={status.label} /> : null}</TableCell>
      <TableCell>
        <Link
          render={<RouterLink to={`/workflows/${run.workflowDefinitionId}/runs/${run.id}`} />}
          className="truncate"
          title={`${runTitle(run.name)}${elapsed !== undefined ? ` · ${formatDuration(elapsed)}` : ''}`}
        >
          {runTitle(run.name)}
        </Link>
      </TableCell>
      <TableCell mono>{version ?? '—'}</TableCell>
      <TableCell>
        <TriggerChip kind={run.trigger?.kind} iconOnly />
      </TableCell>
      <TableCell mono align="end">
        {formatRelativeTime(new Date(run.startedAt ?? run.createdAt))}
      </TableCell>
    </TableRow>
  );
}
