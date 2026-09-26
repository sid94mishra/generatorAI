// ────────────────────────────────────────────────────────────────
// RunUsagePanel — the run's usage roll-up (P07 WP-7.6): the run totals
// and one row per stage instance (attempts, turns, tokens, cost, time).
// Cost is what providers reported, shown only when one did: there is no
// pricing table, so nothing here is an estimate (D-35, D-81).
// ────────────────────────────────────────────────────────────────

import { useMemo, type KeyboardEvent } from 'react';
import type { RunUsage, StageRun, WorkflowRunWithStages } from '@generatorai/shared';
import { focusRing } from '@/ui/lib/focus.js';
import { StatStrip, type StatTileItem } from '@/ui/patterns/StatStrip/StatStrip.js';
import { Table, TableBody, TableCell, TableHeadCell, TableHeader, TableRow } from '@/ui/primitives/Table/Table.js';
import { compactCount, formatMs, formatUsd, spanMs, usageNumbers } from '../model/format.js';

interface Row {
  id: string;
  path: string;
  kind: string;
  status: string;
  attempts: number;
  usage: RunUsage;
  durationMs: number | undefined;
}

const USAGE_KEYS = ['turns', 'costUsd', 'inputTokens', 'outputTokens', 'toolCalls'] as const;

function rowOf(sr: StageRun): Row {
  return {
    id: sr.id,
    path: sr.instancePath,
    kind: sr.kind,
    status: sr.status,
    attempts: sr.currentAttempt,
    usage: usageNumbers(sr.usage),
    durationMs: spanMs(sr.startedAt, sr.completedAt),
  };
}

/** The sum of the instances' usage (what a run without a rolled-up total shows). */
function sumUsage(rows: readonly Row[]): RunUsage {
  const out: RunUsage = {};
  for (const r of rows) {
    for (const k of USAGE_KEYS) {
      const v = r.usage[k];
      if (v !== undefined) out[k] = (out[k] ?? 0) + v;
    }
  }
  return out;
}

export interface RunUsagePanelProps {
  run: WorkflowRunWithStages;
  onFocusStage?: (id: string) => void;
}

export function RunUsagePanel({ run, onFocusStage }: RunUsagePanelProps) {
  const rows = useMemo(() => run.stageRuns.map(rowOf).sort((a, b) => a.path.localeCompare(b.path)), [run.stageRuns]);
  // The run's own roll-up is authoritative (it counts summary turns and
  // retired attempts too); the instances' sum stands in when it is absent.
  const totals = run.usage && Object.keys(run.usage).length > 0 ? usageNumbers(run.usage) : sumUsage(rows);
  const anyCost = totals.costUsd !== undefined || rows.some((r) => r.usage.costUsd !== undefined);
  const wall = spanMs(run.startedAt, run.completedAt ?? (run.startedAt ? new Date() : undefined));

  const tiles: StatTileItem[] = [
    { label: 'Turns', value: String(totals.turns ?? 0) },
    { label: 'Input tokens', value: compactCount(totals.inputTokens ?? 0) },
    { label: 'Output tokens', value: compactCount(totals.outputTokens ?? 0) },
    { label: 'Tool calls', value: String(totals.toolCalls ?? 0) },
    ...(totals.costUsd !== undefined ? [{ label: 'Cost (reported)', value: formatUsd(totals.costUsd) }] : []),
    { label: 'Wall clock', value: formatMs(wall) },
  ];

  const columns = anyCost ? ['minmax(0,1fr)', 56, 44, 84, 60, 56] : ['minmax(0,1fr)', 56, 44, 84, 56];
  const focusOnKey = (id: string) => (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onFocusStage?.(id);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface" data-testid="run-usage">
      <div className="shrink-0 border-b border-line-soft p-3">
        <StatStrip layout="grid" items={tiles} />
      </div>
      {!anyCost ? (
        <p className="shrink-0 border-b border-line-soft px-3 py-1.5 text-small text-fg-3">
          No provider of this run reported cost; tokens are the spend.
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <p className="p-3 text-small text-fg-3">No stage has started yet.</p>
        ) : (
          <Table columns={columns} size="dense" inset="card" bare label="Usage by stage instance">
            <TableHeader>
              <TableHeadCell>Instance</TableHeadCell>
              <TableHeadCell align="end">Attempts</TableHeadCell>
              <TableHeadCell align="end">Turns</TableHeadCell>
              <TableHeadCell align="end">Tokens in/out</TableHeadCell>
              {anyCost ? <TableHeadCell align="end">Cost</TableHeadCell> : null}
              <TableHeadCell align="end">Time</TableHeadCell>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow
                  key={r.id}
                  interactive={!!onFocusStage}
                  {...(onFocusStage
                    ? { tabIndex: 0, className: focusRing, onClick: () => onFocusStage(r.id), onKeyDown: focusOnKey(r.id) }
                    : {})}
                >
                  <TableCell className="font-mono text-small" title={`${r.path} (${r.kind}, ${r.status})`}>
                    <span className="truncate">{r.path}</span>
                  </TableCell>
                  <TableCell align="end" className="text-small tabular-nums">
                    {r.attempts}
                  </TableCell>
                  <TableCell align="end" className="text-small tabular-nums">
                    {r.usage.turns ?? '—'}
                  </TableCell>
                  <TableCell align="end" mono>
                    {r.usage.inputTokens !== undefined || r.usage.outputTokens !== undefined
                      ? `${compactCount(r.usage.inputTokens ?? 0)}/${compactCount(r.usage.outputTokens ?? 0)}`
                      : '—'}
                  </TableCell>
                  {anyCost ? (
                    <TableCell align="end" mono>
                      {r.usage.costUsd !== undefined ? formatUsd(r.usage.costUsd) : '—'}
                    </TableCell>
                  ) : null}
                  <TableCell align="end" className="text-small tabular-nums">
                    {formatMs(r.durationMs)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
