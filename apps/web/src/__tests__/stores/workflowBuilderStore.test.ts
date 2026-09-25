// ────────────────────────────────────────────────────────────────
// Workflow Builder Store tests — Stage/edge CRUD, validation,
// undo/redo, load/reset, selection
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import type {
  StageDefinition,
  StageEdge,
  WorkflowDefinitionWithStages,
} from '@generatorai/shared';

function makeStage(overrides: Partial<StageDefinition> = {}): StageDefinition {
  return {
    id: `stage-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    workflowDefinitionId: 'def-1',
    name: 'Test Stage',
    order: 0,
    prompts: [{ label: 'p1', text: 'Do something' }],
    hooks: [],
    createdAt: new Date(),
    ...overrides,
  };
}

function makeDefinition(
  overrides: Partial<WorkflowDefinitionWithStages> = {},
): WorkflowDefinitionWithStages {
  return {
    id: 'def-1',
    name: 'Test Workflow',
    description: 'A test',
    sessionMode: 'auto',
    variables: [],
    tags: ['test'],
    createdAt: new Date(),
    updatedAt: new Date(),
    stages: [],
    edges: [],
    ...overrides,
  } as WorkflowDefinitionWithStages;
}

describe('workflowBuilderStore', () => {
  beforeEach(() => {
    useWorkflowBuilderStore.getState().resetBuilder();
  });

  // ── Load & Reset ──

  it('loadDefinition populates store from definition', () => {
    const s1 = makeStage({ id: 's1', name: 'Stage 1', order: 0 });
    const s2 = makeStage({ id: 's2', name: 'Stage 2', order: 1 });
    const edge: StageEdge = {
      id: 'e1',
      workflowDefinitionId: 'def-1',
      fromStageId: 's1',
      toStageId: 's2',
      edgeType: 'on_success',
    };

    const def = makeDefinition({ stages: [s1, s2], edges: [edge], tags: ['a', 'b'] });
    useWorkflowBuilderStore.getState().loadDefinition(def);

    const state = useWorkflowBuilderStore.getState();
    expect(state.definitionId).toBe('def-1');
    expect(state.name).toBe('Test Workflow');
    expect(state.nodes).toHaveLength(2);
    expect(state.edges).toHaveLength(1);
    expect(state.tags).toEqual(['a', 'b']);
    expect(state.isDirty).toBe(false);
  });

  it('resetBuilder clears all state', () => {
    const s1 = makeStage({ id: 's1' });
    useWorkflowBuilderStore.getState().loadDefinition(makeDefinition({ stages: [s1] }));
    useWorkflowBuilderStore.getState().resetBuilder();

    const state = useWorkflowBuilderStore.getState();
    expect(state.definitionId).toBeNull();
    expect(state.nodes).toHaveLength(0);
    expect(state.edges).toHaveLength(0);
  });

  // ── Stage CRUD ──

  it('addStage creates a node', () => {
    const stage = makeStage({ id: 's1', name: 'New' });
    useWorkflowBuilderStore.getState().addStage(stage);

    const state = useWorkflowBuilderStore.getState();
    expect(state.nodes).toHaveLength(1);
    expect(state.nodes[0]!.data.stage.name).toBe('New');
    expect(state.isDirty).toBe(true);
  });

  it('updateStage modifies node data', () => {
    const stage = makeStage({ id: 's1', name: 'Old' });
    useWorkflowBuilderStore.getState().addStage(stage);
    useWorkflowBuilderStore.getState().updateStage('s1', { name: 'Updated' });

    const node = useWorkflowBuilderStore.getState().nodes[0]!;
    expect(node.data.stage.name).toBe('Updated');
    expect(node.data.label).toBe('Updated');
  });

  it('removeStage removes node and connected edges', () => {
    const s1 = makeStage({ id: 's1' });
    const s2 = makeStage({ id: 's2' });
    useWorkflowBuilderStore.getState().addStage(s1);
    useWorkflowBuilderStore.getState().addStage(s2);
    useWorkflowBuilderStore.getState().addEdge({
      id: 'e1',
      workflowDefinitionId: 'def-1',
      fromStageId: 's1',
      toStageId: 's2',
      edgeType: 'on_success',
    });

    expect(useWorkflowBuilderStore.getState().edges).toHaveLength(1);
    useWorkflowBuilderStore.getState().removeStage('s1');

    const state = useWorkflowBuilderStore.getState();
    expect(state.nodes).toHaveLength(1);
    expect(state.edges).toHaveLength(0); // edge removed with stage
  });

  it('duplicateStage creates a copy of the stage', () => {
    const stage = makeStage({ id: 's1', name: 'Original' });
    useWorkflowBuilderStore.getState().addStage(stage);
    useWorkflowBuilderStore.getState().duplicateStage('s1');

    const state = useWorkflowBuilderStore.getState();
    expect(state.nodes).toHaveLength(2);
    expect(state.nodes[1]!.data.stage.name).toBe('Original (copy)');
    expect(state.nodes[1]!.id).not.toBe('s1');
    expect(state.selectedNodeId).toBe(state.nodes[1]!.id);
    expect(state.nodes[1]!.selected).toBe(true);
    expect(state.nodes[0]!.selected).toBe(false);
    expect(state.nodes[1]!.position.x).toBeGreaterThan(state.nodes[0]!.position.x + 320);
    // Typing immediately after duplication must edit the copy.
    state.updateStage(state.selectedNodeId!, { name: 'Edited copy' });
    expect(useWorkflowBuilderStore.getState().nodes[0]!.data.stage.name).toBe('Original');
    expect(useWorkflowBuilderStore.getState().nodes[1]!.data.stage.name).toBe('Edited copy');
  });

  // ── Edge CRUD ──

  it('addEdge creates a flow edge', () => {
    const s1 = makeStage({ id: 's1' });
    const s2 = makeStage({ id: 's2' });
    useWorkflowBuilderStore.getState().addStage(s1);
    useWorkflowBuilderStore.getState().addStage(s2);
    useWorkflowBuilderStore.getState().addEdge({
      id: 'e1',
      workflowDefinitionId: 'def-1',
      fromStageId: 's1',
      toStageId: 's2',
      edgeType: 'on_success',
    });

    const state = useWorkflowBuilderStore.getState();
    expect(state.edges).toHaveLength(1);
    expect(state.edges[0]!.source).toBe('s1');
    expect(state.edges[0]!.target).toBe('s2');
  });

  it('addEdge prevents cycles', () => {
    const s1 = makeStage({ id: 's1' });
    const s2 = makeStage({ id: 's2' });
    useWorkflowBuilderStore.getState().addStage(s1);
    useWorkflowBuilderStore.getState().addStage(s2);

    useWorkflowBuilderStore.getState().addEdge({
      id: 'e1',
      workflowDefinitionId: 'def-1',
      fromStageId: 's1',
      toStageId: 's2',
      edgeType: 'on_success',
    });

    // Try to create a back-edge (cycle)
    useWorkflowBuilderStore.getState().addEdge({
      id: 'e2',
      workflowDefinitionId: 'def-1',
      fromStageId: 's2',
      toStageId: 's1',
      edgeType: 'on_success',
    });

    // Should still be only 1 edge
    expect(useWorkflowBuilderStore.getState().edges).toHaveLength(1);
  });

  it('removeEdge removes the edge', () => {
    const s1 = makeStage({ id: 's1' });
    const s2 = makeStage({ id: 's2' });
    useWorkflowBuilderStore.getState().addStage(s1);
    useWorkflowBuilderStore.getState().addStage(s2);
    useWorkflowBuilderStore.getState().addEdge({
      id: 'e1',
      workflowDefinitionId: 'def-1',
      fromStageId: 's1',
      toStageId: 's2',
      edgeType: 'on_success',
    });

    useWorkflowBuilderStore.getState().removeEdge('e1');
    expect(useWorkflowBuilderStore.getState().edges).toHaveLength(0);
  });

  it('updateEdgeType changes the edge type', () => {
    const s1 = makeStage({ id: 's1' });
    const s2 = makeStage({ id: 's2' });
    useWorkflowBuilderStore.getState().addStage(s1);
    useWorkflowBuilderStore.getState().addStage(s2);
    useWorkflowBuilderStore.getState().addEdge({
      id: 'e1',
      workflowDefinitionId: 'def-1',
      fromStageId: 's1',
      toStageId: 's2',
      edgeType: 'on_success',
    });

    useWorkflowBuilderStore.getState().updateEdgeType('e1', 'on_failure');
    const edge = useWorkflowBuilderStore.getState().edges[0]!;
    expect(edge.data?.edgeType).toBe('on_failure');
  });

  // ── Selection ──

  it('selectNode sets selectedNodeId and clears selectedEdgeId', () => {
    const s1 = makeStage({ id: 's1' });
    useWorkflowBuilderStore.getState().addStage(s1);

    useWorkflowBuilderStore.getState().selectNode('s1');
    const state = useWorkflowBuilderStore.getState();
    expect(state.selectedNodeId).toBe('s1');
    expect(state.selectedEdgeId).toBeNull();
  });

  it('getSelectedStage returns the selected stage', () => {
    const stage = makeStage({ id: 's1', name: 'Target' });
    useWorkflowBuilderStore.getState().addStage(stage);
    useWorkflowBuilderStore.getState().selectNode('s1');

    const selected = useWorkflowBuilderStore.getState().getSelectedStage();
    expect(selected?.name).toBe('Target');
  });

  // ── Definition props ──

  it('setName / setDescription / setTags mark dirty', () => {
    useWorkflowBuilderStore.getState().loadDefinition(makeDefinition());
    expect(useWorkflowBuilderStore.getState().isDirty).toBe(false);

    useWorkflowBuilderStore.getState().setName('New Name');
    expect(useWorkflowBuilderStore.getState().isDirty).toBe(true);
    expect(useWorkflowBuilderStore.getState().name).toBe('New Name');

    useWorkflowBuilderStore.getState().setDescription('New desc');
    expect(useWorkflowBuilderStore.getState().description).toBe('New desc');

    useWorkflowBuilderStore.getState().setTags(['x', 'y']);
    expect(useWorkflowBuilderStore.getState().tags).toEqual(['x', 'y']);
  });

  // ── Validation ──

  it('validate detects no-stages error', () => {
    const errors = useWorkflowBuilderStore.getState().validate();
    expect(errors.some((e) => e.type === 'no_stages')).toBe(true);
  });

  it('validate detects missing-prompts error', () => {
    const stage = makeStage({ id: 's1', prompts: [] });
    useWorkflowBuilderStore.getState().addStage(stage);

    const errors = useWorkflowBuilderStore.getState().validate();
    expect(errors.some((e) => e.type === 'missing_prompts')).toBe(true);
  });

  it('validate passes for a valid graph', () => {
    const s1 = makeStage({ id: 's1', prompts: [{ label: 'p', text: 'x' }] });
    const s2 = makeStage({ id: 's2', prompts: [{ label: 'p', text: 'y' }] });
    useWorkflowBuilderStore.getState().addStage(s1);
    useWorkflowBuilderStore.getState().addStage(s2);
    useWorkflowBuilderStore.getState().addEdge({
      id: 'e1',
      workflowDefinitionId: 'def-1',
      fromStageId: 's1',
      toStageId: 's2',
      edgeType: 'on_success',
    });

    const errors = useWorkflowBuilderStore.getState().validate();
    expect(errors).toHaveLength(0);
  });

  // ── Undo / Redo ──

  it('undo reverts to previous state after loadDefinition', () => {
    // loadDefinition seeds history[0], so we can undo back to it
    useWorkflowBuilderStore.getState().loadDefinition(makeDefinition());
    expect(useWorkflowBuilderStore.getState().nodes).toHaveLength(0);

    const s1 = makeStage({ id: 's1' });
    useWorkflowBuilderStore.getState().addStage(s1);
    expect(useWorkflowBuilderStore.getState().nodes).toHaveLength(1);

    useWorkflowBuilderStore.getState().undo();
    expect(useWorkflowBuilderStore.getState().nodes).toHaveLength(0);
  });

  it('redo re-applies undone change', () => {
    useWorkflowBuilderStore.getState().loadDefinition(makeDefinition());

    const s1 = makeStage({ id: 's1' });
    useWorkflowBuilderStore.getState().addStage(s1);

    useWorkflowBuilderStore.getState().undo();
    expect(useWorkflowBuilderStore.getState().nodes).toHaveLength(0);

    useWorkflowBuilderStore.getState().redo();
    expect(useWorkflowBuilderStore.getState().nodes).toHaveLength(1);
  });

  it('canUndo / canRedo reflect state correctly', () => {
    // After loadDefinition, historyIndex=0 — can't undo yet
    useWorkflowBuilderStore.getState().loadDefinition(makeDefinition());
    expect(useWorkflowBuilderStore.getState().canUndo()).toBe(false);
    expect(useWorkflowBuilderStore.getState().canRedo()).toBe(false);

    const s1 = makeStage({ id: 's1' });
    useWorkflowBuilderStore.getState().addStage(s1);
    expect(useWorkflowBuilderStore.getState().canUndo()).toBe(true);
    expect(useWorkflowBuilderStore.getState().canRedo()).toBe(false);

    useWorkflowBuilderStore.getState().undo();
    expect(useWorkflowBuilderStore.getState().canUndo()).toBe(false);
    expect(useWorkflowBuilderStore.getState().canRedo()).toBe(true);
  });

  it('the first stage added to a NEW (unsaved) workflow is undoable', () => {
    // resetBuilder must seed the empty canvas as history[0]; when it left
    // history empty the first addStage landed at index 0 and canUndo()
    // (index > 0) stayed false — the stage could never be undone.
    useWorkflowBuilderStore.getState().resetBuilder();
    expect(useWorkflowBuilderStore.getState().canUndo()).toBe(false);

    useWorkflowBuilderStore.getState().addStage(makeStage({ id: 's1' }));
    expect(useWorkflowBuilderStore.getState().canUndo()).toBe(true);

    useWorkflowBuilderStore.getState().undo();
    expect(useWorkflowBuilderStore.getState().nodes).toHaveLength(0);
  });

  it('a stage property edit survives an undo/redo round trip', () => {
    // updateStage used not to record history, so redo replayed a snapshot
    // taken before the edit and silently discarded it.
    useWorkflowBuilderStore.getState().loadDefinition(makeDefinition());
    useWorkflowBuilderStore.getState().addStage(makeStage({ id: 's1', name: 'Original' }));
    useWorkflowBuilderStore.getState().updateStage('s1', { name: 'Renamed' });
    expect(useWorkflowBuilderStore.getState().nodes[0]!.data.stage.name).toBe('Renamed');

    useWorkflowBuilderStore.getState().undo();
    expect(useWorkflowBuilderStore.getState().nodes[0]!.data.stage.name).toBe('Original');

    useWorkflowBuilderStore.getState().redo();
    expect(useWorkflowBuilderStore.getState().nodes[0]!.data.stage.name).toBe('Renamed');
  });

  it('coalesces a burst of edits to one field into a single undo step', () => {
    useWorkflowBuilderStore.getState().loadDefinition(makeDefinition());
    useWorkflowBuilderStore.getState().addStage(makeStage({ id: 's1', name: '' }));
    const before = useWorkflowBuilderStore.getState().history.length;

    // Simulates typing — one updateStage per keystroke.
    for (const name of ['R', 'Re', 'Ren', 'Rena', 'Renam', 'Rename']) {
      useWorkflowBuilderStore.getState().updateStage('s1', { name });
    }
    expect(useWorkflowBuilderStore.getState().history.length).toBe(before + 1);

    // ...and one undo takes the whole burst back out.
    useWorkflowBuilderStore.getState().undo();
    expect(useWorkflowBuilderStore.getState().nodes[0]!.data.stage.name).toBe('');
  });

  it('an edge type change is undoable', () => {
    const s1 = makeStage({ id: 's1' });
    const s2 = makeStage({ id: 's2', order: 1 });
    useWorkflowBuilderStore.getState().loadDefinition(
      makeDefinition({
        stages: [s1, s2],
        edges: [
          {
            id: 'e1',
            workflowDefinitionId: 'def-1',
            fromStageId: 's1',
            toStageId: 's2',
            edgeType: 'on_success',
          } as StageEdge,
        ],
      }),
    );
    useWorkflowBuilderStore.getState().updateEdgeType('e1', 'on_failure');
    expect(useWorkflowBuilderStore.getState().edges[0]!.data!.edgeType).toBe('on_failure');

    useWorkflowBuilderStore.getState().undo();
    expect(useWorkflowBuilderStore.getState().edges[0]!.data!.edgeType).toBe('on_success');
  });

  // ── State tracking ──

  it('markSaving / markSaved cycle', () => {
    useWorkflowBuilderStore.getState().markDirty();
    expect(useWorkflowBuilderStore.getState().isDirty).toBe(true);

    useWorkflowBuilderStore.getState().markSaving(true);
    expect(useWorkflowBuilderStore.getState().isSaving).toBe(true);

    useWorkflowBuilderStore.getState().markSaved();
    expect(useWorkflowBuilderStore.getState().isSaving).toBe(false);
    expect(useWorkflowBuilderStore.getState().isDirty).toBe(false);
    expect(useWorkflowBuilderStore.getState().lastSavedAt).toBeInstanceOf(Date);
  });
});
