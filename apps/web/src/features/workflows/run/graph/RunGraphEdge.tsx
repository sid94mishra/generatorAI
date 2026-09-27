// ────────────────────────────────────────────────────────────────
// RunGraphEdge — a run-graph edge coloured by its `on` value and the
// runtime state of its ends. Flowing edges (source running, or completed
// with the target not started yet) are marked `animated` on the edge
// itself (RunGraph), which React Flow draws dashed and moving.
// ────────────────────────────────────────────────────────────────

import { memo } from 'react';
import { BaseEdge, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react';
import type { StageRunStatus } from '@generatorai/shared';
import { edgeTypeColor, useGraphColors, type GraphColors } from './graphColors.js';

export interface RunGraphEdgeData extends Record<string, unknown> {
  edgeType: string;
  sourceStatus: StageRunStatus;
  targetStatus: StageRunStatus;
}

interface EdgeLook {
  stroke: string;
  strokeWidth: number;
  opacity: number;
  animated: boolean;
}

/** Runtime state of the two ends → the edge's look. */
export function edgeLook(colors: GraphColors, sourceStatus: string, targetStatus: string, edgeType: string): EdgeLook {
  const base = edgeTypeColor(colors, edgeType);
  // Both complete (or the target took over) → solid ok.
  if (sourceStatus === 'completed' && (targetStatus === 'completed' || targetStatus === 'running')) {
    return { stroke: colors.ok, strokeWidth: 2.5, opacity: 1, animated: false };
  }
  // Source running → flowing, in the edge's colour.
  if (sourceStatus === 'running') return { stroke: base, strokeWidth: 2, opacity: 0.8, animated: true };
  // Source completed, target not started → flowing, fainter.
  if (sourceStatus === 'completed' && (targetStatus === 'pending' || targetStatus === 'ready' || targetStatus === 'starting')) {
    return { stroke: base, strokeWidth: 2, opacity: 0.6, animated: true };
  }
  // Either end failed → err.
  if (sourceStatus === 'failed' || targetStatus === 'failed') return { stroke: colors.err, strokeWidth: 2, opacity: 0.7, animated: false };
  // Otherwise muted.
  return { stroke: colors.fg3, strokeWidth: 1.5, opacity: 0.4, animated: false };
}

function RunGraphEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps<Edge<RunGraphEdgeData>>) {
  const colors = useGraphColors();
  const look = edgeLook(colors, data?.sourceStatus ?? 'pending', data?.targetStatus ?? 'pending', data?.edgeType ?? 'success');
  const [edgePath] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, curvature: 0.25 });
  const { stroke, strokeWidth, opacity } = look;
  return <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={{ stroke, strokeWidth, opacity }} />;
}

export const RunGraphEdge = memo(RunGraphEdgeComponent);
