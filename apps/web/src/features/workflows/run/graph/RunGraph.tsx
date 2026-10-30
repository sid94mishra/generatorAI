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
// minZoom: React Flow's default floor (0.5) cannot fit a long pipeline, so its ends were cut off (U-52).
const FIT = { padding: 0.18, maxZoom: 1.3, minZoom: 0.2 } as const;
const NODE_CENTER = { x: 140, y: 40 } as const;
/** Below this a stage card's text is unreadable: a longer pipeline opens on its focused stage instead (fit shows it all). */
const READABLE_ZOOM = 0.75;
/** The minimap earns its space only on larger graphs. */
const MINIMAP_MIN_NODES = 6;
const MINIMAP_SIZE = { width: 150, height: 90 } as const;

export interface RunGraphProps {
  /** Edges of the run's pinned graph (DAG structure). */
  definitionEdges?: EdgeSpec[] | undefined;
  /** Stages of the run's pinned graph (a loop node's exit rules). */
  definitionStages?: StageSpec[] | undefined;
  /** A node was clicked: the page focuses that stage and scrolls the stage list to it. */
  onSelectStage?: ((id: string) => void) | undefined;
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

function RunGraphCanvas({ definitionEdges, definitionStages, onSelectStage, className }: RunGraphProps) {
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
  const onNodeClick = useCallback(
    (_event: MouseEvent, node: Node) => (onSelectStage ?? selectStageRun)(node.id),
    [onSelectStage, selectStageRun],
  );

  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const selectedRef = useRef(selectedStageRunId);
  selectedRef.current = selectedStageRunId;

  // Frame the graph: all of it when it fits at a readable zoom; otherwise the focused (else the running,
  // else the first) stage at a readable zoom, kept inside the graph's extent (U-52).
  const frame = useCallback(
    (duration: number) => {
      const el = containerRef.current;
      const all = nodesRef.current;
      if (!el || all.length === 0) return;
      const xs = all.map((n) => n.position.x);
      const ys = all.map((n) => n.position.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs) + NODE_CENTER.x * 2;
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys) + NODE_CENTER.y * 2;
      const pad = 1 + FIT.padding * 2;
      const fitZoom = Math.min(el.clientWidth / ((maxX - minX) * pad), el.clientHeight / ((maxY - minY) * pad));
      if (fitZoom >= READABLE_ZOOM) {
        void reactFlow.fitView({ ...FIT, duration });
        return;
      }
      const focus =
        all.find((n) => n.id === selectedRef.current) ??
        all.find((n) => (n.data as RunGraphNodeData).stageRun.status === 'running') ??
        all[0]!;
      const halfW = el.clientWidth / 2 / READABLE_ZOOM;
      const margin = NODE_CENTER.x / 2;
      const x = Math.min(Math.max(focus.position.x + NODE_CENTER.x, minX - margin + halfW), maxX + margin - halfW);
      void reactFlow.setCenter(x, (minY + maxY) / 2, { zoom: READABLE_ZOOM, duration });
    },
    [reactFlow],
  );

  // Frame when the node count changes.
  useEffect(() => {
    if (nodes.length === 0) return;
    const timer = setTimeout(() => frame(300), 100);
    return () => clearTimeout(timer);
  }, [nodes.length, frame]);

  // Re-fit when the container resizes (the dock or the split changes) so the
  // graph never ends up stranded off-centre after a layout change.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || nodes.length === 0) return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => frame(200));
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [nodes.length, frame]);

  // Centre the focused stage.
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
          fitViewOptions={FIT}
          minZoom={FIT.minZoom}
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
