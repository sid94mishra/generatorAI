// ────────────────────────────────────────────────────────────────
// WF-19 IterationsTable — one row per loop iteration (`loop_iterations`,
// P05 §2.6): `# · outcome · score · changed · turns · cost`, plus the live
// iteration while it runs. A column shows only when some row has its data
// (D-36: no fake columns — `open` comments has no API, so it is not drawn).
// ────────────────────────────────────────────────────────────────

import { resolveMapping, resolveStatus, toStatus, type LoopIteration, type ResolvedStatus, type StageRunStatus } from '@generatorai/shared';
import { cn } from '@/ui/lib/cn.js';
import { Icon } from '@/ui/icons/Icon.js';
import type { IconConcept } from '@generatorai/design-tokens';
import { STATUS_TONE_TEXT } from '@/ui/primitives/StatusBadge/StatusBadge.js';
import { Table, TableBody, TableCell, TableHeadCell, TableHeader, TableRow } from '@/ui/primitives/Table/Table.js';
import { compactCount, formatUsd } from '../model/format.js';

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** An iteration outcome (`completed`, `failed`, `cancelled`) as a status glyph, via the stageRun map (D-18). */
export function outcomeStatus(outcome: string): ResolvedStatus | null {
  // An unknown outcome maps to null (toStatus looks the value up; it never throws).
  const mapping = toStatus('stageRun', outcome as StageRunStatus);
  return mapping ? resolveMapping(mapping, 'stageRun') : null;
}

/** A 14px status glyph in its tone; queued-grey for an unknown value. */
export function StatusGlyph({ state }: { state: ResolvedStatus | null }) {
  if (!state) return <Icon concept="status-queued" size={14} className="shrink-0 text-fg-3" />;
  return (
    <Icon
      concept={state.def.glyph as IconConcept}
      size={14}
      className={cn('shrink-0', STATUS_TONE_TEXT[state.def.tone], state.def.spin && 'animate-spin reduced:animate-none')}
    />
  );
}

export interface IterationsTableProps {
  rows: readonly LoopIteration[];
  /** The iteration in flight (0-based), when the loop is running and it has no row yet. */
  liveK?: number | null;
  /** Highlight this iteration's row. */
  selectedK?: number | null;
  className?: string;
}

/** The loop's iterations as a dense table; only columns with data are drawn. */
export function IterationsTable({ rows, liveK = null, selectedK = null, className }: IterationsTableProps) {
  const turnsOf = (r: LoopIteration) => num(r.usage?.['turns']);
  const costOf = (r: LoopIteration) => num(r.usage?.['costUsd']);
  const hasScore = rows.some((r) => r.score !== null);
  const hasChanged = rows.some((r) => r.signals?.workspaceChanged !== null && r.signals?.workspaceChanged !== undefined);
  const hasTurns = rows.some((r) => turnsOf(r) !== undefined);
  const hasCost = rows.some((r) => costOf(r) !== undefined);
  const live = liveK !== null && liveK >= 0 && !rows.some((r) => r.k === liveK) ? liveK : null;
  if (rows.length === 0 && live === null) return null;

  const columns: string[] = ['auto', 'minmax(0,1fr)'];
  if (hasScore) columns.push('auto');
  if (hasChanged) columns.push('auto');
  if (hasTurns) columns.push('auto');
  if (hasCost) columns.push('auto');
  const running = resolveStatus('stageRun', 'running');

  return (
    <Table columns={columns} size="dense" inset="card" label="Iterations" className={className}>
      <TableHeader>
        <TableHeadCell>#</TableHeadCell>
        <TableHeadCell>Outcome</TableHeadCell>
        {hasScore && <TableHeadCell align="end">Score</TableHeadCell>}
        {hasChanged && <TableHeadCell align="end">Changed</TableHeadCell>}
        {hasTurns && <TableHeadCell align="end">Turns</TableHeadCell>}
        {hasCost && <TableHeadCell align="end">Cost</TableHeadCell>}
      </TableHeader>
      <TableBody>
        {rows.map((r) => {
          const changed = r.signals?.workspaceChanged;
          const turns = turnsOf(r);
          const cost = costOf(r);
          return (
            <TableRow key={r.k} selected={selectedK === r.k || undefined}>
              <TableCell mono>#{r.k}</TableCell>
              <TableCell className="gap-1.5">
                <StatusGlyph state={outcomeStatus(r.outcome)} />
                <span className="truncate font-mono text-micro text-fg-2">{r.outcome}</span>
                {r.checkpointTurnId && <span className="text-micro text-ok">checkpointed</span>}
              </TableCell>
              {hasScore && <TableCell mono align="end">{r.score ?? '—'}</TableCell>}
              {hasChanged && (
                <TableCell mono align="end">
                  {changed === true ? 'yes' : changed === false ? 'no' : '—'}
                </TableCell>
              )}
              {hasTurns && <TableCell mono align="end">{turns !== undefined ? compactCount(turns) : '—'}</TableCell>}
              {hasCost && <TableCell mono align="end">{cost !== undefined ? formatUsd(cost) : '—'}</TableCell>}
            </TableRow>
          );
        })}
        {live !== null && (
          <TableRow selected={selectedK === live || undefined}>
            <TableCell mono>#{live}</TableCell>
            <TableCell className="gap-1.5">
              <StatusGlyph state={running} />
              <span className="truncate text-micro text-fg-3">running</span>
            </TableCell>
            {hasScore && <TableCell mono align="end">—</TableCell>}
            {hasChanged && <TableCell mono align="end">—</TableCell>}
            {hasTurns && <TableCell mono align="end">—</TableCell>}
            {hasCost && <TableCell mono align="end">—</TableCell>}
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
