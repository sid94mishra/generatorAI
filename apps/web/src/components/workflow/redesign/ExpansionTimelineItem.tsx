// ────────────────────────────────────────────────────────────────
// ExpansionTimelineItem — a planner's expansion (P08 plan-then-execute,
// the implicit `<planner>~x` node) on the run timeline.
//
//   ● Planned by Plan  Running  ⇉ 2/3 done
//   ┆  ┌ planned by Plan ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
//   ┆  │ ● A  ● B  ● C  (the planned stages) │
//   ┆  └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
//
// The row is a StageTimelineItem (the page's renderer) whose transcript is
// replaced by a dashed group of the planned stages; they render through
// ControlFlowNode like any container body.
// ────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import { ListTree } from 'lucide-react';
import type { RunCommand } from '@generatorai/workflow-spec';
import type { RenderStage } from './LoopTimelineItem.js';
import { ControlFlowNode } from './ControlFlowNode.js';
import type { StageView } from './types.js';

interface ExpansionTimelineItemProps {
  runId: string;
  stage: StageView;
  bodies: Record<string, StageView[]>;
  focusedId: string | null;
  showConnector: boolean;
  renderStage: RenderStage;
  onCommand: (command: RunCommand) => Promise<void>;
}

const SETTLED = new Set(['completed', 'failed', 'cancelled', 'skipped']);

export function ExpansionTimelineItem({ runId, stage, bodies, focusedId, showConnector, renderStage, onCommand }: ExpansionTimelineItemProps) {
  const x = stage.expansion!;
  const body = useMemo(() => bodies[stage.id] ?? [], [bodies, stage.id]);
  const done = body.filter((s) => SETTLED.has(s.status)).length;

  const group = (
    <div role="group" aria-label={`Planned by ${x.plannedBy}`} className="rounded-lg border-2 border-dashed border-[var(--color-border)] bg-[var(--color-primary)]/[0.03] p-2.5">
      <div className="mb-2 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
        <ListTree className="h-3 w-3" />
        planned by {x.plannedBy}
        {x.join === 'tolerate' && <span className="font-normal normal-case tracking-normal">· tolerates failures</span>}
      </div>
      {body.length === 0 ? (
        <p className="text-[11.5px] text-[var(--color-muted-foreground)]">
          {stage.rawStatus === 'failed' ? (stage.error ?? 'The plan was refused.') : 'Waiting for the plan…'}
        </p>
      ) : (
        <div className="space-y-2">
          {body.map((s, i) => (
            <ControlFlowNode
              key={s.id}
              runId={runId}
              stage={s}
              bodies={bodies}
              focusedId={focusedId}
              showConnector={i < body.length - 1}
              renderStage={renderStage}
              onCommand={onCommand}
              inContainer
            />
          ))}
        </div>
      )}
    </div>
  );

  const badge = (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--color-primary)]/10 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-[var(--color-primary)]"
      title={`${done} of ${x.count} planned stages settled`}
    >
      <ListTree className="h-2.5 w-2.5" />
      {done}/{x.count}
    </span>
  );

  return <>{renderStage(stage, { showConnector, headerExtra: badge, body: group, hidePrompt: true })}</>;
}
