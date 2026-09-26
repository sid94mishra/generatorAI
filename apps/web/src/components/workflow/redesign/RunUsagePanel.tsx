// ────────────────────────────────────────────────────────────────
// RunUsagePanel — the run's usage roll-up (P07 WP-7.6): the run totals
// and one row per stage instance (attempts, turns, tokens, cost, time).
// Cost is what providers reported, shown only when one did: there is no
// pricing table, so nothing here is an estimate.
// ────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import type { RunUsage, StageRun, WorkflowRunWithStages } from '@generatorai/shared';
import { cn } from '@/lib/utils.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/index.js';
import { compactCount, formatUsd } from './RunHeaderBar.js';

/** A usage record's numbers (`StageRun.usage` is untyped JSON). */
export function usageNumbers(usage: Record<string, unknown> | RunUsage | undefined): RunUsage {
  const n = (k: keyof RunUsage) => {
    const v = (usage as Record<string, unknown> | undefined)?.[k];
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  };
  const out: RunUsage = {};
  for (const k of ['turns', 'costUsd', 'inputTokens', 'outputTokens', 'toolCalls'] as const) {
    const v = n(k);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Milliseconds between two timestamps, or undefined when either is missing. */
export function spanMs(start: Date | string | number | undefined, end: Date | string | number | undefined): number | undefined {
  if (start === undefined || end === undefined) return undefined;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return Number.isFinite(ms) && ms >= 0 ? ms : undefined;
}

export function formatMs(ms: number | undefined): string {
  if (ms === undefined) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

interface Row {
  id: string;
  path: string;
  kind: string;
  status: string;
  attempts: number;
  usage: RunUsage;
  durationMs: number | undefined;
}

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
    for (const k of ['turns', 'costUsd', 'inputTokens', 'outputTokens', 'toolCalls'] as const) {
      const v = r.usage[k];
      if (v !== undefined) out[k] = (out[k] ?? 0) + v;
    }
  }
  return out;
}

export function RunUsagePanel({ run, onFocusStage }: { run: WorkflowRunWithStages; onFocusStage?: (id: string) => void }) {
  const rows = useMemo(
    () => run.stageRuns.map(rowOf).sort((a, b) => a.path.localeCompare(b.path)),
    [run.stageRuns],
  );
  // The run's own roll-up is authoritative (it counts summary turns and
  // retired attempts too); the instances' sum stands in when it is absent.
  const totals = run.usage && Object.keys(run.usage).length > 0 ? usageNumbers(run.usage) : sumUsage(rows);
  const anyCost = totals.costUsd !== undefined || rows.some((r) => r.usage.costUsd !== undefined);
  const wall = spanMs(run.startedAt, run.completedAt ?? (run.startedAt ? new Date() : undefined));

  const tiles: Array<{ label: string; value: string }> = [
    { label: 'Turns', value: String(totals.turns ?? 0) },
    { label: 'Input tokens', value: compactCount(totals.inputTokens ?? 0) },
    { label: 'Output tokens', value: compactCount(totals.outputTokens ?? 0) },
    { label: 'Tool calls', value: String(totals.toolCalls ?? 0) },
    ...(totals.costUsd !== undefined ? [{ label: 'Cost (reported)', value: formatUsd(totals.costUsd) }] : []),
    { label: 'Wall clock', value: formatMs(wall) },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="run-usage">
      <div className="grid shrink-0 grid-cols-3 gap-2 border-b border-border p-3">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-md border border-border bg-card px-2 py-1.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t.label}</p>
            <p className="font-mono text-sm tabular-nums text-foreground">{t.value}</p>
          </div>
        ))}
      </div>
      {!anyCost && (
        <p className="shrink-0 border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          No provider of this run reported cost; tokens are the spend.
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">No stage has started yet.</p>
        ) : (
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead>Instance</TableHead>
                <TableHead className="text-right">Attempts</TableHead>
                <TableHead className="text-right">Turns</TableHead>
                <TableHead className="text-right">Tokens in/out</TableHead>
                {anyCost && <TableHead className="text-right">Cost</TableHead>}
                <TableHead className="text-right">Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow
                  key={r.id}
                  className={cn(onFocusStage && 'cursor-pointer')}
                  onClick={onFocusStage ? () => onFocusStage(r.id) : undefined}
                >
                  <TableCell className="max-w-[12rem] truncate font-mono" title={`${r.path} (${r.kind}, ${r.status})`}>
                    {r.path}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.attempts}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.usage.turns ?? '—'}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {r.usage.inputTokens !== undefined || r.usage.outputTokens !== undefined
                      ? `${compactCount(r.usage.inputTokens ?? 0)}/${compactCount(r.usage.outputTokens ?? 0)}`
                      : '—'}
                  </TableCell>
                  {anyCost && (
                    <TableCell className="text-right font-mono tabular-nums">
                      {r.usage.costUsd !== undefined ? formatUsd(r.usage.costUsd) : '—'}
                    </TableCell>
                  )}
                  <TableCell className="text-right tabular-nums">{formatMs(r.durationMs)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
