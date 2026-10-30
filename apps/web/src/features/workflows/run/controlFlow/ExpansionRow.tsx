// ────────────────────────────────────────────────────────────────
// ExpansionRow — a planner's expansion (P08 plan-then-execute, the implicit
// `<planner>~x` node) in the run's stage table.
//
//   ⌄ ◌ Planned by Plan  2/3
//       ┌ planned by Plan ─ ─ ─ ─ ─ ─ ─ ─ ┐
//       │ A · B · C (the planned stages)  │
//       └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
//
// The row is the page's StageRow (through `renderStage`) whose transcript is
// replaced by a dashed group of the planned stages; they render through
// ControlFlowNode like any container body, one depth deeper.
// ────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { Icon } from '@/ui/icons/Icon.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { BodyRows, type ControlFlowNodeProps } from './ControlFlowNode.js';

const SETTLED = new Set(['completed', 'failed', 'cancelled', 'skipped']);

export function ExpansionRow({ runId, stage, bodies, focusedId, showConnector, renderStage, onCommand, depth = 0 }: ControlFlowNodeProps) {
  const x = stage.expansion!;
  const body = useMemo(() => bodies[stage.id] ?? [], [bodies, stage.id]);
  const done = body.filter((s) => SETTLED.has(s.status)).length;

  const group = (
    <div role="group" aria-label={`Planned by ${x.plannedBy}`} className="flex flex-col gap-2 rounded-card border border-dashed border-line p-2.5">
      <div className="flex items-center gap-1.5 text-small font-medium text-fg-3">
        <Icon concept="tasks" size={12} />
        planned by {x.plannedBy}
        {x.join === 'tolerate' && <span className="font-normal">· tolerates failures</span>}
      </div>
      {body.length === 0 ? (
        <p className="text-small text-fg-3">{stage.rawStatus === 'failed' ? (stage.error ?? 'The plan was refused.') : 'Waiting for the plan…'}</p>
      ) : (
        <div className="flex flex-col">
          <BodyRows list={body} parent={{ runId, bodies, focusedId, renderStage, onCommand, depth }} />
        </div>
      )}
    </div>
  );

  const badge = (
    <Badge tone="run" icon="tasks" className="font-mono tabular-nums" title={`${done} of ${x.count} planned stages settled`}>
      {done}/{x.count}
    </Badge>
  );

  return <>{renderStage(stage, { showConnector, depth, headerExtra: badge, body: group, hidePrompt: true })}</>;
}
