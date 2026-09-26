// ────────────────────────────────────────────────────────────────
// StageEdge — a dependency between two stages on the builder canvas (React
// Flow edge type `stageEdge`; boards WorkflowBuilder, WorkflowValidate).
//
// An orthogonal path stroked and dashed by its kind (model/edgeStyles: solid
// success, dashed red failure, dotted completion). At its midpoint, small
// pills: the kind ("on failure" — a success edge shows it only while hovered,
// focused or selected), which is also the kind picker; the `when` expression
// in mono; "handles failure"; the edge's validation errors in err; and, while
// active, a remove button.
// ────────────────────────────────────────────────────────────────

import { memo, useMemo, useState, type CSSProperties } from 'react';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type Edge, type EdgeProps } from '@xyflow/react';
import type { EdgeOn } from '@generatorai/workflow-spec';
import { cn } from '@/ui/lib/cn.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Chip } from '@/ui/primitives/Chip/Chip.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Menu } from '@/ui/primitives/Menu/Menu.js';
import { Tooltip } from '@/ui/primitives/Tooltip/Tooltip.js';
import { useWorkflowBuilderStore, type StageEdgeData } from '@/stores/workflowBuilderStore.js';
import { EDGE_DASHES, EDGE_HINTS, EDGE_LABELS, EDGE_ORDER, EDGE_STROKES, EDGE_TEXT, edgeOn } from '../model/edgeStyles.js';
import { useCanvasContext } from './canvasContext.js';
import { XY_INTERACTIVE } from './canvasTheme.js';

/** Corner radius and first-leg length of the orthogonal path. */
const PATH_RADIUS = 8;
const PATH_OFFSET = 16;

/** The edge's own path styling (React Flow marks store edges `animated`; the builder's edges are still). */
function pathStyle(on: EdgeOn, selected: boolean): CSSProperties {
  return {
    stroke: EDGE_STROKES[on],
    strokeWidth: selected ? 2 : 1.5,
    strokeDasharray: EDGE_DASHES[on] ?? 'none',
    animation: 'none',
  };
}

/** A label pill on the canvas: raised, soft border, badge radius. */
const LABEL_PILL = 'rounded-badge border-line-soft bg-raised';

function useEdgeErrors(id: string): string[] {
  const issues = useWorkflowBuilderStore((s) => s.issues);
  return useMemo(() => issues.filter((i) => i.edgeId === id && i.severity === 'error').map((i) => i.message), [issues, id]);
}

function StageEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected = false,
}: EdgeProps<Edge<StageEdgeData>>) {
  const removeEdge = useWorkflowBuilderStore((s) => s.removeEdge);
  const selectEdge = useWorkflowBuilderStore((s) => s.selectEdge);
  const updateEdge = useWorkflowBuilderStore((s) => s.updateEdge);
  const { hoveredEdgeId } = useCanvasContext();
  const [menuOpen, setMenuOpen] = useState(false);
  const errors = useEdgeErrors(id);

  const on = edgeOn(data?.edge.on);
  const when = data?.edge.when;
  const handlesFailure = data?.edge.handlesFailure === true;
  const label = EDGE_LABELS[on];
  const active = selected || menuOpen || hoveredEdgeId === id;

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: PATH_RADIUS,
    offset: PATH_OFFSET,
  });
  const style = useMemo(() => pathStyle(on, selected), [on, selected]);
  const labelStyle: CSSProperties = { transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` };
  // Hidden (still hoverable and focusable) until the edge is active.
  const revealed = cn('transition-opacity group-hover/edge:opacity-100 group-focus-within/edge:opacity-100', !active && 'opacity-0');

  return (
    <>
      <BaseEdge id={id} path={path} style={style} />
      <EdgeLabelRenderer>
        <div className={cn(XY_INTERACTIVE, 'group/edge pointer-events-auto absolute flex items-center gap-1')} style={labelStyle}>
          {errors.length > 0 ? (
            <Tooltip content={errors.join(' · ')}>
              <Badge tone="err" icon="status-failed" role="img" aria-label={`${errors.length} validation ${errors.length === 1 ? 'issue' : 'issues'} on this edge`}>
                {errors.length}
              </Badge>
            </Tooltip>
          ) : null}
          <Menu.Root open={menuOpen} onOpenChange={setMenuOpen}>
            <Menu.Trigger
              render={
                <Chip
                  size="sm"
                  dropdown
                  aria-label={`Edge condition: ${label}. Change condition`}
                  title={`Runs when: ${EDGE_HINTS[on]}${when ? ` · when ${when}` : ''}`}
                  onClick={() => selectEdge(id)}
                  className={cn(LABEL_PILL, EDGE_TEXT[on], on === 'success' && revealed)}
                >
                  {label.toLowerCase()}
                </Chip>
              }
            />
            <Menu.Popup align="center" aria-label="Edge condition">
              <Menu.RadioGroup value={on} onValueChange={(value) => updateEdge(id, { on: value as EdgeOn })}>
                {EDGE_ORDER.map((kind) => (
                  <Menu.RadioItem key={kind} value={kind} description={EDGE_HINTS[kind]}>
                    {EDGE_LABELS[kind]}
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
            </Menu.Popup>
          </Menu.Root>
          {when ? (
            <Tooltip content={`Active only when ${when}`}>
              <Chip size="sm" mono className={cn(LABEL_PILL, 'max-w-60')}>
                when {when}
              </Chip>
            </Tooltip>
          ) : null}
          {handlesFailure ? (
            <Chip size="sm" icon="shield" className={LABEL_PILL}>
              handles failure
            </Chip>
          ) : null}
          <IconButton
            size="sm"
            icon="x"
            label={`Remove ${label} edge`}
            onClick={() => removeEdge(id)}
            className={cn('bg-raised', revealed)}
          />
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const StageEdge = memo(StageEdgeComponent);
