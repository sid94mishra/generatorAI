// ────────────────────────────────────────────────────────────────
// Workflow Builder Store tests — the v2 graph keyed by stage key:
// key generation, key-based edges (D-1), delete-then-connect (D-2),
// wholesale graph (clearing clears, D-4), positions and auto-layout in
// undo (D-28), validation located on nodes and fields (D-25).
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import type { AgentStage, WorkflowDefinitionRecord, WorkflowGraph } from '@generatorai/workflow-spec';
import {
  newAgentStage,
  stageKeyFor,
  useWorkflowBuilderStore,
  emptyWorkflow,
} from '@/stores/workflowBuilderStore.js';

const store = () => useWorkflowBuilderStore.getState();

function makeRecord(graph: Partial<WorkflowGraph> = {}, overrides: Partial<WorkflowDefinitionRecord> = {}): WorkflowDefinitionRecord {
  const a = { ...newAgentStage('analyze', 'Analyze'), prompts: [{ label: 'p', text: 'Analyze it' }], position: { x: 10, y: 20 } };
  const b = { ...newAgentStage('build', 'Build'), prompts: [{ label: 'p', text: 'Build it' }], position: { x: 400, y: 20 } };
  return {
    id: 'def-1',
    status: 'draft',
    revision: 3,
    currentVersionId: null,
    hasUnpublishedChanges: false,
    archivedAt: null,
    needsAttention: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    graph: {
      formatVersion: 2,
      workflow: { ...emptyWorkflow(), name: 'Test Workflow', tags: ['a'] },
      stages: [a, b],
      edges: [{ from: 'analyze', to: 'build', on: 'success' }],
      ...graph,
    },
    ...overrides,
  };
}

describe('workflowBuilderStore', () => {
  beforeEach(() => {
    store().resetBuilder();
  });

  // ── Keys ──

  it('stageKeyFor slugs the name and deduplicates with _2, _3', () => {
    expect(stageKeyFor('Code Review!', new Set())).toBe('code_review');
    expect(stageKeyFor('Code Review', new Set(['code_review']))).toBe('code_review_2');
    expect(stageKeyFor('Code Review', new Set(['code_review', 'code_review_2']))).toBe('code_review_3');
    expect(stageKeyFor('42 things', new Set())).toBe('stage_42_things');
    const long = stageKeyFor('x'.repeat(80), new Set(['x'.repeat(48)]));
    expect(long).toMatch(/^[a-z][a-z0-9_]{0,47}$/);
    expect(long.endsWith('_2')).toBe(true);
  });

  it('addStage generates unique names and keys, and the node id is the key', () => {
    const k1 = store().addStage();
    const k2 = store().addStage();
    expect(k1).toBe('stage_1');
    expect(k2).toBe('stage_2');
    store().removeStage(k1);
    // "Stage 2" still exists, so the next generated name must not repeat it.
    const k3 = store().addStage();
    expect(store().nodes.map((n) => n.data.stage.name)).toEqual(['Stage 2', 'Stage 3']);
    expect(k3).toBe('stage_3');
    expect(store().nodes.map((n) => n.id)).toEqual(['stage_2', 'stage_3']);
  });

  // ── D-1: edges reference keys, including edges to a stage added after load ──

  it('an edge to a newly added stage is saved with both keys (D-1)', () => {
    store().loadRecord(makeRecord());
    const key = store().addStage('Deploy');
    store().onConnect({ source: 'build', target: key, sourceHandle: null, targetHandle: null });
    const graph = store().toGraph();
    expect(graph.edges).toEqual([
      { from: 'analyze', to: 'build', on: 'success' },
      { from: 'build', to: 'deploy', on: 'success' },
    ]);
    expect(graph.stages.map((s) => s.key)).toEqual(['analyze', 'build', 'deploy']);
  });

  it('onConnect rejects self-edges, duplicates and cycles', () => {
    store().loadRecord(makeRecord());
    store().onConnect({ source: 'build', target: 'build', sourceHandle: null, targetHandle: null });
    store().onConnect({ source: 'analyze', target: 'build', sourceHandle: null, targetHandle: null });
    store().onConnect({ source: 'build', target: 'analyze', sourceHandle: null, targetHandle: null });
    expect(store().toGraph().edges).toHaveLength(1);
  });

  // ── D-2: delete a stage, then connect across it ──

  it('deleting the middle stage drops its edges and context sources; connecting across it saves one edge (D-2)', () => {
    const c = {
      ...newAgentStage('check', 'Check'),
      prompts: [{ label: 'p', text: 'Check it' }],
      context: { mode: 'summary' as const, from: ['build', 'analyze'] },
      position: { x: 800, y: 20 },
    };
    store().loadRecord(
      makeRecord({
        stages: [...makeRecord().graph.stages, c],
        edges: [
          { from: 'analyze', to: 'build', on: 'success' },
          { from: 'build', to: 'check', on: 'success' },
        ],
      }),
    );
    store().removeStage('build');
    store().onConnect({ source: 'analyze', target: 'check', sourceHandle: null, targetHandle: null });

    const graph = store().toGraph();
    expect(graph.stages.map((s) => s.key)).toEqual(['analyze', 'check']);
    expect(graph.edges).toEqual([{ from: 'analyze', to: 'check', on: 'success' }]);
    expect((graph.stages[1] as AgentStage).context.from).toEqual(['analyze']);
    expect(store().validate().filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('renameStageKey rewrites edges and context sources, and rejects bad or taken keys', () => {
    store().loadRecord(makeRecord());
    store().updateStage('build', { context: { mode: 'summary', from: ['analyze'] } });
    expect(store().renameStageKey('analyze', 'Bad Key')).toMatch(/lower snake case/);
    expect(store().renameStageKey('analyze', 'build')).toMatch(/already has the key/);
    expect(store().renameStageKey('analyze', 'research')).toBeNull();
    const graph = store().toGraph();
    expect(graph.edges[0]).toMatchObject({ from: 'research', to: 'build' });
    expect((graph.stages[1] as AgentStage).context.from).toEqual(['research']);
  });

  // ── Wholesale graph: clearing a field removes it (D-4) ──

  it('setting a field to undefined removes it from the saved graph', () => {
    store().loadRecord(makeRecord());
    store().updateStage('analyze', { retry: { maxAttempts: 3, initialDelayMs: 0, backoffMultiplier: 2, maxDelayMs: 1000, jitter: 'none', mode: 'resume', restoreCheckpointOnRestart: true } });
    store().updateStage('analyze', { retry: undefined, description: undefined });
    const stage = store().toGraph().stages[0]!;
    expect('retry' in stage).toBe(false);
    expect('description' in stage).toBe(false);

    store().updateWorkflow({ description: 'x' });
    store().updateWorkflow({ description: undefined });
    expect('description' in store().toGraph().workflow).toBe(false);
  });

  it('duplicateStage copies every field under a new key', () => {
    store().loadRecord(makeRecord());
    store().updateStage('analyze', { output: { format: 'json', extraction: 'auto', rules: [], schema: { type: 'object' } } });
    store().duplicateStage('analyze');
    const copy = store().toGraph().stages[2] as AgentStage;
    expect(copy.key).toBe('analyze_copy');
    expect(copy.name).toBe('Analyze (copy)');
    expect(copy.output.schema).toEqual({ type: 'object' });
    expect(store().selectedNodeId).toBe('analyze_copy');
  });

  // ── Positions (D-28) ──

  it('loads stored positions and saves node positions into stage.position', () => {
    store().loadRecord(makeRecord());
    expect(store().nodes[0]!.position).toEqual({ x: 10, y: 20 });
    store().onNodesChange([{ id: 'analyze', type: 'position', position: { x: 55.4, y: 66.6 }, dragging: false }]);
    expect(store().toGraph().stages[0]!.position).toEqual({ x: 55, y: 67 });
    expect(store().isDirty).toBe(true);
  });

  it('auto-layout is one undo step', () => {
    store().loadRecord(makeRecord());
    const before = store().nodes.map((n) => n.position);
    store().autoLayout();
    expect(store().nodes.map((n) => n.position)).not.toEqual(before);
    expect(store().canUndo()).toBe(true);
    store().undo();
    expect(store().nodes.map((n) => n.position)).toEqual(before);
  });

  // ── Undo/redo ──

  it('undo/redo of a stage property edit', () => {
    store().loadRecord(makeRecord());
    store().updateStage('analyze', { name: 'Renamed' });
    store().undo();
    expect(store().nodes[0]!.data.stage.name).toBe('Analyze');
    store().redo();
    expect(store().nodes[0]!.data.stage.name).toBe('Renamed');
  });

  it('an edge condition change is undoable', () => {
    store().loadRecord(makeRecord());
    store().updateEdge('analyze->build', { on: 'failure', when: "variables.x == 'y'" });
    expect(store().toGraph().edges[0]).toEqual({ from: 'analyze', to: 'build', on: 'failure', when: "variables.x == 'y'" });
    store().undo();
    expect(store().toGraph().edges[0]).toEqual({ from: 'analyze', to: 'build', on: 'success' });
  });

  // ── Validation located on nodes and fields (D-25) ──

  it('validate locates issues on the stage and field', () => {
    store().loadRecord(makeRecord());
    store().updateStage('build', { prompts: [{ label: 'p', text: '' }] });
    const issues = store().validate();
    const promptIssue = issues.find((i) => i.stageKey === 'build');
    expect(promptIssue?.field).toBe('/prompts/0/text');
    expect(promptIssue?.severity).toBe('error');
  });

  it('validate accepts v2 fields at engine level v2', () => {
    store().loadRecord(makeRecord());
    store().updateStage('build', { join: { mode: 'any', cancelRemaining: false } });
    expect(store().validate().find((i) => i.code === 'engine-unsupported')).toBeUndefined();
  });

  // ── Save bookkeeping ──

  it('applySaved stays dirty when the graph changed while the save was in flight', () => {
    store().loadRecord(makeRecord());
    store().setName('Edited');
    const saved = store().toGraph();
    store().markSaving(true);
    store().setName('Edited again');
    store().applySaved({ ...makeRecord(), revision: 4 }, saved);
    expect(store().revision).toBe(4);
    expect(store().isSaving).toBe(false);
    expect(store().isDirty).toBe(true);

    store().applySaved({ ...makeRecord(), revision: 5 }, store().toGraph());
    expect(store().isDirty).toBe(false);
  });

  it('setPostProcessing keeps commit → push → PR consistent', () => {
    store().setPostProcessing('autoCreatePR', true);
    expect(store().workflow.lifecycle.postProcessing).toMatchObject({ autoCommit: true, autoPush: true, autoCreatePR: true });
    store().setPostProcessing('autoCommit', false);
    expect(store().workflow.lifecycle.postProcessing).toMatchObject({ autoCommit: false, autoPush: false, autoCreatePR: false });
  });
});
