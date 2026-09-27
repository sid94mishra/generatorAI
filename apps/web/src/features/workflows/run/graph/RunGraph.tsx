// ────────────────────────────────────────────────────────────────
// RunGraph — the run's stage graph (React Flow, view-only): the top-level
// stage instances with live status, edges from the pinned graph coloured
// by their `on` value and animated while work flows along them, and
// click-to-focus. Reads the run from stores/workflowRunStore. Mounts its
// own ReactFlowProvider, so the page needs none.
// ────────────────────────────────────────────────────────────────

import { memo, useCallback, useEffect, useMemo, useRef, type MouseEvent } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeTypes,
  type OnSelectionChangeParams,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { StageRun } from '@generatorai/shared';
import type { EdgeSpec, StageSpec } from '@generatorai/workflow-spec';
import { useTheme } from '@/providers/ThemeProvider.js';
import { useWorkflowRunStore } from '@/stores/workflowRunStore.js';
import { getLayoutedElements } from '@/utils/dagLayout.js';
import { cn } from '@/ui/lib/cn.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { deriveLoopView } from '../model/loopView.js';
import { flowThemeVars, GraphColorsContext, stageStatusColor, useResolvedGraphColors } from './graphColors.js';
import { RunGraphEdge, edgeLook, type RunGraphEdgeData } from './RunGraphEdge.js';
import { RunGraphNode, type RunGraphNodeData } from './RunGraphNode.js';

const nodeTypes = { runGraphNode: RunGraphNode } as NodeTypes;
const edgeTypes = { runGraphEdge: RunGraphEdge } as EdgeTypes;

/** Fit padding / zoom cap, and the centre offset of a node (half its card). */
const FIT = { padding: 0.18, maxZoom: 1.3 } as const;
const NODE_CENTER = { x: 140, y: 40 } as const;
/** The minimap earns its space only on larger graphs. */
const MINIMAP_MIN_NODES = 6;
const MINIMAP_SIZE = { width: 150, height: 90 } as const;

export interface RunGraphProps {
  /** Edges of the run's pinned graph (DAG structure). */
  definitionEdges?: EdgeSpec[] | undefined;
  /** Stages of the run's pinned graph (a loop node's exit rules). */
  definitionStages?: StageSpec[] | undefined;
  className?: string;
}

function stageRunToNode(sr: StageRun, position: { x: number; y: number }, isSelected: boolean, def?: StageSpec): Node<RunGraphNodeData> {
  const loop = deriveLoopView(sr, def);
  return {
    id: sr.id,
    type: 'runGraphNode',
    position,
    data: { stageRun: sr, label: sr.name, isSelected, ...(loop ? { loop } : {}) },
    selectable: true,
    draggable: false,
  };
}

function RunGraphCanvas({ definitionEdges, definitionStages, className }: RunGraphProps) {
  const { resolvedTheme } = useTheme();
  const colors = useResolvedGraphColors();
  const run = useWorkflowRunStore((s) => s.run);
  const selectedStageRunId = useWorkflowRunStore((s) => s.selectedStageRunId);
  const selectStageRun = useWorkflowRunStore((s) => s.selectStageRun);
  const reactFlow = useReactFlow();
  const containerRef = useRef<HTMLDivElement>(null);

  const { nodes, edges } = useMemo(() => {
    if (!run) return { nodes: [], edges: [] };

    // The graph is the top level: a loop's body instances (every iteration)
    // live inside its node on the timeline, not as nodes of their own.
    const topLevel = run.stageRuns.filter((sr) => !sr.scopeId && !/#(\d+|wrapup)\//.test(sr.instancePath));
    const defByKey = new Map((definitionStages ?? []).map((d) => [d.key, d]));
    const rawNodes = topLevel.map((sr, index) =>
      // Positions are placeholders: the auto-layout below places every node.
      stageRunToNode(sr, { x: index * 320, y: 100 }, sr.id === selectedStageRunId, defByKey.get(sr.stageKey)),
    );

    const byKey = new Map(topLevel.map((sr) => [sr.stageKey, sr]));
    const edge = (from: StageRun, to: StageRun, edgeType: string): Edge<RunGraphEdgeData> => ({
      id: `e-${from.id}-${to.id}`,
      source: from.id,
      target: to.id,
      type: 'runGraphEdge',
      animated: edgeLook(colors, from.status, to.status, edgeType).animated,
      data: { edgeType, sourceStatus: from.status, targetStatus: to.status },
    });

    const rawEdges: Edge<RunGraphEdgeData>[] = [];
    if (definitionEdges && definitionEdges.length > 0) {
      // The pinned graph's structure, mapped from stage keys to instances.
      for (const defEdge of definitionEdges) {
        const from = byKey.get(defEdge.from);
        const to = byKey.get(defEdge.to);
        if (from && to) rawEdges.push(edge(from, to, defEdge.on));
      }
    } else {
      // No pinned edges: the instances in order.
      for (let i = 0; i < topLevel.length - 1; i++) rawEdges.push(edge(topLevel[i]!, topLevel[i + 1]!, 'sequential'));
    }

    return rawNodes.length > 0 ? getLayoutedElements(rawNodes, rawEdges, 'LR') : { nodes: rawNodes, edges: rawEdges };
  }, [run, selectedStageRunId, definitionEdges, definitionStages, colors]);

  const onSelectionChange = useCallback(
    (params: OnSelectionChangeParams) => {
      if (params.nodes.length === 1) selectStageRun(params.nodes[0]!.id);
    },
    [selectStageRun],
  );
  // A click is more reliable than a selection change for a single click.
  const onNodeClick = useCallback((_event: MouseEvent, node: Node) => selectStageRun(node.id), [selectStageRun]);

  // Fit when the node count changes.
  useEffect(() => {
    if (nodes.length === 0) return;
    const timer = setTimeout(() => void reactFlow.fitView({ ...FIT, duration: 300 }), 100);
    return () => clearTimeout(timer);
  }, [nodes.length, reactFlow]);

  // Re-fit when the container resizes (the dock or the split changes) so the
  // graph never ends up stranded off-centre after a layout change.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || nodes.length === 0) return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => void reactFlow.fitView({ ...FIT, duration: 200 }));
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [nodes.length, reactFlow]);

  // Centre the focused stage.
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  useEffect(() => {
    if (!selectedStageRunId) return;
    const node = nodesRef.current.find((n) => n.id === selectedStageRunId);
    if (node) {
      void reactFlow.setCenter(node.position.x + NODE_CENTER.x, node.position.y + NODE_CENTER.y, {
        duration: 300,
        zoom: reactFlow.getZoom(),
      });
    }
  }, [selectedStageRunId, reactFlow]);

  const minimapNodeColor = useCallback(
    (node: Node) => stageStatusColor(colors, (node.data as RunGraphNodeData | undefined)?.stageRun?.status),
    [colors],
  );
  const themeVars = useMemo(() => flowThemeVars(colors), [colors]);

  if (!run) {
    return <EmptyState icon="workflows" title="No run data" className={cn('h-full', className)} />;
  }

  return (
    <GraphColorsContext.Provider value={colors}>
      <div ref={containerRef} className={cn('h-full w-full bg-ground', className)} style={themeVars}>
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
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color={colors.line} />
          <Controls showInteractive={false} />
          {nodes.length > MINIMAP_MIN_NODES ? (
            <MiniMap
              position="bottom-right"
              nodeColor={minimapNodeColor}
              bgColor={colors.surface}
              maskColor={colors.hover}
              pannable
              zoomable
              className="overflow-hidden rounded-card border border-line-soft"
              style={MINIMAP_SIZE}
            />
          ) : null}
        </ReactFlow>
      </div>
    </GraphColorsContext.Provider>
  );
}

const RunGraphInner = memo(RunGraphCanvas);

/** The run's stage graph, with its own ReactFlowProvider. */
export function RunGraph(props: RunGraphProps) {
  return (
    <ReactFlowProvider>
      <RunGraphInner {...props} />
    </ReactFlowProvider>
  );
}
