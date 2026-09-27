// ────────────────────────────────────────────────────────────────
// BuilderCanvas — the workflow builder's editable React Flow canvas
// (boards WorkflowBuilder, WorkflowLoopBuilder, WorkflowValidate,
// WorkflowAgentDraft). Render it inside a <ReactFlowProvider> (the page
// owns the provider so its header can reach the flow too).
//
// The graph lives in the builder store: nodes (`stageNode`, `loopNode` for
// containers), edges (`stageEdge`), selection, issues, undo history. The
// canvas adds: drag / zoom / connect, selection → store, drop-into-container
// on drag stop, the keyboard (useCanvasKeys), Auto-layout + fit, a fit when
// a stage is added and when an issue asks to focus a stage, the floating
// panels (Add stage + kind palette + templates, edge legend, selection bar,
// zoom bar, minimap) and the empty-canvas prompt.
// ────────────────────────────────────────────────────────────────

import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import {
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  ReactFlow,
  useReactFlow,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeTypes,
  type OnSelectionChangeParams,
} from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import type { EdgeOn, StageKind } from '@generatorai/workflow-spec';
import type { StageKindPick } from '@/blocks/workflow/StageKindPalette/StageKindPalette.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { toast } from '@/ui/primitives/Toast/Toast.js';
import { Tooltip } from '@/ui/primitives/Tooltip/Tooltip.js';
import { useSelectableAgents } from '@/hooks/agentQueries.js';
import { useWorkflowBuilderStore, type StageNodeData } from '@/stores/workflowBuilderStore.js';
import {
  absolutePosition,
  descendantIds,
  isContainerStage,
  nodeDepth,
  nodeSize,
} from '@/stores/workflowContainerLayout.js';
import { EDGE_ORDER, edgeOn } from '../model/edgeStyles.js';
import { wrapStages } from './canvasActions.js';
import { CanvasContext, type CanvasContextValue, type NodeTag } from './canvasContext.js';
import {
  CONNECTION_LINE_STYLE,
  FIT_OPTIONS,
  GRID_COLOR,
  GRID_GAP,
  MAX_ZOOM,
  MINIMAP_COLORS,
  MINIMAP_MIN_NODES,
  MINIMAP_STYLE,
  MIN_ZOOM,
  PANEL_STYLE,
  XY_THEME,
} from './canvasTheme.js';
import { AddStageControl, EdgeLegend, EmptyCanvas, SelectionBar, ZoomBar } from './CanvasPanels.js';
import { GroupNode } from './GroupNode.js';
import { StageEdge } from './StageEdge.js';
import { StageNode } from './StageNode.js';
import { useCanvasKeys } from './useCanvasKeys.js';
import { useStageTemplates } from './stageTemplates.js';
import { useTheme } from '@/providers/ThemeProvider.js';

// The type names the store gives its nodes and edges.
const nodeTypes = { stageNode: StageNode, loopNode: GroupNode } as NodeTypes;
const edgeTypes = { stageEdge: StageEdge } as EdgeTypes;
const defaultEdgeOptions = { type: 'stageEdge' };
const SNAP_GRID: [number, number] = [GRID_GAP, GRID_GAP];
const PRO_OPTIONS = { hideAttribution: true };
const NO_TAGS: Readonly<Record<string, NodeTag>> = {};

/** Delay before fitting, so React Flow has measured freshly added nodes. */
const FIT_DELAY_MS = 100;
const FIT_DELAY_NEW_STAGE_MS = 150;

export interface BuilderCanvasProps {
  /** Add a top-level stage of `kind` (agent when omitted); the page selects it. */
  onAddStage: (kind?: StageKind) => void;
  /** A stage template was spliced in; `key` is its first top-level stage. */
  onAddedTemplate: (key: string) => void;
  /** Draft diff: stage key → "added" / "changed" tag on the node. */
  nodeTags?: Readonly<Record<string, NodeTag>>;
  /** Controlled kind-palette state (default: internal; `A` and "▾" open it). */
  paletteOpen?: boolean;
  onPaletteOpenChange?: (open: boolean) => void;
}

export function BuilderCanvas({ onAddStage, onAddedTemplate, nodeTags = NO_TAGS, paletteOpen, onPaletteOpenChange }: BuilderCanvasProps) {
  const nodes = useWorkflowBuilderStore((s) => s.nodes);
  const edges = useWorkflowBuilderStore((s) => s.edges);
  const onNodesChange = useWorkflowBuilderStore((s) => s.onNodesChange);
  const onEdgesChange = useWorkflowBuilderStore((s) => s.onEdgesChange);
  const onConnect = useWorkflowBuilderStore((s) => s.onConnect);
  const selectNode = useWorkflowBuilderStore((s) => s.selectNode);
  const selectEdge = useWorkflowBuilderStore((s) => s.selectEdge);
  const autoLayout = useWorkflowBuilderStore((s) => s.autoLayout);
  const unwrapContainer = useWorkflowBuilderStore((s) => s.unwrapContainer);
  const reparentStage = useWorkflowBuilderStore((s) => s.reparentStage);
  const projectId = useWorkflowBuilderStore((s) => s.workflow.projectId);
  // The multi-selection the selection bar acts on (React Flow's `selected`).
  const selectedKeys = useWorkflowBuilderStore(useShallow((s) => s.nodes.filter((n) => n.selected).map((n) => n.id)));
  const sameScope = useWorkflowBuilderStore(
    (s) => new Set(s.nodes.filter((n) => n.selected).map((n) => n.data.stage.parentKey ?? '')).size <= 1,
  );
  const containerKey = useWorkflowBuilderStore((s) => {
    const picked = s.nodes.filter((n) => n.selected);
    const only = picked.length === 1 ? picked[0] : undefined;
    return only && isContainerStage(only.data.stage) ? only.id : null;
  });

  const flow = useReactFlow();
  // React Flow defaults to `light`, which puts the legacy `.light` token class on its wrapper.
  const { resolvedTheme } = useTheme();

  // ── Kind palette (controlled or internal) ──
  const [ownPaletteOpen, setOwnPaletteOpen] = useState(false);
  const isPaletteOpen = paletteOpen ?? ownPaletteOpen;
  const setPaletteOpen = useCallback(
    (open: boolean) => {
      if (paletteOpen === undefined) setOwnPaletteOpen(open);
      onPaletteOpenChange?.(open);
    },
    [paletteOpen, onPaletteOpenChange],
  );
  const openPalette = useCallback(() => setPaletteOpen(true), [setPaletteOpen]);
  const { templates, addTemplate } = useStageTemplates(isPaletteOpen);

  const handlePick = useCallback(
    (pick: StageKindPick<StageKind>) => {
      setPaletteOpen(false);
      if (pick.type === 'kind') {
        onAddStage(pick.kind);
        return;
      }
      const key = addTemplate(pick.id);
      if (key) onAddedTemplate(key);
    },
    [setPaletteOpen, onAddStage, addTemplate, onAddedTemplate],
  );

  useCanvasKeys(openPalette);

  // ── Selection → store ──
  const onSelectionChange = useCallback(
    ({ nodes: picked, edges: pickedEdges }: OnSelectionChangeParams) => {
      if (picked.length === 1 && picked[0]) selectNode(picked[0].id);
      else if (pickedEdges.length === 1 && pickedEdges[0]) selectEdge(pickedEdges[0].id);
      else if (picked.length === 0 && pickedEdges.length === 0) {
        selectNode(null);
        selectEdge(null);
      }
    },
    [selectNode, selectEdge],
  );

  // ── Drop into a container ──
  // A stage dropped onto a container moves into its body (the innermost
  // container under the stage's centre). Leaving one is done from the stage
  // inspector: a body stage cannot be dragged out, its container grows.
  const onNodeDragStop = useCallback(
    (_event: MouseEvent, dragged: Node) => {
      const state = useWorkflowBuilderStore.getState();
      const byId = new Map(state.nodes.map((n) => [n.id, n]));
      const node = byId.get(dragged.id);
      if (!node) return;
      const at = absolutePosition(node.id, byId);
      const size = nodeSize(node);
      const cx = at.x + size.width / 2;
      const cy = at.y + size.height / 2;
      const excluded = new Set([node.id, ...descendantIds(node.id, state.nodes)]);
      const target = state.nodes
        .filter((n) => isContainerStage(n.data.stage) && !excluded.has(n.id))
        .filter((n) => {
          const p = absolutePosition(n.id, byId);
          const s = nodeSize(n);
          return cx >= p.x && cx <= p.x + s.width && cy >= p.y && cy <= p.y + s.height;
        })
        .sort((a, b) => nodeDepth(b.id, byId) - nodeDepth(a.id, byId))[0];
      if (!target || target.id === node.parentId) return;
      const dropped = reparentStage(node.id, target.id);
      toast.info(`Moved '${node.data.stage.name}' into '${target.data.stage.name}'`, {
        ...(dropped > 0
          ? { description: `${dropped} edge${dropped === 1 ? '' : 's'} crossing the container boundary removed` }
          : {}),
      });
    },
    [reparentStage],
  );

  // ── Fit: Auto-layout, first render, a stage added, an issue focused ──
  const handleAutoLayout = useCallback(() => {
    autoLayout();
    setTimeout(() => void flow.fitView({ ...FIT_OPTIONS, duration: 300 }), FIT_DELAY_MS / 2);
  }, [autoLayout, flow]);

  const prevCount = useRef(nodes.length);
  useEffect(() => {
    if (nodes.length === 0) {
      prevCount.current = 0;
      return;
    }
    const added = nodes.length > prevCount.current;
    prevCount.current = nodes.length;
    const t = setTimeout(
      () => void flow.fitView({ ...FIT_OPTIONS, duration: added ? 400 : 300 }),
      added ? FIT_DELAY_NEW_STAGE_MS : FIT_DELAY_MS,
    );
    return () => clearTimeout(t);
  }, [nodes.length, flow]);

  const focusRequest = useWorkflowBuilderStore((s) => s.focusRequest);
  useEffect(() => {
    if (!focusRequest) return;
    const t = setTimeout(
      () => void flow.fitView({ nodes: [{ id: focusRequest.key }], padding: 0.8, maxZoom: 1.2, duration: 300 }),
      FIT_DELAY_MS / 2,
    );
    return () => clearTimeout(t);
  }, [focusRequest, flow]);

  // ── Edge hover (for the edge labels) ──
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const onEdgeMouseEnter = useCallback((_e: MouseEvent, edge: Edge) => setHoveredEdgeId(edge.id), []);
  const onEdgeMouseLeave = useCallback(() => setHoveredEdgeId(null), []);

  // ── Agent display names for the nodes ──
  const agents = useSelectableAgents(projectId ?? undefined);
  const agentNames = useMemo(() => new Map((agents.data ?? []).map((a) => [a.ref, a.name])), [agents.data]);
  const context = useMemo<CanvasContextValue>(() => ({ nodeTags, agentNames, hoveredEdgeId }), [nodeTags, agentNames, hoveredEdgeId]);

  // ── Legend: only the edge kinds this graph uses ──
  const legend = useMemo(() => {
    const present = new Set<EdgeOn>();
    let handles = false;
    for (const e of edges) {
      present.add(edgeOn(e.data?.edge.on));
      if (e.data?.edge.handlesFailure) handles = true;
    }
    return { kinds: EDGE_ORDER.filter((k) => present.has(k)), handlesFailure: handles };
  }, [edges]);

  const minimapNodeColor = useCallback((n: Node) => {
    const node = n as Node<StageNodeData>;
    if (isContainerStage(node.data.stage)) return MINIMAP_COLORS.none;
    return node.selected ? MINIMAP_COLORS.selected : MINIMAP_COLORS.node;
  }, []);
  const minimapStrokeColor = useCallback(
    (n: Node) => (isContainerStage((n as Node<StageNodeData>).data.stage) ? MINIMAP_COLORS.groupStroke : MINIMAP_COLORS.none),
    [],
  );

  return (
    <CanvasContext.Provider value={context}>
      <div className="h-full w-full bg-sunken">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onSelectionChange={onSelectionChange}
          onNodeDragStop={onNodeDragStop}
          onEdgeMouseEnter={onEdgeMouseEnter}
          onEdgeMouseLeave={onEdgeMouseLeave}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          colorMode={resolvedTheme}
          fitView
          fitViewOptions={FIT_OPTIONS}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          snapToGrid
          snapGrid={SNAP_GRID}
          connectionLineStyle={CONNECTION_LINE_STYLE}
          deleteKeyCode={null} // useCanvasKeys deletes (through the store, with undo)
          selectNodesOnDrag={false}
          proOptions={PRO_OPTIONS}
          style={XY_THEME}
        >
          <Background variant={BackgroundVariant.Dots} gap={GRID_GAP} size={1} color={GRID_COLOR} />

          <Panel position="top-left" style={PANEL_STYLE}>
            <div className="flex items-center gap-2">
              <AddStageControl
                open={isPaletteOpen}
                onOpenChange={setPaletteOpen}
                onAddDefault={() => onAddStage()}
                onPick={handlePick}
                templates={templates}
              />
              <EdgeLegend kinds={legend.kinds} handlesFailure={legend.handlesFailure} />
            </div>
          </Panel>

          <Panel position="top-right" style={PANEL_STYLE}>
            <Tooltip content="Arrange the stages (one undo step)" side="left">
              <Button size="sm" icon="layout" onClick={handleAutoLayout} disabled={nodes.length === 0}>
                Auto-layout
              </Button>
            </Tooltip>
          </Panel>

          {selectedKeys.length > 0 ? (
            <Panel position="top-center" style={PANEL_STYLE}>
              <SelectionBar
                count={selectedKeys.length}
                sameScope={sameScope}
                containerKey={containerKey}
                onWrap={(kind) => wrapStages(selectedKeys, kind)}
                onUnwrap={unwrapContainer}
              />
            </Panel>
          ) : null}

          <Panel position="bottom-left" style={PANEL_STYLE}>
            <ZoomBar />
          </Panel>

          {nodes.length >= MINIMAP_MIN_NODES ? (
            <MiniMap
              position="bottom-right"
              style={MINIMAP_STYLE}
              className="overflow-hidden rounded-card border border-line-soft"
              bgColor="var(--gai-raised)"
              nodeColor={minimapNodeColor}
              nodeStrokeColor={minimapStrokeColor}
              nodeStrokeWidth={2}
              nodeBorderRadius={3}
              maskColor={MINIMAP_COLORS.mask}
              maskStrokeColor={MINIMAP_COLORS.maskStroke}
              pannable
              zoomable
              ariaLabel="Minimap"
            />
          ) : null}

          {nodes.length === 0 ? <EmptyCanvas onAdd={() => onAddStage()} /> : null}
        </ReactFlow>
      </div>
    </CanvasContext.Provider>
  );
}
