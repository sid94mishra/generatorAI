// ────────────────────────────────────────────────────────────────
// WorkflowDefinitionService Tests  (P3.14)
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { WorkflowDefinitionService } from '../src/services/WorkflowDefinitionService.js';
import {
  MockWorkflowDefinitionRepository,
  MockStageDefinitionRepository,
  MockStageEdgeRepository,
} from './MockRepositories.js';
import type { TemplateRegistry } from '../src/services/TemplateRegistry.js';
import type { WorkflowTemplate } from '@generatorai/shared';

// ── Minimal in-memory TemplateRegistry mock ──

function createMockTemplateRegistry(): TemplateRegistry {
  const store = new Map<string, WorkflowTemplate>();
  return {
    registerWorkflowTemplate(t: WorkflowTemplate) { store.set(t.id, t); },
    getWorkflowTemplate(id: string) { return store.get(id); },
    getAllWorkflowTemplates() { return [...store.values()]; },
    getTemplateCount() { return store.size; },
    loadWorkflowTemplates: async () => {},
  } as unknown as TemplateRegistry;
}

describe('WorkflowDefinitionService', () => {
  let service: WorkflowDefinitionService;
  let defRepo: MockWorkflowDefinitionRepository;
  let stageRepo: MockStageDefinitionRepository;
  let edgeRepo: MockStageEdgeRepository;
  let templateRegistry: TemplateRegistry;

  beforeEach(() => {
    defRepo = new MockWorkflowDefinitionRepository();
    stageRepo = new MockStageDefinitionRepository();
    edgeRepo = new MockStageEdgeRepository();
    templateRegistry = createMockTemplateRegistry();

    service = new WorkflowDefinitionService(
      defRepo,
      stageRepo,
      edgeRepo,
      templateRegistry,
    );
  });

  // ── Definition CRUD ──

  describe('createDefinition', () => {
    it('should create a definition with default version 1', async () => {
      const def = await service.createDefinition({
        name: 'My Workflow',
        description: 'A test workflow',
      });
      expect(def.name).toBe('My Workflow');
      expect(def.version).toBe(1);
      expect(def.sessionMode).toBe('auto');
    });

    it('should persist the definition', async () => {
      const def = await service.createDefinition({ name: 'Persist' });
      const fetched = await service.getDefinition(def.id);
      expect(fetched.name).toBe('Persist');
    });
  });

  describe('getDefinitionWithStages', () => {
    it('should return definition with stages and edges', async () => {
      const def = await service.createDefinition({ name: 'With Stages' });
      const s1 = await service.addStage({
        workflowDefinitionId: def.id,
        name: 'Stage 1',
        prompts: [{ label: 'P1', text: 'Do stuff', waitForCompletion: true }],
      });
      const s2 = await service.addStage({
        workflowDefinitionId: def.id,
        name: 'Stage 2',
      });
      await service.addEdge({
        workflowDefinitionId: def.id,
        fromStageId: s1.id,
        toStageId: s2.id,
      });

      const full = await service.getDefinitionWithStages(def.id);
      expect(full.stages.length).toBe(2);
      expect(full.edges.length).toBe(1);
    });
  });

  describe('listDefinitions', () => {
    it('should list all definitions', async () => {
      await service.createDefinition({ name: 'A' });
      await service.createDefinition({ name: 'B' });
      const all = await service.listDefinitions();
      expect(all.length).toBe(2);
    });
  });

  describe('updateDefinition', () => {
    it('should increment version on update', async () => {
      const def = await service.createDefinition({ name: 'Versioned' });
      expect(def.version).toBe(1);

      const updated = await service.updateDefinition(def.id, { name: 'V2' });
      expect(updated.version).toBe(2);
      expect(updated.name).toBe('V2');
    });
  });

  describe('deleteDefinition', () => {
    it('should cascade-delete stages, edges, and definition', async () => {
      const def = await service.createDefinition({ name: 'ToDelete' });
      const s1 = await service.addStage({ workflowDefinitionId: def.id, name: 'S1' });
      const s2 = await service.addStage({ workflowDefinitionId: def.id, name: 'S2' });
      await service.addEdge({
        workflowDefinitionId: def.id,
        fromStageId: s1.id,
        toStageId: s2.id,
      });

      await service.deleteDefinition(def.id);
      await expect(service.getDefinition(def.id)).rejects.toThrow();
    });
  });

  // ── Stage CRUD ──

  describe('addStage', () => {
    it('should auto-assign order', async () => {
      const def = await service.createDefinition({ name: 'Ordered' });
      const s1 = await service.addStage({ workflowDefinitionId: def.id, name: 'First' });
      const s2 = await service.addStage({ workflowDefinitionId: def.id, name: 'Second' });
      expect(s1.order).toBe(0);
      expect(s2.order).toBe(1);
    });

    it('should accept explicit order', async () => {
      const def = await service.createDefinition({ name: 'Explicit' });
      const s = await service.addStage({
        workflowDefinitionId: def.id,
        name: 'Custom',
        order: 5,
      });
      expect(s.order).toBe(5);
    });
  });

  describe('deleteStage', () => {
    it('should delete the stage and its edges', async () => {
      const def = await service.createDefinition({ name: 'DelStage' });
      const s1 = await service.addStage({ workflowDefinitionId: def.id, name: 'S1' });
      const s2 = await service.addStage({ workflowDefinitionId: def.id, name: 'S2' });
      await service.addEdge({
        workflowDefinitionId: def.id,
        fromStageId: s1.id,
        toStageId: s2.id,
      });

      await service.deleteStage(s1.id);

      // Stage gone
      await expect(stageRepo.getById(s1.id)).rejects.toThrow();
      // Edges involving s1 should be gone
      const edges = await edgeRepo.getByDefinitionId(def.id);
      expect(edges.length).toBe(0);
    });
  });

  describe('reorderStages', () => {
    it('should reorder stage indices', async () => {
      const def = await service.createDefinition({ name: 'Reorder' });
      const s1 = await service.addStage({ workflowDefinitionId: def.id, name: 'First' });
      const s2 = await service.addStage({ workflowDefinitionId: def.id, name: 'Second' });

      await service.reorderStages(def.id, [s2.id, s1.id]);
      const stages = await stageRepo.getByDefinitionId(def.id);
      expect(stages[0]!.id).toBe(s2.id);
      expect(stages[1]!.id).toBe(s1.id);
    });
  });

  // ── Edge CRUD ──

  describe('addEdge', () => {
    it('should default to on_success edge type', async () => {
      const def = await service.createDefinition({ name: 'E' });
      const s1 = await service.addStage({ workflowDefinitionId: def.id, name: 'A' });
      const s2 = await service.addStage({ workflowDefinitionId: def.id, name: 'B' });
      const edge = await service.addEdge({
        workflowDefinitionId: def.id,
        fromStageId: s1.id,
        toStageId: s2.id,
      });
      expect(edge.edgeType).toBe('on_success');
    });
  });

  describe('deleteEdge', () => {
    it('should remove the edge', async () => {
      const def = await service.createDefinition({ name: 'DE' });
      const s1 = await service.addStage({ workflowDefinitionId: def.id, name: 'A' });
      const s2 = await service.addStage({ workflowDefinitionId: def.id, name: 'B' });
      const edge = await service.addEdge({
        workflowDefinitionId: def.id,
        fromStageId: s1.id,
        toStageId: s2.id,
      });
      await service.deleteEdge(edge.id);
      const edges = await edgeRepo.getByDefinitionId(def.id);
      expect(edges.length).toBe(0);
    });
  });

  // ── DAG Validation ──

  describe('validateDefinition', () => {
    it('should validate a valid linear DAG', async () => {
      const def = await service.createDefinition({ name: 'Valid' });
      const s1 = await service.addStage({ workflowDefinitionId: def.id, name: 'A' });
      const s2 = await service.addStage({ workflowDefinitionId: def.id, name: 'B' });
      await service.addEdge({
        workflowDefinitionId: def.id,
        fromStageId: s1.id,
        toStageId: s2.id,
      });

      const result = await service.validateDefinition(def.id);
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should detect self-edges', async () => {
      const def = await service.createDefinition({ name: 'SelfLoop' });
      const s1 = await service.addStage({ workflowDefinitionId: def.id, name: 'Loopy' });
      await service.addEdge({
        workflowDefinitionId: def.id,
        fromStageId: s1.id,
        toStageId: s1.id,
      });

      const result = await service.validateDefinition(def.id);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Self-edge'))).toBe(true);
    });
  });

  // ── Template Import ──

  describe('importFromTemplate', () => {
    it('should create a definition from a template', async () => {
      const template: WorkflowTemplate = {
        id: 'test-tmpl',
        name: 'Test Template',
        description: 'A template',
        category: 'custom',
        version: '1.0',
        requiresCodebase: false,
        stages: [
          {
            name: 'Step 1', order: 0, prompts: [{ label: 'Step 1', text: 'Do step 1', waitForCompletion: true }],
          },
          {
            name: 'Step 2', order: 1, prompts: [{ label: 'Step 2', text: 'Do step 2', waitForCompletion: true }],
          },
        ],
        edges: [{ fromStageIndex: 0, toStageIndex: 1, edgeType: 'on_success' }],
        variables: [],
      } as unknown as WorkflowTemplate;
      templateRegistry.registerWorkflowTemplate(template);

      const def = await service.importFromTemplate('test-tmpl');
      expect(def.name).toBe('Test Template');
      expect(def.tags).toContain('imported');

      // Should have stages
      const stages = await stageRepo.getByDefinitionId(def.id);
      expect(stages.length).toBe(2);
      expect(stages[0]!.name).toBe('Step 1');
    });

    it('should throw for unknown template', async () => {
      await expect(service.importFromTemplate('nope')).rejects.toThrow(/not found/);
    });
  });

  // ── Template Export ──

  describe('exportAsTemplate', () => {
    it('should export a definition as a template', async () => {
      const def = await service.createDefinition({
        name: 'Export Me',
        description: 'For export',
      });
      await service.addStage({
        workflowDefinitionId: def.id,
        name: 'S1',
        prompts: [{ label: 'P1', text: 'Hello', waitForCompletion: true }],
      });

      const template = await service.exportAsTemplate(def.id);
      expect(template.name).toBe('Export Me');
      expect(template.stages.length).toBe(1);
      expect(template.stages[0]!.prompts.length).toBe(1);
      expect(template.stages[0]!.prompts[0]!.label).toBe('P1');
    });
  });
});
