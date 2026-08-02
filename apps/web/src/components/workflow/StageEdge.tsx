// ────────────────────────────────────────────────────────────────
// StageEdge — Custom React Flow edge with type label and delete
// Color-coded by edge type, animated flow direction
// ────────────────────────────────────────────────────────────────

import React, { memo, useCallback } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
  type Edge,
} from '@xyflow/react';
import { X, Check, Flag, Repeat } from 'lucide-react';
import type { StageEdgeData } from '@/stores/workflowBuilderStore.js';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import { edgeTypeColor, edgeTypeLabel } from './edgeTypeStyles.js';

/** Edge type → icon (makes the condition legible even at low zoom) */
const edgeTypeIcons: Record<string, React.ReactNode> = {
  on_success: <Check className="h-3 w-3" />,
  on_failure: <X className="h-3 w-3" />,
  on_completion: <Flag className="h-3 w-3" />,
  always: <Repeat className="h-3 w-3" />,
};

function StageEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  markerEnd,
}: EdgeProps<Edge<StageEdgeData>>) {
  const removeEdge = useWorkflowBuilderStore((s) => s.removeEdge);
  const selectEdge = useWorkflowBuilderStore((s) => s.selectEdge);

  const edgeType = data?.edgeType ?? 'on_success';
  const color = edgeTypeColor(edgeType);
  const label = edgeTypeLabel(edgeType);

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.25,
  });

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      removeEdge(id);
    },
    [id, removeEdge],
  );

  const handleClick = useCallback(() => {
    selectEdge(id);
  }, [id, selectEdge]);

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: color,
          strokeWidth: selected ? 3 : 2,
          opacity: selected ? 1 : 0.7,
          filter: selected ? `drop-shadow(0 0 3px ${color}40)` : undefined,
        }}
      />
      <EdgeLabelRenderer>
        <div
          onClick={handleClick}
          className="group pointer-events-auto absolute flex items-center gap-1"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
          }}
        >
          {/* Type label badge — icon + text, ringed for legibility at any zoom */}
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm ring-1 ring-black/10 transition-all"
            style={{ backgroundColor: color }}
          >
            {edgeTypeIcons[edgeType]}
            {label}
          </span>

          {/* Delete button (visible on hover) */}
          <button
            onClick={handleDelete}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white opacity-0 shadow-sm transition-opacity hover:bg-red-600 group-hover:opacity-100"
            aria-label={`Remove ${label} edge`}
            title="Remove edge"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const StageEdge = memo(StageEdgeComponent);
