// ────────────────────────────────────────────────────────────────
// RuntimeDAGCanvas — React Flow canvas in runtime (view-only) mode
// Shows stages with live runtime status, animated edges, progress
// bars, and click-to-select-stage interaction
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useMemo, useEffect, useRef, memo } from 'react';
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  useReactFlow,
  type NodeTypes,
  type EdgeTypes,
  type OnSelectionChangeParams,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { RuntimeStageNode } from './RuntimeStageNode.js';
import { RuntimeStageEdge } from './RuntimeStageEdge.js';
import { useWorkflowRunStore } from '@/stores/workflowRunStore.js';
import { getLayoutedElements } from '@/utils/dagLayout.js';
import { cn } from '@/lib/utils.js';
import { useTheme } from '@/providers/ThemeProvider.js';
import type { Node, Edge } from '@xyflow/react';
import type { StageRun, StageRunStatus, StageEdge } from '@generatorai/shared';

// ── Node/Edge data types ──

export interface RuntimeStageNodeData extends Record<string, unknown> {
  stageRun: StageRun;
  label: string;
  isSelected: boolean;
}

export interface RuntimeStageEdgeData extends Record<string, unknown> {
  edgeType: string;
  sourceStatus: StageRunStatus;
  targetStatus: StageRunStatus;
}

// ── Node/Edge type registration ──

const nodeTypes = {
  runtimeStageNode: RuntimeStageNode,
} as NodeTypes;

const edgeTypes = {
  runtimeStageEdge: RuntimeStageEdge,
} as EdgeTypes;

// ── Helper: Convert StageRun to React Flow Node ──

function stageRunToNode(
  sr: StageRun,
  position: { x: number; y: number },
  isSelected: boolean,
): Node<RuntimeStageNodeData> {
  return {
    id: sr.id,
    type: 'runtimeStageNode',
    position,
    data: {
      stageRun: sr,
      label: sr.name,
      isSelected,
    },
    selectable: true,
    draggable: false,
  };
}

// ── Main Component ──

interface RuntimeDAGCanvasProps {
  /** Definition-time edges for DAG structure */
  definitionEdges?: StageEdge[];
  className?: string;
}

function RuntimeDAGCanvasComponent({ definitionEdges, className }: RuntimeDAGCanvasProps) {
  const { resolvedTheme } = useTheme();
  const run = useWorkflowRunStore((s) => s.run);
  const selectedStageRunId = useWorkflowRunStore((s) => s.selectedStageRunId);
  const selectStageRun = useWorkflowRunStore((s) => s.selectStageRun);
  const reactFlowInstance = useReactFlow();
  const containerRef = useRef<HTMLDivElement>(null);

  // Build nodes from stage runs
  const { nodes, edges } = useMemo(() => {
    if (!run) return { nodes: [], edges: [] };

    // Create nodes from stage runs
    const rawNodes: Node<RuntimeStageNodeData>[] = run.stageRuns.map((sr, index) => {
      return stageRunToNode(
        sr,
        { x: index * 320, y: 100 }, // Will be auto-layouted
        sr.id === selectedStageRunId,
      );
    });

    // Build a stageDefinitionId → stageRunId map for edge creation
    const defToRunId = new Map<string, string>();
    const stageRunByDefId = new Map<string, StageRun>();
    for (const sr of run.stageRuns) {
      defToRunId.set(sr.stageDefinitionId, sr.id);
      stageRunByDefId.set(sr.stageDefinitionId, sr);
    }

    // Build edges from definition edges (mapping definition IDs → runtime IDs)
    const rawEdges: Edge<RuntimeStageEdgeData>[] = [];

    if (definitionEdges && definitionEdges.length > 0) {
      // Use the actual DAG structure from the workflow definition
      for (const defEdge of definitionEdges) {
        const sourceRunId = defToRunId.get(defEdge.fromStageId);
        const targetRunId = defToRunId.get(defEdge.toStageId);
        if (sourceRunId && targetRunId) {
          const sourceStage = stageRunByDefId.get(defEdge.fromStageId);
          const targetStage = stageRunByDefId.get(defEdge.toStageId);
          rawEdges.push({
            id: `e-${sourceRunId}-${targetRunId}`,
            source: sourceRunId,
            target: targetRunId,
            type: 'runtimeStageEdge',
            data: {
              edgeType: defEdge.edgeType,
              sourceStatus: sourceStage?.status ?? 'pending',
              targetStatus: targetStage?.status ?? 'pending',
            },
          });
        }
      }
    } else if (run.stageRuns.length > 1) {
      // Fallback: sequential edges based on stage order
      for (let i = 0; i < run.stageRuns.length - 1; i++) {
        const from = run.stageRuns[i]!;
        const to = run.stageRuns[i + 1]!;
        rawEdges.push({
          id: `e-${from.id}-${to.id}`,
          source: from.id,
          target: to.id,
          type: 'runtimeStageEdge',
          data: {
            edgeType: 'sequential',
            sourceStatus: from.status,
            targetStatus: to.status,
          },
        });
      }
    }

    // Apply auto-layout
    if (rawNodes.length > 0) {
      const layouted = getLayoutedElements(rawNodes, rawEdges, 'LR');
      return layouted;
    }

    return { nodes: rawNodes, edges: rawEdges };
  }, [run, selectedStageRunId, definitionEdges]);

  // Handle node selection
  const onSelectionChange = useCallback(
    (params: OnSelectionChangeParams) => {
      if (params.nodes.length === 1) {
        selectStageRun(params.nodes[0]!.id);
      }
    },
    [selectStageRun],
  );

  // Handle node click (more reliable than selection change for single clicks)
  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      selectStageRun(node.id);
    },
    [selectStageRun],
  );

  // Fit view when nodes change
  useEffect(() => {
    if (nodes.length > 0) {
      setTimeout(() => {
        reactFlowInstance.fitView({ padding: 0.18, maxZoom: 1.3, duration: 300 });
      }, 100);
    }
  }, [nodes.length]);

  // Re-fit when the container resizes (e.g., the run panel split changes) so
  // the graph never ends up stranded low/off-center after a layout change.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || nodes.length === 0) return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        reactFlowInstance.fitView({ padding: 0.18, maxZoom: 1.3, duration: 200 });
      });
    });
    ro.observe(el);
    return () => { ro.disconnect(); cancelAnimationFrame(raf); };
  }, [nodes.length, reactFlowInstance]);

  // Auto-scroll to running stage
  useEffect(() => {
    if (!selectedStageRunId) return;
    const node = nodes.find((n) => n.id === selectedStageRunId);
    if (node) {
      reactFlowInstance.setCenter(
        node.position.x + 140,
        node.position.y + 40,
        { duration: 300, zoom: reactFlowInstance.getZoom() },
      );
    }
  }, [selectedStageRunId]);

  // Minimap node color
  const minimapNodeColor = useCallback(
    (node: Node) => {
      const data = node.data as RuntimeStageNodeData;
      const status = data?.stageRun?.status;
      switch (status) {
        case 'completed': return '#22c55e';
        case 'running': return '#3b82f6';
        case 'failed': return '#ef4444';
        case 'paused': return '#f59e0b';
        case 'cancelled': return '#6b7280';
        case 'skipped': return '#9ca3af';
        case 'queued': return '#60a5fa';
        default: return '#d1d5db';
      }
    },
    [],
  );

  if (!run) {
    return (
      <div className={cn('flex items-center justify-center', className)}>
        <p className="text-sm text-[var(--color-muted-foreground)]">No run data</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={cn('h-full w-full', className)}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onSelectionChange={onSelectionChange}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        panOnDrag
        zoomOnScroll
        deleteKeyCode={null}
        selectNodesOnDrag={false}
        proOptions={{ hideAttribution: true }}
        colorMode={resolvedTheme}
        className="bg-[var(--color-background)]"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--color-border)" />
        <Controls
          showInteractive={false}
          className="[&>button]:!border-[var(--color-border)] [&>button]:!bg-[var(--color-background)] [&>button]:!fill-[var(--color-foreground)] [&>button:hover]:!bg-[var(--color-accent)]"
        />
        {/* Minimap only earns its space on larger graphs; themed surface (no white box) */}
        {nodes.length > 6 && (
          <MiniMap
            position="bottom-right"
            nodeColor={minimapNodeColor}
            maskColor="color-mix(in srgb, var(--color-foreground) 8%, transparent)"
            pannable
            zoomable
            className="!rounded-lg !border !border-[var(--color-border)] !bg-[var(--color-card)] !shadow-sm !m-3"
            style={{ width: 150, height: 90 }}
          />
        )}
      </ReactFlow>
    </div>
  );
}

export const RuntimeDAGCanvas = memo(RuntimeDAGCanvasComponent);
