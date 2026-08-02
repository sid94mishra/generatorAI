// ────────────────────────────────────────────────────────────────
// RuntimeStageEdge — Custom React Flow edge for runtime mode
// Animated edges with color-coded data flow indicators
// ────────────────────────────────────────────────────────────────

import React, { memo } from 'react';
import {
  BaseEdge,
  getBezierPath,
  type EdgeProps,
  type Edge,
} from '@xyflow/react';
import type { RuntimeStageEdgeData } from './RuntimeDAGCanvas.js';
import { EDGE_TYPE_COLORS, edgeTypeColor } from './edgeTypeStyles.js';

/** Runtime status → edge style */
function getEdgeStyle(sourceStatus: string, targetStatus: string, edgeType: string) {
  const baseColor = edgeTypeColor(edgeType);

  // Both complete → solid green
  if (sourceStatus === 'completed' && (targetStatus === 'completed' || targetStatus === 'running')) {
    return {
      stroke: EDGE_TYPE_COLORS.on_success,
      strokeWidth: 2.5,
      opacity: 1,
      animated: false,
    };
  }

  // Source running → animated with edge color
  if (sourceStatus === 'running') {
    return {
      stroke: baseColor,
      strokeWidth: 2,
      opacity: 0.8,
      animated: true,
    };
  }

  // Source completed, target pending/queued → dashed
  if (sourceStatus === 'completed' && (targetStatus === 'pending' || targetStatus === 'queued')) {
    return {
      stroke: baseColor,
      strokeWidth: 2,
      opacity: 0.6,
      animated: true,
    };
  }

  // Source or target failed → red
  if (sourceStatus === 'failed' || targetStatus === 'failed') {
    return {
      stroke: '#ef4444',
      strokeWidth: 2,
      opacity: 0.7,
      animated: false,
    };
  }

  // Default → muted
  return {
    stroke: '#94a3b8',
    strokeWidth: 1.5,
    opacity: 0.4,
    animated: false,
  };
}

function RuntimeStageEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps<Edge<RuntimeStageEdgeData>>) {
  const edgeType = data?.edgeType ?? 'on_success';
  const sourceStatus = data?.sourceStatus ?? 'pending';
  const targetStatus = data?.targetStatus ?? 'pending';

  const style = getEdgeStyle(sourceStatus, targetStatus, edgeType);

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.25,
  });

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      markerEnd={markerEnd}
      style={{
        stroke: style.stroke,
        strokeWidth: style.strokeWidth,
        opacity: style.opacity,
        strokeDasharray: style.animated ? '5 5' : undefined,
        animation: style.animated ? 'dashdraw 0.5s linear infinite' : undefined,
      }}
    />
  );
}

export const RuntimeStageEdge = memo(RuntimeStageEdgeComponent);
