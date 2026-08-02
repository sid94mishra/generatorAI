// ────────────────────────────────────────────────────────────────
// DAGCanvas — React Flow canvas wrapper for workflow DAG
// Renders stages as nodes, edges as connections, with full
// interaction: drag, zoom, connect, keyboard shortcuts
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useMemo, useRef, useEffect } from 'react';
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  useReactFlow,
  Panel,
  type NodeTypes,
  type EdgeTypes,
  type OnSelectionChangeParams,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { StageNode } from './StageNode.js';
import { StageEdge } from './StageEdge.js';
import { EDGE_TYPE_ORDER, EDGE_TYPE_COLORS, EDGE_TYPE_LABELS, DEFAULT_EDGE_TYPE, type StageEdgeType } from './edgeTypeStyles.js';
import { useWorkflowBuilderStore, type StageNodeData, type StageEdgeData } from '@/stores/workflowBuilderStore.js';
import { getLayoutedElements } from '@/utils/dagLayout.js';
import { AlignHorizontalDistributeCenter, Plus, GitBranch } from 'lucide-react';
import { Tooltip } from '@/components/Tooltip.js';
import { cn } from '@/lib/utils.js';
import { useTheme } from '@/providers/ThemeProvider.js';
import type { Node, Edge } from '@xyflow/react';

const nodeTypes = {
  stageNode: StageNode,
} as NodeTypes;

const edgeTypes = {
  stageEdge: StageEdge,
} as EdgeTypes;

// Default edge style
const defaultEdgeOptions = {
  type: 'stageEdge',
  animated: true,
};

interface DAGCanvasProps {
  readonly?: boolean;
  onAddStage?: () => void;
}

export function DAGCanvas({ readonly, onAddStage }: DAGCanvasProps) {
  const { resolvedTheme } = useTheme();
  const nodes = useWorkflowBuilderStore((s) => s.nodes);
  const edges = useWorkflowBuilderStore((s) => s.edges);
  const onNodesChange = useWorkflowBuilderStore((s) => s.onNodesChange);
  const onEdgesChange = useWorkflowBuilderStore((s) => s.onEdgesChange);
  const onConnect = useWorkflowBuilderStore((s) => s.onConnect);
  const selectNode = useWorkflowBuilderStore((s) => s.selectNode);
  const selectEdge = useWorkflowBuilderStore((s) => s.selectEdge);
  const removeStage = useWorkflowBuilderStore((s) => s.removeStage);
  const removeEdge = useWorkflowBuilderStore((s) => s.removeEdge);
  const undo = useWorkflowBuilderStore((s) => s.undo);
  const redo = useWorkflowBuilderStore((s) => s.redo);
  const setNodes = useWorkflowBuilderStore((s) => s.setNodes);
  const setEdges = useWorkflowBuilderStore((s) => s.setEdges);
  const selectedNodeId = useWorkflowBuilderStore((s) => s.selectedNodeId);

  const reactFlowInstance = useReactFlow();
  const containerRef = useRef<HTMLDivElement>(null);

  // Handle selection changes
  const onSelectionChange = useCallback(
    (params: OnSelectionChangeParams) => {
      const selectedNodes = params.nodes;
      const selectedEdges = params.edges;
      if (selectedNodes.length === 1 && selectedNodes[0]) {
        selectNode(selectedNodes[0].id);
      } else if (selectedEdges.length === 1 && selectedEdges[0]) {
        selectEdge(selectedEdges[0].id);
      } else if (selectedNodes.length === 0 && selectedEdges.length === 0) {
        selectNode(null);
        selectEdge(null);
      }
    },
    [selectNode, selectEdge],
  );

  // Auto-layout handler
  const handleAutoLayout = useCallback(() => {
    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      nodes,
      edges,
      'LR',
    );
    setNodes(layoutedNodes as typeof nodes);
    setEdges(layoutedEdges as typeof edges);
    setTimeout(() => {
      reactFlowInstance.fitView({ padding: 0.18, maxZoom: 1.3, duration: 300 });
    }, 50);
  }, [nodes, edges, setNodes, setEdges, reactFlowInstance]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (readonly) return;

      // Don't intercept if typing in an input
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) {
        return;
      }

      // Delete key — remove selected node or edge
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const state = useWorkflowBuilderStore.getState();
        if (state.selectedNodeId) {
          removeStage(state.selectedNodeId);
        } else if (state.selectedEdgeId) {
          removeEdge(state.selectedEdgeId);
        }
      }

      // Ctrl+Z — Undo
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        undo();
      }

      // Ctrl+Shift+Z — Redo
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z') {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [readonly, removeStage, removeEdge, undo, redo]);

  // Fit to view on initial render and when nodes change (e.g., add stage)
  const prevNodeCountRef = useRef(nodes.length);
  useEffect(() => {
    if (nodes.length > 0) {
      // Fit on initial render or when a stage is added
      const isNewStage = nodes.length > prevNodeCountRef.current;
      prevNodeCountRef.current = nodes.length;
      setTimeout(() => {
        reactFlowInstance.fitView({ padding: 0.18, maxZoom: 1.3, duration: isNewStage ? 400 : 300 });
      }, isNewStage ? 150 : 100);
    }
  }, [nodes.length]);

  // Minimap node color
  const minimapNodeColor = useCallback((node: Node) => {
    if (node.id === selectedNodeId) return 'var(--color-primary)';
    return 'var(--color-muted-foreground)';
  }, [selectedNodeId]);

  // Legend entries — derived from the edge types this graph actually uses so
  // the swatches never advertise a condition that isn't on the canvas.
  const legendEntries = useMemo(() => {
    const present = new Set<StageEdgeType>();
    for (const edge of edges) {
      const type = (edge.data?.edgeType as StageEdgeType | undefined) ?? DEFAULT_EDGE_TYPE;
      if (type in EDGE_TYPE_COLORS) present.add(type);
    }
    return EDGE_TYPE_ORDER.filter((t) => present.has(t)).map((type) => ({
      type,
      label: EDGE_TYPE_LABELS[type],
      color: EDGE_TYPE_COLORS[type],
    }));
  }, [edges]);

  return (
    <div ref={containerRef} className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={readonly ? undefined : onNodesChange}
        onEdgesChange={readonly ? undefined : onEdgesChange}
        onConnect={readonly ? undefined : onConnect}
        onSelectionChange={onSelectionChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        fitView
        fitViewOptions={{ padding: 0.18, maxZoom: 1.3 }}
        minZoom={0.2}
        maxZoom={1.5}
        snapToGrid
        snapGrid={[20, 20]}
        connectionLineStyle={{ stroke: 'var(--color-primary)', strokeWidth: 2 }}
        nodesDraggable={!readonly}
        nodesConnectable={!readonly}
        elementsSelectable
        deleteKeyCode={null} // We handle delete ourselves
        selectNodesOnDrag={false}
        proOptions={{ hideAttribution: true }}
        colorMode={resolvedTheme}
        className="bg-[var(--color-background)]"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--color-border)" />

        {/* Edge-type legend — lists only the conditions this graph actually
            uses, so the swatches always describe something on screen. */}
        {legendEntries.length > 0 && (
          <Panel position="top-left">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)]/90 px-2.5 py-1.5 text-[10px] text-[var(--color-muted-foreground)] shadow-sm backdrop-blur-sm">
              {legendEntries.map((e) => (
                <span key={e.type} className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: e.color }} />
                  {e.label}
                </span>
              ))}
            </div>
          </Panel>
        )}
        <Controls
          showInteractive={!readonly}
          position="bottom-left"
          className={cn(
            '[&>button]:!rounded-lg',
            '[&>button]:!border [&>button]:!border-[var(--color-border)]',
            '[&>button]:!bg-[var(--color-card)]',
            '[&>button]:!fill-[var(--color-foreground)]',
            '[&>button]:!shadow-sm',
            '[&>button:hover]:!bg-[var(--color-accent)]',
            '[&>button]:!transition-all [&>button]:!duration-150',
            '!bg-transparent !border-none !shadow-none',
            '!gap-1.5 !p-0 !m-3',
          )}
        />
        {/* Minimap only earns its space on larger graphs — clutter for small DAGs */}
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

        {/* Auto-layout button */}
        {!readonly && (
          <Panel position="top-right">
            <Tooltip content="Auto-layout (arrange nodes)" side="left">
              <button
                onClick={handleAutoLayout}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-1.5 text-sm font-medium text-[var(--color-foreground)] shadow-sm transition-colors hover:bg-[var(--color-accent)]"
              >
                <AlignHorizontalDistributeCenter className="h-4 w-4" />
                Auto-Layout
              </button>
            </Tooltip>
          </Panel>
        )}

        {/* Add Stage button — bottom-center, no overlap with controls */}
        {!readonly && onAddStage && (
          <Panel position="bottom-center">
            <button
              onClick={onAddStage}
              className={cn(
                'mb-3 flex items-center gap-2 rounded-full',
                'px-5 py-2.5 text-sm font-medium',
                'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]',
                'shadow-[0_4px_14px_rgba(79,70,229,0.25)]',
                'transition-all duration-200 ease-out',
                'hover:shadow-[0_8px_25px_rgba(79,70,229,0.35)] hover:scale-[1.03]',
                'active:scale-[0.97]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2',
              )}
              title="Add new stage"
            >
              <Plus className="h-4 w-4" />
              Add Stage
            </button>
          </Panel>
        )}

        {/* Empty state */}
        {nodes.length === 0 && (
          <Panel position="top-center">
            <div className="mt-20 rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-card)]/95 px-10 py-8 text-center shadow-sm">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--color-primary)]/10">
                <GitBranch className="h-6 w-6 text-[var(--color-primary)]" />
              </div>
              <h3 className="text-sm font-semibold text-[var(--color-foreground)]">
                Start building your workflow
              </h3>
              <p className="mt-1.5 text-xs text-[var(--color-muted-foreground)] max-w-[240px]">
                Click "Add Stage" below to create your first workflow stage, or drag from the sidebar
              </p>
              {onAddStage && (
                <button
                  onClick={onAddStage}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-primary-foreground)] shadow-sm transition-all hover:shadow-md active:scale-[0.97]"
                >
                  <Plus className="h-4 w-4" />
                  Add First Stage
                </button>
              )}
            </div>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}
