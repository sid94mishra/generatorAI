// ────────────────────────────────────────────────────────────────
// Loop iterations on WF-19 IterationsTable (blocks/workflow) — one row per loop iteration (`loop_iterations`,
// P05 §2.6): `# · outcome · score · changed · turns · cost`, plus the live
// iteration while it runs. A column shows only when some row has its data
// (D-36: no fake columns — `open` comments has no API, so it is not drawn).
// ────────────────────────────────────────────────────────────────

import {
  resolveMapping,
  resolveStatus,
  toStatus,
  type LoopIteration,
  type ResolvedStatus,
  type StageRunStatus,
} from '@generatorai/shared';
import { IterationsTable, type IterationsColumn } from '@/blocks/workflow/index.js';
import { cn } from '@/ui/lib/cn.js';
import { Icon } from '@/ui/icons/Icon.js';
import type { IconConcept } from '@generatorai/design-tokens';
import { STATUS_TONE_TEXT } from '@/ui/primitives/StatusBadge/StatusBadge.js';
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
      className={cn(
        'shrink-0',
        STATUS_TONE_TEXT[state.def.tone],
        state.def.spin && 'animate-spin reduced:animate-none',
      )}
    />
  );
}

interface IterationRow {
  k: number;
  outcome: string | null;
  checkpointed: boolean;
  score: number | null;
  changed: boolean | null | undefined;
  turns: number | undefined;
  cost: number | undefined;
}

export interface LoopIterationsTableProps {
  rows: readonly LoopIteration[];
  /** The iteration in flight (0-based), when the loop is running and it has no row yet. */
  liveK?: number | null;
  className?: string;
}

/** The loop's iterations on the WF-19 table; only columns with data are drawn (D-36). */
export function LoopIterationsTable({ rows, liveK = null, className }: LoopIterationsTableProps) {
  const items: IterationRow[] = rows.map((r) => ({
    k: r.k,
    outcome: r.outcome,
    checkpointed: Boolean(r.checkpointTurnId),
    score: r.score,
    changed: r.signals?.workspaceChanged,
    turns: num(r.usage?.['turns']),
    cost: num(r.usage?.['costUsd']),
  }));
  if (liveK !== null && liveK >= 0 && !rows.some((r) => r.k === liveK)) {
    items.push({
      k: liveK,
      outcome: null,
      checkpointed: false,
      score: null,
      changed: undefined,
      turns: undefined,
      cost: undefined,
    });
  }
  if (items.length === 0) return null;
  const running = resolveStatus('stageRun', 'running');
  const dash = '—';

  const columns: IterationsColumn<IterationRow>[] = [
    { id: 'k', header: '#', width: 'auto', mono: true, cell: (r) => `#${r.k}` },
    {
      id: 'outcome',
      header: 'Outcome',
      width: 'minmax(0,1fr)',
      cell: (r) =>
        r.outcome === null ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <StatusGlyph state={running} />
            <span className="truncate text-micro text-fg-3">running</span>
          </span>
        ) : (
          <span className="flex min-w-0 items-center gap-1.5">
            <StatusGlyph state={outcomeStatus(r.outcome)} />
            <span className="truncate font-mono text-micro text-fg-2">{r.outcome}</span>
            {r.checkpointed && <span className="text-micro text-ok">checkpointed</span>}
          </span>
        ),
    },
  ];
  if (items.some((r) => r.score !== null)) {
    columns.push({
      id: 'score',
      header: 'Score',
      width: 'auto',
      align: 'end',
      mono: true,
      cell: (r) => r.score ?? dash,
    });
  }
  if (items.some((r) => r.changed !== null && r.changed !== undefined)) {
    columns.push({
      id: 'changed',
      header: 'Changed',
      width: 'auto',
      align: 'end',
      mono: true,
      cell: (r) => (r.changed === true ? 'yes' : r.changed === false ? 'no' : dash),
    });
  }
  if (items.some((r) => r.turns !== undefined)) {
    columns.push({
      id: 'turns',
      header: 'Turns',
      width: 'auto',
      align: 'end',
      mono: true,
      cell: (r) => (r.turns !== undefined ? compactCount(r.turns) : dash),
    });
  }
  if (items.some((r) => r.cost !== undefined)) {
    columns.push({
      id: 'cost',
      header: 'Cost',
      width: 'auto',
      align: 'end',
      mono: true,
      cell: (r) => (r.cost !== undefined ? formatUsd(r.cost) : dash),
    });
  }

  return (
    <IterationsTable
      label="Iterations"
      columns={columns}
      rows={items}
      getRowId={(r) => String(r.k)}
      className={className}
    />
  );
}
