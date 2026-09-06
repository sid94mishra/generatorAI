// ────────────────────────────────────────────────────────────────
// StageEdge — Custom React Flow edge with type picker and delete
// Color-coded by edge type, animated flow direction
// ────────────────────────────────────────────────────────────────

import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
  type Edge,
} from '@xyflow/react';
import { X, Check, Flag, Repeat, ChevronDown } from 'lucide-react';
import type { StageEdgeData } from '@/stores/workflowBuilderStore.js';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import {
  edgeTypeColor,
  edgeTypeLabel,
  EDGE_TYPE_ORDER,
  EDGE_TYPE_COLORS,
  EDGE_TYPE_LABELS,
  type StageEdgeType,
} from './edgeTypeStyles.js';
import { useCanvasReadonly } from './canvasContext.js';
import { Button } from '@/components/ui/index.js';

/** Edge type → icon (makes the condition legible even at low zoom) */
const edgeTypeIcons: Record<string, React.ReactNode> = {
  on_success: <Check className="h-3 w-3" />,
  on_failure: <X className="h-3 w-3" />,
  on_completion: <Flag className="h-3 w-3" />,
  always: <Repeat className="h-3 w-3" />,
};

/** When each edge type fires — shown in the picker so the choice is obvious. */
const edgeTypeHints: Record<StageEdgeType, string> = {
  on_success: 'Source stage completed',
  on_failure: 'Source stage failed',
  on_completion: 'Completed or failed',
  always: 'Any terminal status, including skipped',
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
  const updateEdgeType = useWorkflowBuilderStore((s) => s.updateEdgeType);
  const readonly = useCanvasReadonly();
  const [pickerOpen, setPickerOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

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

  // Close on an outside click / Escape — the picker floats over the canvas,
  // which swallows its own pointer events, so it needs a document listener.
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent): void => {
      if (!wrapRef.current?.contains(e.target as Node)) setPickerOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setPickerOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [pickerOpen]);

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      removeEdge(id);
    },
    [id, removeEdge],
  );

  const handleLabelClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      selectEdge(id);
      if (!readonly) setPickerOpen((p) => !p);
    },
    [id, selectEdge, readonly],
  );

  const pick = useCallback(
    (e: React.MouseEvent, type: StageEdgeType) => {
      e.stopPropagation();
      updateEdgeType(id, type);
      setPickerOpen(false);
    },
    [id, updateEdgeType],
  );

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
          ref={wrapRef}
          className="group pointer-events-auto absolute flex items-center gap-1"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
          }}
        >
          {/* Type badge — doubles as the edge-type picker trigger in the
              builder. Read-only canvases keep the badge but not the menu. */}
          <Button
            type="button"
            onClick={handleLabelClick}
            aria-haspopup={readonly ? undefined : 'menu'}
            aria-expanded={readonly ? undefined : pickerOpen}
            aria-label={readonly ? undefined : `Edge condition: ${label}. Change condition`}
            title={readonly ? label : `Runs when: ${edgeTypeHints[edgeType as StageEdgeType] ?? label}`}
            variant="ghost"
            size="sm"
            className="h-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm ring-1 ring-black/10 transition-all hover:opacity-90"
            style={{ backgroundColor: color }}
          >
            {edgeTypeIcons[edgeType]}
            {label}
            {!readonly && <ChevronDown className="h-2.5 w-2.5 opacity-80" />}
          </Button>

          {/* Delete button (visible on hover) */}
          {!readonly && (
            <Button
              onClick={handleDelete}
              variant="ghost"
              size="icon-sm"
              className="h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white opacity-0 shadow-sm transition-opacity hover:bg-red-600 group-hover:opacity-100"
              aria-label={`Remove ${label} edge`}
              title="Remove edge"
            >
              <X className="h-3 w-3" />
            </Button>
          )}

          {pickerOpen && !readonly && (
            <div
              role="menu"
              aria-label="Edge condition"
              className="absolute left-1/2 top-full z-50 mt-1.5 w-56 -translate-x-1/2 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] shadow-xl"
            >
              {EDGE_TYPE_ORDER.map((type) => (
                <Button
                  key={type}
                  type="button"
                  role="menuitemradio"
                  aria-checked={type === edgeType}
                  onClick={(e) => pick(e, type)}
                  variant="ghost"
                  size="sm"
                  className="h-auto flex w-full items-start gap-2 rounded-none px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--color-accent)]"
                >
                  <span
                    className="mt-1 h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: EDGE_TYPE_COLORS[type] }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11.5px] font-medium text-[var(--color-foreground)]">
                      {EDGE_TYPE_LABELS[type]}
                    </span>
                    <span className="block text-[10.5px] leading-snug text-[var(--color-muted-foreground)]">
                      {edgeTypeHints[type]}
                    </span>
                  </span>
                  {type === edgeType && (
                    <Check className="mt-0.5 h-3 w-3 shrink-0 text-[var(--color-primary)]" />
                  )}
                </Button>
              ))}
            </div>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const StageEdge = memo(StageEdgeComponent);
