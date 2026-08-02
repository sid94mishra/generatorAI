// ────────────────────────────────────────────────────────────────
// Workflow Builder Store — Zustand design-time DAG state management
// Manages stages, edges, selection, validation, undo/redo
// ────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import type { Node, Edge, Connection } from '@xyflow/react';
import { applyNodeChanges, applyEdgeChanges } from '@xyflow/react';
import type { NodeChange, EdgeChange } from '@xyflow/react';
import { getLayoutedElements } from '@/utils/dagLayout.js';
import type {
  StageDefinition,
  StageEdge,
  StageEdgeType,
  PromptDefinition,
  RetryPolicy,
  StageCondition,
  WorkflowDefinitionWithStages,
  VariableDefinition,
  WorkflowSessionMode,
  HarnessConfig,
  OrchestratorConfig,
  GitRepositoryConfig,
  EntityScope,
  WorkflowHookDefinition,
} from '@generatorai/shared';

// ── Types ──

export interface StageNodeData extends Record<string, unknown> {
  stage: StageDefinition;
  label: string;
}

export interface StageEdgeData extends Record<string, unknown> {
  edge: StageEdge;
  edgeType: StageEdgeType;
}

interface HistoryEntry {
  nodes: Node<StageNodeData>[];
  edges: Edge<StageEdgeData>[];
}

interface ValidationError {
  type:
    | 'cycle'
    | 'orphan'
    | 'self_edge'
    | 'duplicate_edge'
    | 'no_stages'
    | 'missing_prompts'
    | 'undefined_variable';
  message: string;
  stageIds?: string[];
}

interface WorkflowBuilderState {
  // ── Definition state ──
  definitionId: string | null;
  name: string;
  description: string;
  sessionMode: WorkflowSessionMode;
  harnessConfig: Partial<HarnessConfig> | undefined;
  variables: VariableDefinition[];
  tags: string[];
  /** Connected git repositories (max 3) */
  gitRepositories: GitRepositoryConfig[];
  /** Whether to auto-commit changes after workflow completes */
  autoCommit: boolean;
  /** Whether to auto-create PR after workflow completes */
  autoCreatePR: boolean;
  /** Scope: 'global' or array of project IDs */
  scope: EntityScope;
  /** Selected project ID for project-scoped workflows */
  projectId: string | null;
  /** Selected codebase aliases from the project (max 3) */
  selectedCodebases: string[];
  /** Workflow-level hooks */
  hooks: WorkflowHookDefinition[];

  // ── Canvas state ──
  nodes: Node<StageNodeData>[];
  edges: Edge<StageEdgeData>[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;

  // ── State tracking ──
  isDirty: boolean;
  isSaving: boolean;
  validationErrors: ValidationError[];
  lastSavedAt: Date | null;

  // ── Undo/Redo ──
  history: HistoryEntry[];
  historyIndex: number;

  // ── Actions: Initialize ──
  loadDefinition: (definition: WorkflowDefinitionWithStages) => void;
  resetBuilder: () => void;
  setDefinitionId: (id: string | null) => void;

  // ── Actions: Canvas ──
  setNodes: (nodes: Node<StageNodeData>[]) => void;
  setEdges: (edges: Edge<StageEdgeData>[]) => void;
  onNodesChange: (changes: NodeChange<Node<StageNodeData>>[]) => void;
  onEdgesChange: (changes: EdgeChange<Edge<StageEdgeData>>[]) => void;
  onConnect: (connection: Connection) => void;

  // ── Actions: Stages ──
  addStage: (stage: StageDefinition) => void;
  updateStage: (stageId: string, updates: Partial<StageDefinition>) => void;
  removeStage: (stageId: string) => void;
  duplicateStage: (stageId: string) => void;

  // ── Actions: Edges ──
  addEdge: (edge: StageEdge) => void;
  removeEdge: (edgeId: string) => void;
  updateEdgeType: (edgeId: string, edgeType: StageEdgeType) => void;

  // ── Actions: Selection ──
  selectNode: (nodeId: string | null) => void;
  selectEdge: (edgeId: string | null) => void;

  // ── Actions: Definition props ──
  setName: (name: string) => void;
  setDescription: (description: string) => void;
  setSessionMode: (mode: WorkflowSessionMode) => void;
  setHarnessConfig: (config: Partial<HarnessConfig> | undefined) => void;
  setVariables: (variables: VariableDefinition[]) => void;
  setTags: (tags: string[]) => void;
  setGitRepositories: (repos: GitRepositoryConfig[]) => void;
  setAutoCommit: (autoCommit: boolean) => void;
  setAutoCreatePR: (autoCreatePR: boolean) => void;
  setScope: (scope: EntityScope) => void;
  setProjectId: (projectId: string | null) => void;
  setSelectedCodebases: (codebases: string[]) => void;
  setHooks: (hooks: WorkflowHookDefinition[]) => void;

  // ── Actions: State ──
  markDirty: () => void;
  markSaving: (saving: boolean) => void;
  markSaved: () => void;
  setValidationErrors: (errors: ValidationError[]) => void;

  // ── Actions: Undo/Redo ──
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  pushHistory: () => void;

  // ── Actions: Validation ──
  validate: () => ValidationError[];

  // ── Selectors ──
  getSelectedStage: () => StageDefinition | null;
}

// ── Helper: Convert StageDefinition + position to Node ──
function stageToNode(stage: StageDefinition, position?: { x: number; y: number }): Node<StageNodeData> {
  return {
    id: stage.id,
    type: 'stageNode',
    position: position ?? { x: stage.order * 320, y: 100 },
    data: { stage, label: stage.name },
  };
}

// ── Helper: Convert StageEdge to React Flow Edge ──
function stageEdgeToFlowEdge(edge: StageEdge): Edge<StageEdgeData> {
  return {
    id: edge.id,
    source: edge.fromStageId,
    target: edge.toStageId,
    type: 'stageEdge',
    data: { edge, edgeType: edge.edgeType },
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

const MAX_HISTORY = 50;

export const useWorkflowBuilderStore = create<WorkflowBuilderState>((set, get) => ({
  // ── Initial State ──
  definitionId: null,
  name: '',
  description: '',
  sessionMode: 'auto',
  harnessConfig: undefined,
  variables: [],
  tags: [],
  gitRepositories: [],
  autoCommit: true,
  autoCreatePR: false,
  scope: 'global',
  projectId: null,
  selectedCodebases: [],
  hooks: [],
  nodes: [],
  edges: [],
  selectedNodeId: null,
  selectedEdgeId: null,
  isDirty: false,
  isSaving: false,
  validationErrors: [],
  lastSavedAt: null,
  history: [],
  historyIndex: -1,

  // ── Initialize ──
  loadDefinition: (definition) => {
    const rawNodes = definition.stages.map((stage, i) =>
      stageToNode(stage, { x: (stage.order ?? i) * 320, y: 100 }),
    );
    const rawEdges = definition.edges.map(stageEdgeToFlowEdge);

    // Apply dagre auto-layout so parallel stages are spread out
    // instead of stacking on top of each other
    const { nodes, edges } = rawNodes.length > 0
      ? getLayoutedElements(rawNodes, rawEdges, 'LR')
      : { nodes: rawNodes, edges: rawEdges };

    set({
      definitionId: definition.id,
      name: definition.name,
      description: definition.description ?? '',
      sessionMode: definition.sessionMode,
      harnessConfig: definition.harnessConfig,
      variables: definition.variables ?? [],
      tags: definition.tags ?? [],
      gitRepositories: definition.orchestratorConfig?.gitRepositories ?? [],
      autoCommit: definition.orchestratorConfig?.autoCommit ?? true,
      autoCreatePR: definition.orchestratorConfig?.autoCreatePR ?? false,
      scope: (definition as unknown as { scope?: EntityScope }).scope ?? 'global',
      projectId: definition.projectId ?? null,
      selectedCodebases: definition.orchestratorConfig?.gitRepositories?.map(r => r.alias) ?? [],
      hooks: (definition as unknown as { hooks?: WorkflowHookDefinition[] }).hooks ?? [],
      nodes,
      edges,
      selectedNodeId: null,
      selectedEdgeId: null,
      isDirty: false,
      isSaving: false,
      validationErrors: [],
      lastSavedAt: null,
      history: [{ nodes: [...nodes], edges: [...edges] }],
      historyIndex: 0,
    });
  },

  resetBuilder: () => {
    set({
      definitionId: null,
      name: '',
      description: '',
      sessionMode: 'auto',
      harnessConfig: undefined,
      variables: [],
      tags: [],
      gitRepositories: [],
      autoCommit: true,
      autoCreatePR: false,
      scope: 'global',
      projectId: null,
      selectedCodebases: [],
      hooks: [],
      nodes: [],
      edges: [],
      selectedNodeId: null,
      selectedEdgeId: null,
      isDirty: false,
      isSaving: false,
      validationErrors: [],
      lastSavedAt: null,
      history: [],
      historyIndex: -1,
    });
  },

  setDefinitionId: (id) => set({ definitionId: id }),

  // ── Canvas ──
  setNodes: (nodes) => set({ nodes, isDirty: true }),
  setEdges: (edges) => set({ edges, isDirty: true }),

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
  },

  onEdgesChange: (changes) => {
    const hasMeaningfulChange = changes.some(
      (c) => c.type !== 'select',
    );
    set((state) => ({
      edges: applyEdgeChanges(changes, state.edges),
      ...(hasMeaningfulChange ? { isDirty: true } : {}),
    }));
  },

  onConnect: (connection) => {
    if (!connection.source || !connection.target) return;
    if (connection.source === connection.target) return;

    const state = get();
    // Prevent duplicate edges
    const exists = state.edges.some(
      (e) => e.source === connection.source && e.target === connection.target,
    );
    if (exists) return;

    const tempId = `edge-${connection.source}-${connection.target}`;
    const newEdge: Edge<StageEdgeData> = {
      id: tempId,
      source: connection.source,
      target: connection.target,
      type: 'stageEdge',
      data: {
        edge: {
          id: tempId,
          workflowDefinitionId: state.definitionId ?? '',
          fromStageId: connection.source,
          toStageId: connection.target,
          edgeType: 'on_success',
        },
        edgeType: 'on_success',
      },
      animated: true,
    };

    // Check for cycles with the new edge
    const testEdges = [...state.edges, newEdge];
    if (detectCycles(state.nodes, testEdges)) return;

    set((s) => ({ edges: [...s.edges, newEdge], isDirty: true }));
    get().pushHistory();
  },

  // ── Stages ──
  addStage: (stage) => {
    const state = get();
    const node = stageToNode(stage, {
      x: (state.nodes.length % 4) * 320 + 50,
      y: Math.floor(state.nodes.length / 4) * 150 + 50,
    });
    set((s) => ({ nodes: [...s.nodes, node], isDirty: true }));
    get().pushHistory();
  },

  updateStage: (stageId, updates) => {
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.id !== stageId) return node;
        const updatedStage = { ...node.data.stage, ...updates };
        return {
          ...node,
          data: { ...node.data, stage: updatedStage, label: updatedStage.name },
        };
      }),
      isDirty: true,
    }));
  },

  removeStage: (stageId) => {
    set((state) => ({
      nodes: state.nodes.filter((n) => n.id !== stageId),
      edges: state.edges.filter((e) => e.source !== stageId && e.target !== stageId),
      selectedNodeId: state.selectedNodeId === stageId ? null : state.selectedNodeId,
      isDirty: true,
    }));
    get().pushHistory();
  },

  duplicateStage: (stageId) => {
    const state = get();
    const sourceNode = state.nodes.find((n) => n.id === stageId);
    if (!sourceNode) return;

    const newId = `stage-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newStage: StageDefinition = {
      ...sourceNode.data.stage,
      id: newId,
      name: `${sourceNode.data.stage.name} (copy)`,
      order: state.nodes.length,
    };
    const newNode = stageToNode(newStage, {
      x: sourceNode.position.x + 40,
      y: sourceNode.position.y + 40,
    });
    set((s) => ({ nodes: [...s.nodes, newNode], isDirty: true }));
    get().pushHistory();
  },

  // ── Edges ──
  addEdge: (edge) => {
    const flowEdge = stageEdgeToFlowEdge(edge);
    const state = get();
    const testEdges = [...state.edges, flowEdge];
    if (detectCycles(state.nodes, testEdges)) return;
    set((s) => ({ edges: [...s.edges, flowEdge], isDirty: true }));
    get().pushHistory();
  },

  removeEdge: (edgeId) => {
    set((state) => ({
      edges: state.edges.filter((e) => e.id !== edgeId),
      selectedEdgeId: state.selectedEdgeId === edgeId ? null : state.selectedEdgeId,
      isDirty: true,
    }));
    get().pushHistory();
  },

  updateEdgeType: (edgeId, edgeType) => {
    set((state) => ({
      edges: state.edges.map((e) => {
        if (e.id !== edgeId) return e;
        return {
          ...e,
          data: e.data ? { ...e.data, edgeType, edge: { ...e.data.edge, edgeType } } : e.data,
        };
      }),
      isDirty: true,
    }));
  },

  // ── Selection ──
  selectNode: (nodeId) => set({ selectedNodeId: nodeId, selectedEdgeId: null }),
  selectEdge: (edgeId) => set({ selectedEdgeId: edgeId, selectedNodeId: null }),

  // ── Definition props ──
  setName: (name) => set({ name, isDirty: true }),
  setDescription: (description) => set({ description, isDirty: true }),
  setSessionMode: (sessionMode) => set({ sessionMode, isDirty: true }),
  setHarnessConfig: (harnessConfig) => set({ harnessConfig, isDirty: true }),
  setVariables: (variables) => set({ variables, isDirty: true }),
  setTags: (tags) => set({ tags, isDirty: true }),
  setGitRepositories: (gitRepositories) => set({ gitRepositories, isDirty: true }),
  setAutoCommit: (autoCommit) => set({ autoCommit, isDirty: true }),
  setAutoCreatePR: (autoCreatePR) => set({ autoCreatePR, isDirty: true }),
  setScope: (scope) => set({ scope, isDirty: true }),
  setProjectId: (projectId) => set({ projectId, isDirty: true, selectedCodebases: [] }),
  setSelectedCodebases: (selectedCodebases) => set({ selectedCodebases, isDirty: true }),
  setHooks: (hooks) => set({ hooks, isDirty: true }),

  // ── State tracking ──
  markDirty: () => set({ isDirty: true }),
  markSaving: (saving) => set({ isSaving: saving }),
  markSaved: () => set({ isDirty: false, isSaving: false, lastSavedAt: new Date() }),
  setValidationErrors: (errors) => set({ validationErrors: errors }),

  // ── Undo/Redo ──
  pushHistory: () => {
    const state = get();
    const newHistory = state.history.slice(0, state.historyIndex + 1);
    newHistory.push({ nodes: [...state.nodes], edges: [...state.edges] });
    if (newHistory.length > MAX_HISTORY) newHistory.shift();
    set({ history: newHistory, historyIndex: newHistory.length - 1 });
  },

  undo: () => {
    const state = get();
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
    const state = get();
    const errors: ValidationError[] = [];

    if (state.nodes.length === 0) {
      errors.push({ type: 'no_stages', message: 'Workflow must have at least one stage' });
    }

    // Check for cycles
    if (detectCycles(state.nodes, state.edges)) {
      errors.push({ type: 'cycle', message: 'DAG contains cycles — stages cannot have circular dependencies' });
    }

    // Check for self-edges
    for (const edge of state.edges) {
      if (edge.source === edge.target) {
        errors.push({
          type: 'self_edge',
          message: `Stage "${edge.source}" has a self-referencing edge`,
          stageIds: [edge.source],
        });
      }
    }

    // Check for duplicate edges
    const edgeKeys = new Set<string>();
    for (const edge of state.edges) {
      const key = `${edge.source}->${edge.target}`;
      if (edgeKeys.has(key)) {
        errors.push({
          type: 'duplicate_edge',
          message: `Duplicate edge from "${edge.source}" to "${edge.target}"`,
        });
      }
      edgeKeys.add(key);
    }

    // Check stages have prompts
    for (const node of state.nodes) {
      const stage = node.data.stage;
      if (!stage.prompts || stage.prompts.length === 0) {
        errors.push({
          type: 'missing_prompts',
          message: `Stage "${stage.name}" has no prompts configured`,
          stageIds: [stage.id],
        });
      }
    }

    // Check {{variable}} references in prompts resolve to a declared variable.
    // Unresolved placeholders leak literally into the prompt sent to the model
    // (see interpolateVariables in packages/shared), so surface them at build time.
    const declared = new Set(state.variables.map((v) => v.name));
    // System-injected variables (workspace path, run id, repo paths, etc.) are
    // provided at runtime and must not be flagged as undefined here.
    const isSystemVar = (key: string) =>
      key.startsWith('__') || key.startsWith('repo_path_') || key.startsWith('repo_branch_');
    // Tolerate optional surrounding whitespace; key may be a dotted path — only
    // the first segment must resolve to a declared/system variable.
    const placeholderPattern = /\{\{\s*([\w.\-]+)\s*\}\}/g;
    for (const node of state.nodes) {
      const stage = node.data.stage;
      const referenced = new Set<string>();
      for (const prompt of stage.prompts ?? []) {
        const text = prompt.text;
        if (!text) continue;
        for (const match of text.matchAll(placeholderPattern)) {
          const root = match[1]!.split('.')[0]!.trim();
          if (root && !declared.has(root) && !isSystemVar(root)) {
            referenced.add(root);
          }
        }
      }
      if (referenced.size > 0) {
        const names = [...referenced].map((n) => `{{${n}}}`).join(', ');
        errors.push({
          type: 'undefined_variable',
          message: `Stage "${stage.name}" references undefined variable(s): ${names}. Declare them in workflow Variables or remove the placeholder.`,
          stageIds: [stage.id],
        });
      }
    }

    set({ validationErrors: errors });
    return errors;
  },

  // ── Selectors ──
  getSelectedStage: () => {
    const state = get();
    if (!state.selectedNodeId) return null;
    const node = state.nodes.find((n) => n.id === state.selectedNodeId);
    return node?.data.stage ?? null;
  },
}));
