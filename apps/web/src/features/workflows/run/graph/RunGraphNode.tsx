// ────────────────────────────────────────────────────────────────
// RunGraphNode — one stage instance on the run graph: status glyph and
// name, the status word, a loop's `n/max` badge, rule streaks, pending
// decision and exit (P05), the error, and the retry count.
// ────────────────────────────────────────────────────────────────

import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { resolveStatus, type StageRun, type StatusState } from '@generatorai/shared';
import { Icon } from '@/ui/icons/Icon.js';
import { cn } from '@/ui/lib/cn.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { StatusBadge } from '@/ui/primitives/StatusBadge/StatusBadge.js';
import { loopBadge, loopExitText, loopRulesText } from '../model/loopView.js';
import type { LoopView } from '../model/types.js';
import { stageStatusColor, useGraphColors } from './graphColors.js';

export interface RunGraphNodeData extends Record<string, unknown> {
  stageRun: StageRun;
  label: string;
  isSelected: boolean;
  /** A loop instance (P05): its `n/max` badge, rule streaks and decision. */
  loop?: LoopView;
}

/** Card border per visual state; the selected card adds the focus ring. */
const STATE_BORDER: Record<StatusState, string> = {
  queued: 'border-line',
  running: 'border-run',
  waiting: 'border-warn',
  needs_you: 'border-warn',
  paused: 'border-warn',
  succeeded: 'border-ok',
  failed: 'border-err',
  skipped: 'border-line-soft',
};

function RunGraphNodeComponent({ data }: NodeProps<Node<RunGraphNodeData>>) {
  const { stageRun, label, isSelected, loop } = data;
  const colors = useGraphColors();
  const status = stageRun.status;
  const resolved = resolveStatus('stageRun', status);
  const state = resolved?.state ?? 'queued';
  // Retries are the attempts beyond the first.
  const retries = Math.max(0, (stageRun.currentAttempt ?? 0) - 1);
  const finished = status === 'completed' || status === 'failed';
  const exitText = loop && finished ? loopExitText(loop) : null;
  // React Flow's handle stylesheet is unlayered: the colours go in as values.
  const handleColor = status === 'running' || status === 'completed' ? stageStatusColor(colors, status) : colors.line;
  const handleStyle = { background: colors.surface, borderColor: handleColor };

  return (
    <div
      className={cn(
        'relative min-w-60 max-w-80 cursor-pointer rounded-card border-2 bg-surface px-4 py-3 text-fg transition-control hover:bg-hover',
        STATE_BORDER[state],
        isSelected && 'ring-2 ring-focus',
      )}
    >
      <Handle type="target" position={Position.Left} style={handleStyle} />
      <Handle type="source" position={Position.Right} style={handleStyle} />

      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-ui font-semibold">{label}</span>
      </div>
      <div className="mt-1.5">
        {resolved ? <StatusBadge state={resolved.state} label={resolved.label} /> : null}
      </div>

      {/* Loop (P05): n/max, the rule streaks, a pending decision, the exit */}
      {loop ? (
        <div className="mt-1.5 flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="run" icon="refresh" className="font-mono tabular-nums">
              {loopBadge(loop)}
            </Badge>
            {loop.decision ? (
              <Badge tone="warn" icon="hand">
                Needs decision
              </Badge>
            ) : null}
          </div>
          {loop.rules.length > 0 && !finished ? (
            <div className="truncate font-mono text-micro text-fg-3" title={loopRulesText(loop)}>
              {loopRulesText(loop)}
            </div>
          ) : null}
          {exitText ? <div className="truncate text-small text-fg-3">{exitText}</div> : null}
        </div>
      ) : null}

      {stageRun.error ? (
        <div className="mt-1.5 flex min-w-0 items-center gap-1 text-small text-err">
          <Icon concept="warning" size={12} />
          <span className="truncate">{stageRun.error}</span>
        </div>
      ) : null}

      {retries > 0 ? <div className="mt-1 text-small text-fg-3">Retry #{retries}</div> : null}
    </div>
  );
}

export const RunGraphNode = memo(RunGraphNodeComponent);
