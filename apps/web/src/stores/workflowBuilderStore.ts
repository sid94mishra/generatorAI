// ────────────────────────────────────────────────────────────────
// Workflow Builder Store — Zustand design-time state for one
// `WorkflowGraph` (the v2 document).
//
// Stages are identified by their key: a node's id IS the stage key and an
// edge's id is `<from>-><to>` (the document allows one edge per pair), so
// nothing the builder holds is a local id that has to be remapped on save.
// Save replaces the whole graph (`PUT /workflow-definitions/:id/graph`),
// which is why clearing a field here (setting it to `undefined`) deletes the
// key rather than leaving the stored value in place.
// ────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import type { Node, Edge, Connection } from '@xyflow/react';
import { applyNodeChanges, applyEdgeChanges } from '@xyflow/react';
import type { NodeChange, EdgeChange } from '@xyflow/react';
import {
  ENGINE_LEVEL,
  LifecycleSchema,
  STAGE_KEY_PATTERN,
  WORKFLOW_FORMAT_VERSION,
  validateWorkflow,
  type AgentStage,
  type DefinitionStatus,
  type StageSpec,
  type EdgeSpec,
  type ValidationIssue,
  type WorkflowDefinitionRecord,
  type WorkflowGraph,
  type WorkflowSpec,
} from '@generatorai/workflow-spec';
import { getLayoutedElements } from '@/utils/dagLayout.js';
import { globalSingleton } from '../lib/globalSingleton.js';

// ── Types ──

/** A property edit of a stage: any field of its kind (`undefined` deletes the field). */
export type StageUpdate = { [K in keyof AgentStage | keyof Extract<StageSpec, { kind: 'loop' }> | keyof Extract<StageSpec, { kind: 'check' }>]?: unknown };

export interface StageNodeData extends Record<string, unknown> {
  stage: StageSpec;
  label: string;
}

export interface StageEdgeData extends Record<string, unknown> {
  edge: EdgeSpec;
}

/**
 * A validation issue located in the builder: `stageKey`/`edgeId` name the
 * node or edge it belongs to and `field` is the JSON pointer relative to that
 * stage or edge (`/prompts/0/text`), so the stage panel can show it next to
 * the control that edits the field.
 */
export interface BuilderIssue extends ValidationIssue {
  edgeId?: string;
  field?: string;
}

interface HistoryEntry {
  nodes: Node<StageNodeData>[];
  edges: Edge<StageEdgeData>[];
}

/** What a save produced, as far as the store cares. */
type DefinitionMeta = Pick<
  WorkflowDefinitionRecord,
  'id' | 'revision' | 'status' | 'currentVersionId' | 'hasUnpublishedChanges' | 'needsAttention'
>;

interface WorkflowBuilderState {
  // ── Definition bookkeeping ──
  definitionId: string | null;
  /** The revision the local graph was loaded from; `saveGraph` needs it. */
  revision: number | null;
  status: DefinitionStatus | null;
  currentVersionId: string | null;
  hasUnpublishedChanges: boolean;
  needsAttention: string[];

  // ── Document ──
  /** `graph.workflow`: every workflow-level setting. */
  workflow: WorkflowSpec;

  // ── Canvas state (graph.stages / graph.edges) ──
  nodes: Node<StageNodeData>[];
  edges: Edge<StageEdgeData>[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;

  // ── State tracking ──
  isDirty: boolean;
  isSaving: boolean;
  issues: BuilderIssue[];
  lastSavedAt: Date | null;

  // ── Undo/Redo ──
  history: HistoryEntry[];
  historyIndex: number;

  // ── Actions: Initialize ──
  loadRecord: (record: WorkflowDefinitionRecord) => void;
  resetBuilder: () => void;
  /** Adopt a save/publish result. Stays dirty when the graph changed since `savedGraph` was taken. */
  applySaved: (record: DefinitionMeta, savedGraph?: WorkflowGraph) => void;

  // ── Actions: Document ──
  toGraph: () => WorkflowGraph;

  // ── Actions: Canvas ──
  onNodesChange: (changes: NodeChange<Node<StageNodeData>>[]) => void;
  onEdgesChange: (changes: EdgeChange<Edge<StageEdgeData>>[]) => void;
  onConnect: (connection: Connection) => void;
  /** Dagre layout of the whole graph, recorded as one undo step. */
  autoLayout: () => void;

  // ── Actions: Stages ──
  /** Add a stage with a generated name and key; returns the key. */
  addStage: (name?: string) => string;
  updateStage: (key: string, updates: StageUpdate) => void;
  /** Rename a stage key, updating its edges and context sources. Returns an error message or null. */
  renameStageKey: (key: string, nextKey: string) => string | null;
  removeStage: (key: string) => void;
  duplicateStage: (key: string) => void;

  // ── Actions: Edges ──
  removeEdge: (edgeId: string) => void;
  updateEdge: (edgeId: string, updates: Partial<EdgeSpec>) => void;

  // ── Actions: Selection ──
  selectNode: (nodeId: string | null) => void;
  selectEdge: (edgeId: string | null) => void;

  // ── Actions: Workflow settings ──
  updateWorkflow: (updates: Partial<WorkflowSpec>) => void;
  setName: (name: string) => void;
  setProjectId: (projectId: string | null) => void;
  setCodebaseAliases: (aliases: string[]) => void;
  setPostProcessing: (flag: 'autoCommit' | 'autoPush' | 'autoCreatePR', value: boolean) => void;

  // ── Actions: State ──
  markDirty: () => void;
  markSaving: (saving: boolean) => void;
  /** Locate issues (from the client validator or a 422) against `graph`, the document they describe. */
  setIssues: (issues: ValidationIssue[], graph: WorkflowGraph) => void;

  // ── Actions: Undo/Redo ──
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  /**
   * Snapshot the current nodes/edges onto the undo stack.
   *
   * `coalesceKey` folds a burst of related edits into a single entry: while
   * the same key keeps arriving inside COALESCE_WINDOW_MS the top entry is
   * *replaced* rather than appended, so typing a stage name produces one
   * undo step instead of one per keystroke.
   */
  pushHistory: (coalesceKey?: string) => void;

  // ── Actions: Validation ──
  /** Run `validateWorkflow` on the current graph and store the located issues. */
  validate: () => BuilderIssue[];

  // ── Selectors ──
  getSelectedStage: () => StageSpec | null;
}

// ── Helpers ──

export function edgeId(from: string, to: string): string {
  return `${from}->${to}`;
}

/** A blank workflow document (`WorkflowSpec` with its defaults). */
export function emptyWorkflow(): WorkflowSpec {
  return {
    name: '',
    session: {},
    variables: [],
    hooks: [],
    lifecycle: LifecycleSchema.parse({}),
    tags: [],
  };
}

/** A new agent stage in parsed form (every zod default present). */
export function newAgentStage(key: string, name: string): AgentStage {
  return {
    kind: 'agent',
    key,
    name,
    join: { mode: 'all' },
    prompts: [],
    sessionReuse: 'fresh',
    context: { mode: 'summary' },
    output: { format: 'text', extraction: 'auto', rules: [] },
    hooks: [],
  };
}

/**
 * The stage key for a display name: lower snake case, starting with a
 * letter, at most 48 characters, deduplicated against `taken` with `_2`,
 * `_3`, … (the suffix is kept inside the length limit).
 */
export function stageKeyFor(name: string, taken: ReadonlySet<string>): string {
  let base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!/^[a-z]/.test(base)) base = `stage${base ? `_${base}` : ''}`;
  base = base.slice(0, 48).replace(/_+$/, '');
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `_${n}`;
    const candidate = `${base.slice(0, 48 - suffix.length).replace(/_+$/, '')}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Assign `updates` onto `target`, deleting every key whose new value is `undefined`. */
function patch<T extends object>(target: T, updates: Partial<T>): T {
  const next = { ...target, ...updates } as Record<string, unknown>;
  for (const [k, v] of Object.entries(updates)) {
    if (v === undefined) delete next[k];
  }
  return next as T;
}

function stageToNode(stage: StageSpec, position: { x: number; y: number }): Node<StageNodeData> {
  return {
    id: stage.key,
    type: 'stageNode',
    position,
    data: { stage, label: stage.name },
  };
}

function edgeToFlowEdge(edge: EdgeSpec): Edge<StageEdgeData> {
  return {
    id: edgeId(edge.from, edge.to),
    source: edge.from,
    target: edge.to,
    type: 'stageEdge',
    data: { edge },
    animated: true,
  };
}

// ── Helper: Detect cycles (Kahn's algorithm) ──
function detectCycles(nodes: Node[], edges: Edge[]): boolean {
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjList.set(node.id, []);
  }

  for (const edge of edges) {
    adjList.get(edge.source)?.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const queue = [...inDegree.entries()]
    .filter(([, deg]) => deg === 0)
    .map(([id]) => id);

  let visited = 0;
  while (queue.length > 0) {
    const node = queue.shift()!;
    visited++;
    for (const neighbor of adjList.get(node) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  return visited !== nodes.length;
}

/** Nodes and edges for a graph: stored positions when every stage has one, dagre otherwise. */
function canvasFromGraph(graph: WorkflowGraph): { nodes: Node<StageNodeData>[]; edges: Edge<StageEdgeData>[] } {
  const rawNodes = graph.stages.map((stage, i) => stageToNode(stage, stage.position ?? { x: i * 320, y: 100 }));
  const rawEdges = graph.edges.map(edgeToFlowEdge);
  const allPositioned = graph.stages.every((s) => s.position !== undefined);
  if (allPositioned || rawNodes.length === 0) return { nodes: rawNodes, edges: rawEdges };
  return getLayoutedElements(rawNodes, rawEdges, 'LR');
}

/** Locate raw issues against the graph they were computed for. */
function locateIssues(issues: ValidationIssue[], graph: WorkflowGraph): BuilderIssue[] {
  return issues.map((issue) => {
    const stage = /^\/stages\/(\d+)(\/.*)?$/.exec(issue.path);
    if (stage) {
      const key = issue.stageKey ?? graph.stages[Number(stage[1])]?.key;
      return { ...issue, ...(key ? { stageKey: key } : {}), field: stage[2] ?? '' };
    }
    const edge = /^\/edges\/(\d+)(\/.*)?$/.exec(issue.path);
    if (edge) {
      const e = graph.edges[Number(edge[1])];
      return { ...issue, ...(e ? { edgeId: edgeId(e.from, e.to) } : {}), field: edge[2] ?? '' };
    }
    return { ...issue };
  });
}

const MAX_HISTORY = 50;

/**
 * How long a coalescing key stays "hot". Consecutive edits carrying the same
 * key inside this window collapse into one undo step.
 */
const COALESCE_WINDOW_MS = 700;

/** Module-level because these are transient input state, not rendered state. */
let coalesceKey: string | null = null;
let coalesceAt = 0;

function blankState() {
  return {
    definitionId: null,
    revision: null,
    status: null,
    currentVersionId: null,
    hasUnpublishedChanges: false,
    needsAttention: [] as string[],
    workflow: emptyWorkflow(),
    nodes: [] as Node<StageNodeData>[],
    edges: [] as Edge<StageEdgeData>[],
    selectedNodeId: null,
    selectedEdgeId: null,
    isDirty: false,
    isSaving: false,
    issues: [] as BuilderIssue[],
    lastSavedAt: null,
    // Seed the empty canvas as entry 0. Without it `historyIndex` starts at
    // -1, the first add lands at index 0, and `canUndo()` (index > 0) stays
    // false — so the very first stage you add to a NEW workflow could never
    // be undone.
    history: [{ nodes: [], edges: [] }] as HistoryEntry[],
    historyIndex: 0,
  };
}

const useWorkflowBuilderStoreImpl = create<WorkflowBuilderState>((set, get) => ({
  ...blankState(),

  // ── Initialize ──
  loadRecord: (record) => {
    const { nodes, edges } = canvasFromGraph(record.graph);
    set({
      definitionId: record.id,
      revision: record.revision,
      status: record.status,
      currentVersionId: record.currentVersionId,
      hasUnpublishedChanges: record.hasUnpublishedChanges,
      needsAttention: record.needsAttention,
      workflow: record.graph.workflow,
      nodes,
      edges,
      selectedNodeId: null,
      selectedEdgeId: null,
      isDirty: false,
      isSaving: false,
      issues: [],
      lastSavedAt: null,
      history: [{ nodes: [...nodes], edges: [...edges] }],
      historyIndex: 0,
    });
    coalesceKey = null;
  },

  resetBuilder: () => {
    set(blankState());
    coalesceKey = null;
  },

  applySaved: (record, savedGraph) => {
    const unchanged = savedGraph === undefined || JSON.stringify(get().toGraph()) === JSON.stringify(savedGraph);
    set({
      definitionId: record.id,
      revision: record.revision,
      status: record.status,
      currentVersionId: record.currentVersionId,
      hasUnpublishedChanges: record.hasUnpublishedChanges,
      needsAttention: record.needsAttention,
      isSaving: false,
      ...(unchanged ? { isDirty: false, lastSavedAt: new Date() } : {}),
    });
  },

  // ── Document ──
  toGraph: () => {
    const { workflow, nodes, edges } = get();
    return {
      formatVersion: WORKFLOW_FORMAT_VERSION,
      workflow,
      stages: nodes.map((n) => ({
        ...n.data.stage,
        position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      })),
      edges: edges.flatMap((e) => (e.data ? [e.data.edge] : [])),
    };
  },

  // ── Canvas ──
  onNodesChange: (changes) => {
    // Only mark dirty for meaningful changes — ignore React Flow's
    // internal dimension measurements and selection changes which fire
    // on mount / re-render and incorrectly reset the saved state.
    const hasMeaningfulChange = changes.some(
      (c) => c.type !== 'dimensions' && c.type !== 'select',
    );
    set((state) => ({
      nodes: applyNodeChanges(changes, state.nodes),
      ...(hasMeaningfulChange ? { isDirty: true } : {}),
    }));
    // Record the layout once the drag settles (React Flow reports
    // `dragging: false` on the final position change). Snapshotting every
    // intermediate frame would blow the history budget, and snapshotting
    // none of them meant a redo silently reverted the layout.
    if (changes.some((c) => c.type === 'position' && c.dragging === false)) {
      get().pushHistory();
    }
  },

  onEdgesChange: (changes) => {
    // Removals go through `removeEdge` (it records history); React Flow's own
    // delete key is disabled on the canvas.
    const hasMeaningfulChange = changes.some((c) => c.type !== 'select');
    set((state) => ({
      edges: applyEdgeChanges(changes, state.edges),
      ...(hasMeaningfulChange ? { isDirty: true } : {}),
    }));
  },

  onConnect: (connection) => {
    if (!connection.source || !connection.target) return;
    if (connection.source === connection.target) return;

    const state = get();
    const id = edgeId(connection.source, connection.target);
    if (state.edges.some((e) => e.id === id)) return;
    // Both ends must be stages that still exist: a stale handle from a
    // deleted node must never produce an edge to nowhere.
    const keys = new Set(state.nodes.map((n) => n.id));
    if (!keys.has(connection.source) || !keys.has(connection.target)) return;

    const newEdge = edgeToFlowEdge({ from: connection.source, to: connection.target, on: 'success' });
    if (detectCycles(state.nodes, [...state.edges, newEdge])) return;

    set((s) => ({ edges: [...s.edges, newEdge], isDirty: true }));
    get().pushHistory();
  },

  autoLayout: () => {
    const { nodes, edges } = get();
    if (nodes.length === 0) return;
    const layouted = getLayoutedElements(nodes, edges, 'LR');
    set({ nodes: layouted.nodes, edges: layouted.edges, isDirty: true });
    get().pushHistory();
  },

  // ── Stages ──
  addStage: (name) => {
    const state = get();
    const names = new Set(state.nodes.map((n) => n.data.stage.name));
    let stageName = name;
    if (!stageName) {
      // Next unused "Stage N": after a delete, `Stage ${count + 1}` repeated an existing name.
      let n = state.nodes.length + 1;
      while (names.has(`Stage ${n}`)) n++;
      stageName = `Stage ${n}`;
    }
    const key = stageKeyFor(stageName, new Set(state.nodes.map((n) => n.id)));
    const node = stageToNode(newAgentStage(key, stageName), {
      x: (state.nodes.length % 4) * 320 + 50,
      y: Math.floor(state.nodes.length / 4) * 150 + 50,
    });
    set((s) => ({ nodes: [...s.nodes, node], isDirty: true }));
    get().pushHistory();
    return key;
  },

  updateStage: (key, updates) => {
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.id !== key) return node;
        const stage = patch(node.data.stage as Record<string, unknown>, updates as Record<string, unknown>) as StageSpec;
        return { ...node, data: { ...node.data, stage, label: stage.name } };
      }),
      isDirty: true,
    }));
    // Property edits are part of the canvas state, so they must be recorded:
    // without this a redo replayed a snapshot taken *before* the edit and
    // silently threw away every prompt and rule typed since the last
    // structural change. Keyed per stage+field so that holding down a key is
    // one undo step but editing a different field is a new one.
    get().pushHistory(`stage:${key}:${Object.keys(updates).join(',')}`);
  },

  renameStageKey: (key, nextKey) => {
    if (key === nextKey) return null;
    const state = get();
    if (!STAGE_KEY_PATTERN.test(nextKey)) {
      return 'Keys are lower snake case: a letter, then letters, digits or _ (at most 48)';
    }
    if (state.nodes.some((n) => n.id === nextKey)) return `Another stage already has the key '${nextKey}'`;
    const rename = (k: string) => (k === key ? nextKey : k);
    set((s) => ({
      nodes: s.nodes.map((node) => {
        const stage = node.data.stage;
        const from = stage.kind === 'agent' ? stage.context.from : undefined;
        const renamed = {
          ...stage,
          key: rename(stage.key),
          ...(stage.parentKey ? { parentKey: rename(stage.parentKey) } : {}),
          ...(stage.kind === 'agent' && from ? { context: { ...stage.context, from: from.map(rename) } } : {}),
          ...(stage.kind === 'loop' && stage.loop.wrapUp ? { loop: { ...stage.loop, wrapUp: { ...stage.loop.wrapUp, stage: rename(stage.loop.wrapUp.stage) } } } : {}),
        } as StageSpec;
        return { ...node, id: rename(node.id), data: { ...node.data, stage: renamed } };
      }),
      edges: s.edges.map((e) => {
        if (!e.data || (e.source !== key && e.target !== key)) return e;
        return edgeToFlowEdge({ ...e.data.edge, from: rename(e.source), to: rename(e.target) });
      }),
      selectedNodeId: s.selectedNodeId === key ? nextKey : s.selectedNodeId,
      isDirty: true,
    }));
    get().pushHistory();
    return null;
  },

  removeStage: (key) => {
    set((state) => ({
      nodes: state.nodes
        .filter((n) => n.id !== key)
        .map((n) => {
          // A context source naming the deleted stage would fail validation;
          // drop it with the stage.
          const stage = n.data.stage;
          if (stage.kind !== 'agent' || !stage.context.from?.includes(key)) return n;
          const context = { ...stage.context, from: stage.context.from.filter((k) => k !== key) };
          return { ...n, data: { ...n.data, stage: { ...stage, context } } };
        }),
      edges: state.edges.filter((e) => e.source !== key && e.target !== key),
      selectedNodeId: state.selectedNodeId === key ? null : state.selectedNodeId,
      isDirty: true,
    }));
    get().pushHistory();
  },

  duplicateStage: (key) => {
    const state = get();
    const sourceNode = state.nodes.find((n) => n.id === key);
    if (!sourceNode) return;

    const name = `${sourceNode.data.stage.name} (copy)`;
    const newKey = stageKeyFor(`${sourceNode.data.stage.key}_copy`, new Set(state.nodes.map((n) => n.id)));
    // The whole stage is copied, every field included: the graph is saved
    // as a document, so nothing the panel cannot edit is lost on the copy.
    const newStage: StageSpec = { ...structuredClone(sourceNode.data.stage), key: newKey, name };
    const newNode = stageToNode(newStage, {
      x: sourceNode.position.x + (sourceNode.measured?.width ?? 320) + 40,
      y: sourceNode.position.y,
    });
    // A duplicate is the next editing target. Keeping the original selected
    // made edits silently change it, while the overlapping copy was obscured.
    set((s) => ({
      nodes: [...s.nodes.map((node) => ({ ...node, selected: false })), { ...newNode, selected: true }],
      selectedNodeId: newKey,
      selectedEdgeId: null,
      isDirty: true,
    }));
    get().pushHistory();
  },

  // ── Edges ──
  removeEdge: (id) => {
    set((state) => ({
      edges: state.edges.filter((e) => e.id !== id),
      selectedEdgeId: state.selectedEdgeId === id ? null : state.selectedEdgeId,
      isDirty: true,
    }));
    get().pushHistory();
  },

  updateEdge: (id, updates) => {
    set((state) => ({
      edges: state.edges.map((e) => {
        if (e.id !== id || !e.data) return e;
        // The endpoints are the edge's identity; changing them is a new edge.
        const edge = patch(e.data.edge, updates);
        return { ...e, data: { ...e.data, edge: { ...edge, from: e.source, to: e.target } } };
      }),
      isDirty: true,
    }));
    get().pushHistory(`edge:${id}:${Object.keys(updates).join(',')}`);
  },

  // ── Selection ──
  selectNode: (nodeId) => set({ selectedNodeId: nodeId, selectedEdgeId: null }),
  selectEdge: (id) => set({ selectedEdgeId: id, selectedNodeId: null }),

  // ── Workflow settings ──
  updateWorkflow: (updates) => set((s) => ({ workflow: patch(s.workflow, updates), isDirty: true })),
  setName: (name) => get().updateWorkflow({ name }),
  setProjectId: (projectId) =>
    set((s) => ({
      // Codebase aliases belong to the project, so they go with it.
      workflow: patch(s.workflow, {
        projectId: projectId ?? undefined,
        lifecycle: { ...s.workflow.lifecycle, codebaseAliases: [] },
      }),
      isDirty: true,
    })),
  setCodebaseAliases: (codebaseAliases) =>
    set((s) => ({ workflow: { ...s.workflow, lifecycle: { ...s.workflow.lifecycle, codebaseAliases } }, isDirty: true })),
  // A PR needs a pushed branch and a push needs a commit, so turning one off
  // turns off everything downstream of it — the same rule the chat options and
  // the server's own flow follow.
  setPostProcessing: (flag, value) =>
    set((s) => {
      const pp = s.workflow.lifecycle.postProcessing;
      const next =
        flag === 'autoCommit'
          ? value
            ? { ...pp, autoCommit: true }
            : { ...pp, autoCommit: false, autoPush: false, autoCreatePR: false }
          : flag === 'autoPush'
            ? value
              ? { ...pp, autoPush: true, autoCommit: true }
              : { ...pp, autoPush: false, autoCreatePR: false }
            : value
              ? { ...pp, autoCreatePR: true, autoPush: true, autoCommit: true }
              : { ...pp, autoCreatePR: false };
      return {
        workflow: { ...s.workflow, lifecycle: { ...s.workflow.lifecycle, postProcessing: next } },
        isDirty: true,
      };
    }),

  // ── State tracking ──
  markDirty: () => set({ isDirty: true }),
  markSaving: (saving) => set({ isSaving: saving }),
  setIssues: (issues, graph) => set({ issues: locateIssues(issues, graph) }),

  // ── Undo/Redo ──
  pushHistory: (key) => {
    const state = get();
    const now = Date.now();
    const entry = { nodes: [...state.nodes], edges: [...state.edges] };

    // Fold this edit into the previous one when it continues the same burst
    // (same key, still inside the window) — otherwise every keystroke would
    // become its own undo step and evict all structural history.
    const coalescing =
      key !== undefined &&
      key === coalesceKey &&
      now - coalesceAt < COALESCE_WINDOW_MS &&
      state.historyIndex >= 0;

    coalesceKey = key ?? null;
    coalesceAt = now;

    if (coalescing) {
      const newHistory = state.history.slice(0, state.historyIndex + 1);
      newHistory[state.historyIndex] = entry;
      set({ history: newHistory });
      return;
    }

    const newHistory = state.history.slice(0, state.historyIndex + 1);
    newHistory.push(entry);
    if (newHistory.length > MAX_HISTORY) newHistory.shift();
    set({ history: newHistory, historyIndex: newHistory.length - 1 });
  },

  undo: () => {
    const state = get();
    coalesceKey = null;
    if (state.historyIndex <= 0) return;
    const newIndex = state.historyIndex - 1;
    const entry = state.history[newIndex];
    if (!entry) return;
    set({
      nodes: [...entry.nodes],
      edges: [...entry.edges],
      historyIndex: newIndex,
      isDirty: true,
    });
  },

  redo: () => {
    const state = get();
    coalesceKey = null;
    if (state.historyIndex >= state.history.length - 1) return;
    const newIndex = state.historyIndex + 1;
    const entry = state.history[newIndex];
    if (!entry) return;
    set({
      nodes: [...entry.nodes],
      edges: [...entry.edges],
      historyIndex: newIndex,
      isDirty: true,
    });
  },

  canUndo: () => get().historyIndex > 0,
  canRedo: () => get().historyIndex < get().history.length - 1,

  // ── Validation ──
  validate: () => {
    const graph = get().toGraph();
    const { issues } = validateWorkflow(graph, { engine: ENGINE_LEVEL });
    const located = locateIssues(issues, graph);
    set({ issues: located });
    return located;
  },

  // ── Selectors ──
  getSelectedStage: () => {
    const state = get();
    if (!state.selectedNodeId) return null;
    const node = state.nodes.find((n) => n.id === state.selectedNodeId);
    return node?.data.stage ?? null;
  },
}));

// HMR-split-proof: every module instance shares the first-created store.
// See lib/globalSingleton.ts for why this is load-bearing in dev.
export const useWorkflowBuilderStore = globalSingleton('web.workflowBuilderStore', () => useWorkflowBuilderStoreImpl);
