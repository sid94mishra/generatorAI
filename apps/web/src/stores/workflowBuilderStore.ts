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
  type CheckStage,
  type DefinitionStatus,
  type LoopStage,
  type StageKind,
  type StageSpec,
  type EdgeSpec,
  type ValidationIssue,
  type WorkflowDefinitionRecord,
  type WorkflowGraph,
  type WorkflowSpec,
} from '@generatorai/workflow-spec';
import { globalSingleton } from '../lib/globalSingleton.js';
import {
  GROUP_HEADER,
  GROUP_PAD,
  absolutePosition,
  canvasNodesFromStages,
  descendantIds,
  fitContainers,
  isContainerStage,
  layoutScoped,
  nodeSize,
  orderParentsFirst,
  parentAttrs,
  withParent,
} from '@/components/workflow/builder/containerLayout.js';

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
  /**
   * Add a stage with a generated name and key; returns the key. `kind`
   * defaults to agent; a new loop gets one agent stage in its body (a
   * container without a body is invalid). `parentKey` adds it inside that
   * container.
   */
  addStage: (name?: string, opts?: { kind?: StageKind; parentKey?: string }) => string;
  updateStage: (key: string, updates: StageUpdate) => void;
  /** Rename a stage key, updating its edges and context sources. Returns an error message or null. */
  renameStageKey: (key: string, nextKey: string) => string | null;
  /** Remove a stage; a container goes with its whole body. */
  removeStage: (key: string) => void;
  /** Copy a stage under a new key; a container is copied with its body and the edges inside it. */
  duplicateStage: (key: string) => void;

  // ── Actions: Containers (P05 loops) ──
  /**
   * Put stages of one scope into a new loop. Edges between a wrapped and
   * an unwrapped stage move to the loop (one per pair), since an edge never
   * crosses a scope. Returns the loop key, or an error message when the
   * stages cannot be wrapped.
   */
  wrapInLoop: (keys: readonly string[]) => { key: string } | { error: string };
  /** Remove a loop and move its body to the loop's own scope, rewiring its edges to the body's roots and leaves. */
  unwrapLoop: (key: string) => void;
  /**
   * Move a stage into a container (or to the top level with `undefined`),
   * keeping its canvas position. Its edges to stages of another scope are
   * removed; returns how many.
   */
  reparentStage: (key: string, parentKey: string | undefined) => number;

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
  /**
   * The server's effective command allow-list (defaults plus the operator's
   * extras), used to validate check commands like the server does. `null`
   * validates against the spec's default list.
   */
  commandAllowlist: readonly string[] | null;
  setCommandAllowlist: (commands: readonly string[] | null) => void;
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
 * A new check stage in parsed form. The command is a placeholder from the
 * default allow-list; the panel's picker offers the server's list.
 */
export function newCheckStage(key: string, name: string): CheckStage {
  return {
    kind: 'check',
    key,
    name,
    join: { mode: 'all' },
    check: { command: 'npm', args: ['test'], timeoutMs: 600_000, parseJson: false, failOnNonZero: false, tailBytes: 16_384 },
  };
}

/**
 * A new loop stage in parsed form. No exit rules: that is a warning (it
 * runs to maxIterations), where a placeholder rule would be an error.
 */
export function newLoopStage(key: string, name: string): LoopStage {
  return {
    kind: 'loop',
    key,
    name,
    join: { mode: 'all' },
    loop: { maxIterations: 3, exits: [], onLimit: { mode: 'pause' }, onBodyFailure: 'fail', output: {} },
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

function stageToNode(stage: StageSpec, position: { x: number; y: number }, parentId?: string): Node<StageNodeData> {
  return {
    id: stage.key,
    // A container renders as a group node with its body inside (P05).
    type: isContainerStage(stage) ? 'loopNode' : 'stageNode',
    position,
    data: { stage, label: stage.name },
    ...parentAttrs(parentId),
  };
}

/** A stage with its container set (`undefined` removes `parentKey`). */
function withParentKey(stage: StageSpec, parentKey: string | undefined): StageSpec {
  const next = { ...stage } as StageSpec;
  if (parentKey) next.parentKey = parentKey;
  else delete next.parentKey;
  return next;
}

/** Scope of a stage: its container key, '' at the top level. */
function scopeOf(stage: StageSpec): string {
  return stage.parentKey ?? '';
}

/**
 * Where a new node goes: below the last body stage of a container, or on
 * the next free slot of the top-level grid.
 */
function nextPosition(nodes: readonly Node<StageNodeData>[], parentKey: string | undefined): { x: number; y: number } {
  if (parentKey) {
    const body = nodes.filter((n) => n.parentId === parentKey);
    if (body.length === 0) return { x: GROUP_PAD, y: GROUP_HEADER };
    const bottom = Math.max(...body.map((n) => n.position.y + nodeSize(n).height));
    return { x: Math.min(...body.map((n) => n.position.x)), y: bottom + 40 };
  }
  const top = nodes.filter((n) => !n.parentId);
  return { x: (top.length % 4) * 320 + 50, y: Math.floor(top.length / 4) * 150 + 50 };
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

/**
 * Nodes and edges for a graph: stored positions when every stage has one,
 * a per-scope dagre layout otherwise. Body stages become child nodes of
 * their container (stored positions are absolute; see containerLayout).
 */
function canvasFromGraph(graph: WorkflowGraph): { nodes: Node<StageNodeData>[]; edges: Edge<StageEdgeData>[] } {
  const edges = graph.edges.map(edgeToFlowEdge);
  const nodes = canvasNodesFromStages(graph.stages, stageToNode, edges);
  return { nodes, edges };
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
    commandAllowlist: null as readonly string[] | null,
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
    // The allow-list is server configuration, not part of a workflow.
    set({ ...blankState(), commandAllowlist: get().commandAllowlist });
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
    // Body nodes hold positions relative to their container; the document
    // stores canvas (absolute) positions.
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return {
      formatVersion: WORKFLOW_FORMAT_VERSION,
      workflow,
      stages: nodes.map((n) => {
        const at = absolutePosition(n.id, byId);
        return { ...n.data.stage, position: { x: Math.round(at.x), y: Math.round(at.y) } };
      }),
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
    const dragEnded = changes.some((c) => c.type === 'position' && c.dragging === false);
    set((state) => {
      const nodes = applyNodeChanges(changes, state.nodes);
      return {
        // A drag that settles re-fits the containers around their bodies
        // (they only grow while dragging).
        nodes: dragEnded ? fitContainers(nodes) : nodes,
        ...(hasMeaningfulChange ? { isDirty: true } : {}),
      };
    });
    // Record the layout once the drag settles (React Flow reports
    // `dragging: false` on the final position change). Snapshotting every
    // intermediate frame would blow the history budget, and snapshotting
    // none of them meant a redo silently reverted the layout.
    if (dragEnded) {
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
    const source = state.nodes.find((n) => n.id === connection.source);
    const target = state.nodes.find((n) => n.id === connection.target);
    if (!source || !target) return;
    // An edge never crosses a scope (edge-crosses-scope): body stages connect
    // to each other, outer stages to the loop node itself.
    if (scopeOf(source.data.stage) !== scopeOf(target.data.stage)) return;

    const newEdge = edgeToFlowEdge({ from: connection.source, to: connection.target, on: 'success' });
    if (detectCycles(state.nodes, [...state.edges, newEdge])) return;

    set((s) => ({ edges: [...s.edges, newEdge], isDirty: true }));
    get().pushHistory();
  },

  autoLayout: () => {
    const { nodes, edges } = get();
    if (nodes.length === 0) return;
    set({ nodes: layoutScoped(nodes, edges), isDirty: true });
    get().pushHistory();
  },

  // ── Stages ──
  addStage: (name, opts) => {
    const state = get();
    const kind = opts?.kind ?? 'agent';
    const parent = opts?.parentKey ? state.nodes.find((n) => n.id === opts.parentKey) : undefined;
    const parentKey = parent && isContainerStage(parent.data.stage) ? parent.id : undefined;
    const names = new Set(state.nodes.map((n) => n.data.stage.name));
    const taken = new Set(state.nodes.map((n) => n.id));
    /** Next unused "<Prefix> N": after a delete, `count + 1` repeated an existing name. */
    const freshName = (prefix: string) => {
      let n = state.nodes.filter((node) => node.data.stage.kind === (prefix === 'Stage' ? 'agent' : prefix.toLowerCase())).length + 1;
      while (names.has(`${prefix} ${n}`)) n++;
      names.add(`${prefix} ${n}`);
      return `${prefix} ${n}`;
    };
    const stageName = name || freshName(kind === 'loop' ? 'Loop' : kind === 'check' ? 'Check' : 'Stage');
    const key = stageKeyFor(stageName, taken);
    taken.add(key);
    const stage: StageSpec = withParentKey(
      kind === 'loop' ? newLoopStage(key, stageName) : kind === 'check' ? newCheckStage(key, stageName) : newAgentStage(key, stageName),
      parentKey,
    );
    const added = [stageToNode(stage, nextPosition(state.nodes, parentKey), parentKey)];
    if (kind === 'loop') {
      // A container without a body is invalid (empty-body): start with one stage.
      const bodyName = freshName('Stage');
      const bodyKey = stageKeyFor(bodyName, taken);
      added.push(stageToNode(withParentKey(newAgentStage(bodyKey, bodyName), key), { x: GROUP_PAD, y: GROUP_HEADER }, key));
    }
    set((s) => ({ nodes: fitContainers(orderParentsFirst([...s.nodes, ...added])), isDirty: true }));
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
        return {
          ...node,
          id: rename(node.id),
          ...(node.parentId ? { parentId: rename(node.parentId) } : {}),
          data: { ...node.data, stage: renamed },
        };
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
    // A container goes with its body: a body without its container would
    // be a set of stages whose parentKey names nothing.
    const removed = new Set([key, ...descendantIds(key, get().nodes)]);
    set((state) => ({
      nodes: fitContainers(
        state.nodes
          .filter((n) => !removed.has(n.id))
          .map((n) => {
            // A context source naming a deleted stage would fail validation;
            // drop it with the stage.
            const stage = n.data.stage;
            if (stage.kind !== 'agent' || !stage.context.from?.some((k) => removed.has(k))) return n;
            const context = { ...stage.context, from: stage.context.from.filter((k) => !removed.has(k)) };
            return { ...n, data: { ...n.data, stage: { ...stage, context } } };
          }),
      ),
      edges: state.edges.filter((e) => !removed.has(e.source) && !removed.has(e.target)),
      selectedNodeId: state.selectedNodeId && removed.has(state.selectedNodeId) ? null : state.selectedNodeId,
      isDirty: true,
    }));
    get().pushHistory();
  },

  duplicateStage: (key) => {
    const state = get();
    const sourceNode = state.nodes.find((n) => n.id === key);
    if (!sourceNode) return;

    // A container is copied with its body; every copied key is new, and
    // references inside the copy (parentKey, context sources, the wrap-up
    // stage, edges) point at the copies.
    const subtree = [key, ...descendantIds(key, state.nodes)];
    const taken = new Set(state.nodes.map((n) => n.id));
    const keyMap = new Map<string, string>();
    for (const k of subtree) {
      const next = stageKeyFor(`${k}_copy`, taken);
      taken.add(next);
      keyMap.set(k, next);
    }
    const mapKey = (k: string) => keyMap.get(k) ?? k;
    const newKey = keyMap.get(key)!;

    const copies = subtree.map((k) => {
      const node = state.nodes.find((n) => n.id === k)!;
      // The whole stage is copied, every field included: the graph is saved
      // as a document, so nothing the panel cannot edit is lost on the copy.
      const source = structuredClone(node.data.stage);
      const stage = {
        ...source,
        key: mapKey(k),
        ...(k === key ? { name: `${source.name} (copy)` } : {}),
        ...(source.parentKey ? { parentKey: mapKey(source.parentKey) } : {}),
        ...(source.kind === 'agent' && source.context.from ? { context: { ...source.context, from: source.context.from.map(mapKey) } } : {}),
        ...(source.kind === 'loop' && source.loop.wrapUp
          ? { loop: { ...source.loop, wrapUp: { ...source.loop.wrapUp, stage: mapKey(source.loop.wrapUp.stage) } } }
          : {}),
      } as StageSpec;
      const position =
        k === key ? { x: node.position.x + nodeSize(node).width + 40, y: node.position.y } : node.position;
      const copy = stageToNode(stage, position, node.parentId ? mapKey(node.parentId) : undefined);
      return isContainerStage(stage) ? { ...copy, width: node.width, height: node.height } : copy;
    });
    const inside = new Set(subtree);
    const copiedEdges = state.edges
      .filter((e) => e.data && inside.has(e.source) && inside.has(e.target))
      .map((e) => edgeToFlowEdge({ ...e.data!.edge, from: mapKey(e.source), to: mapKey(e.target) }));

    // A duplicate is the next editing target. Keeping the original selected
    // made edits silently change it, while the overlapping copy was obscured.
    set((s) => ({
      nodes: fitContainers(
        orderParentsFirst([
          ...s.nodes.map((node) => ({ ...node, selected: false })),
          ...copies.map((c) => (c.id === newKey ? { ...c, selected: true } : c)),
        ]),
      ),
      edges: [...s.edges, ...copiedEdges],
      selectedNodeId: newKey,
      selectedEdgeId: null,
      isDirty: true,
    }));
    get().pushHistory();
  },

  // ── Containers ──
  wrapInLoop: (keys) => {
    const state = get();
    const selected = keys.map((k) => state.nodes.find((n) => n.id === k)).filter((n): n is Node<StageNodeData> => !!n);
    if (selected.length === 0) return { error: 'Select the stages to wrap' };
    const scope = scopeOf(selected[0]!.data.stage);
    if (selected.some((n) => scopeOf(n.data.stage) !== scope)) {
      return { error: 'Only stages of the same scope can be wrapped together (all top level, or all in one loop)' };
    }
    const parentId = selected[0]!.parentId;
    const inSel = new Set(selected.map((n) => n.id));

    const names = new Set(state.nodes.map((n) => n.data.stage.name));
    let n = state.nodes.filter((node) => node.data.stage.kind === 'loop').length + 1;
    while (names.has(`Loop ${n}`)) n++;
    const name = `Loop ${n}`;
    const loopKey = stageKeyFor(name, new Set(state.nodes.map((node) => node.id)));

    // An edge between a wrapped and an unwrapped stage would cross the new
    // scope: it moves to the loop node. The first such edge of a pair wins,
    // so the document keeps one edge per pair.
    const edges: Edge<StageEdgeData>[] = [];
    const seen = new Set<string>();
    for (const e of state.edges) {
      if (!e.data) continue;
      let { from, to } = e.data.edge;
      const fromIn = inSel.has(from);
      const toIn = inSel.has(to);
      if (fromIn !== toIn) {
        if (fromIn) from = loopKey;
        else to = loopKey;
      }
      const id = edgeId(from, to);
      if (seen.has(id)) continue;
      seen.add(id);
      edges.push(from === e.source && to === e.target ? e : edgeToFlowEdge({ ...e.data.edge, from, to }));
    }

    // The loop sits around the selection's bounding box, in the selection's frame.
    const minX = Math.min(...selected.map((node) => node.position.x));
    const minY = Math.min(...selected.map((node) => node.position.y));
    const origin = { x: minX - GROUP_PAD, y: minY - GROUP_HEADER };
    const loopNode = { ...stageToNode(withParentKey(newLoopStage(loopKey, name), scope || undefined), origin, parentId), selected: true };

    const firstIndex = state.nodes.findIndex((node) => inSel.has(node.id));
    const nodes: Node<StageNodeData>[] = [];
    state.nodes.forEach((node, i) => {
      if (i === firstIndex) nodes.push(loopNode);
      if (!inSel.has(node.id)) {
        nodes.push({ ...node, selected: false });
        return;
      }
      const stage = withParentKey(node.data.stage, loopKey);
      nodes.push({
        ...withParent(node, loopKey),
        selected: false,
        position: { x: node.position.x - origin.x, y: node.position.y - origin.y },
        data: { ...node.data, stage },
      });
    });
    // Wrapping a selection that is not closed under its paths (a → x → b
    // with only a and b selected) would make the loop both precede and
    // follow x.
    if (detectCycles(nodes, edges)) {
      return { error: 'Wrapping these stages would create a cycle: also select the stages on the paths between them' };
    }

    set({
      nodes: fitContainers(orderParentsFirst(nodes)),
      edges,
      selectedNodeId: loopKey,
      selectedEdgeId: null,
      isDirty: true,
    });
    get().pushHistory();
    return { key: loopKey };
  },

  unwrapLoop: (key) => {
    const state = get();
    const loopNode = state.nodes.find((n) => n.id === key);
    if (!loopNode || loopNode.data.stage.kind !== 'loop') return;
    const outerKey = loopNode.data.stage.parentKey;
    const body = state.nodes.filter((n) => n.data.stage.parentKey === key);
    const bodyKeys = new Set(body.map((n) => n.id));

    // Edges into the loop now lead to the body's roots, edges out of it
    // leave from the body's leaves, so the order around the body holds.
    const internal = state.edges.filter((e) => bodyKeys.has(e.source) && bodyKeys.has(e.target));
    const roots = body.filter((n) => !internal.some((e) => e.target === n.id)).map((n) => n.id);
    const leaves = body.filter((n) => !internal.some((e) => e.source === n.id)).map((n) => n.id);
    const edges: Edge<StageEdgeData>[] = [];
    const seen = new Set<string>();
    const add = (edge: EdgeSpec, flow?: Edge<StageEdgeData>) => {
      const id = edgeId(edge.from, edge.to);
      if (seen.has(id)) return;
      seen.add(id);
      edges.push(flow ?? edgeToFlowEdge(edge));
    };
    for (const e of state.edges) {
      if (!e.data) continue;
      if (e.target === key) roots.forEach((r) => add({ ...e.data!.edge, to: r }));
      else if (e.source === key) leaves.forEach((l) => add({ ...e.data!.edge, from: l }));
      else add(e.data.edge, e);
    }

    const nodes = state.nodes
      .filter((n) => n.id !== key)
      .map((n) => {
        const stage = n.data.stage;
        if (bodyKeys.has(n.id)) {
          return {
            ...withParent(n, loopNode.parentId),
            position: { x: n.position.x + loopNode.position.x, y: n.position.y + loopNode.position.y },
            data: { ...n.data, stage: withParentKey(stage, outerKey) },
          };
        }
        if (stage.kind === 'agent' && stage.context.from?.includes(key)) {
          const context = { ...stage.context, from: stage.context.from.filter((k) => k !== key) };
          return { ...n, data: { ...n.data, stage: { ...stage, context } } };
        }
        return n;
      });

    set({
      nodes: fitContainers(orderParentsFirst(nodes)),
      edges,
      selectedNodeId: state.selectedNodeId === key ? null : state.selectedNodeId,
      isDirty: true,
    });
    get().pushHistory();
  },

  reparentStage: (key, parentKey) => {
    const state = get();
    const node = state.nodes.find((n) => n.id === key);
    if (!node || (node.data.stage.parentKey ?? undefined) === parentKey) return 0;
    const byId = new Map(state.nodes.map((n) => [n.id, n]));
    if (parentKey !== undefined) {
      const parent = byId.get(parentKey);
      // Never into a non-container, itself or its own body.
      if (!parent || !isContainerStage(parent.data.stage) || parentKey === key) return 0;
      if (descendantIds(key, state.nodes).includes(parentKey)) return 0;
    }
    const abs = absolutePosition(key, byId);
    const origin = parentKey ? absolutePosition(parentKey, byId) : { x: 0, y: 0 };
    const nextScope = parentKey ?? '';
    const crossing = (e: Edge<StageEdgeData>) => {
      const other = e.source === key ? e.target : e.target === key ? e.source : undefined;
      return other !== undefined && scopeOf(byId.get(other)!.data.stage) !== nextScope;
    };
    const dropped = state.edges.filter(crossing).length;

    set({
      nodes: fitContainers(
        orderParentsFirst(
          state.nodes.map((n) =>
            n.id === key
              ? {
                  ...withParent(n, parentKey),
                  position: { x: abs.x - origin.x, y: abs.y - origin.y },
                  data: { ...n.data, stage: withParentKey(n.data.stage, parentKey) },
                }
              : n,
          ),
        ),
      ),
      edges: state.edges.filter((e) => !crossing(e)),
      isDirty: true,
    });
    get().pushHistory();
    return dropped;
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
  setCommandAllowlist: (commandAllowlist) => set({ commandAllowlist }),
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
    const allowlist = get().commandAllowlist;
    const { issues } = validateWorkflow(graph, { engine: ENGINE_LEVEL, ...(allowlist ? { commandAllowlist: allowlist } : {}) });
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
