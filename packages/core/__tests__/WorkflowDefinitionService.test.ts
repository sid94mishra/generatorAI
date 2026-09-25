// ────────────────────────────────────────────────────────────────
// WorkflowDefinitionService Tests  (P3.14)
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { WorkflowDefinitionService } from '../src/services/WorkflowDefinitionService.js';
import {
  MockWorkflowDefinitionRepository,
  MockStageDefinitionRepository,
  MockStageEdgeRepository,
  MockWorkflowRunRepository,
} from './MockRepositories.js';
import type { TemplateRegistry } from '../src/services/TemplateRegistry.js';
import type { WorkflowTemplate, WorkflowRun } from '@generatorai/shared';
import { ConflictError, DAGValidationError } from '@generatorai/shared';

// ── Minimal in-memory TemplateRegistry mock ──

function makeRun(id: string, workflowDefinitionId: string): WorkflowRun {
  const now = new Date();
  return {
    id,
    workflowDefinitionId,
    name: `run-${id}`,
    status: 'completed',
    sessionMode: 'auto',
    variables: {},
    createdAt: now,
    updatedAt: now,
  };
}

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
  let runRepo: MockWorkflowRunRepository;
  let templateRegistry: TemplateRegistry;

  beforeEach(() => {
    defRepo = new MockWorkflowDefinitionRepository();
    stageRepo = new MockStageDefinitionRepository();
    edgeRepo = new MockStageEdgeRepository();
    runRepo = new MockWorkflowRunRepository();
    templateRegistry = createMockTemplateRegistry();

    service = new WorkflowDefinitionService(
      defRepo,
      stageRepo,
      edgeRepo,
      templateRegistry,
      undefined, // dagScheduler
      undefined, // withTransaction
      runRepo,
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
        prompts: [{ label: 'P1', text: 'Do stuff' }],
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

    // ── Item 9 ──

    it('refuses with a 409-mapped ConflictError naming how many runs block it', async () => {
      const def = await service.createDefinition({ name: 'HasRuns' });
      await runRepo.create(makeRun('run-1', def.id));
      await runRepo.create(makeRun('run-2', def.id));

      let caught: unknown;
      try {
        await service.deleteDefinition(def.id);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ConflictError);
      expect((caught as ConflictError).message).toContain('2 runs');

      // Refused — everything is still intact.
      await expect(service.getDefinition(def.id)).resolves.toBeTruthy();
    });

    it('force:true deletes the blocking runs too', async () => {
      const def = await service.createDefinition({ name: 'ForceDelete' });
      await runRepo.create(makeRun('run-3', def.id));

      await service.deleteDefinition(def.id, { force: true });

      await expect(service.getDefinition(def.id)).rejects.toThrow();
      await expect(runRepo.getById('run-3')).rejects.toThrow();
    });

    it('deletes cleanly with no runs, unaffected by the new guard', async () => {
      const def = await service.createDefinition({ name: 'NoRuns' });
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
      // Item 8 — `addEdge` now runs the SAME validation before persisting,
      // so a self-edge never reaches storage in the first place; this
      // exercises the read-only `validateDefinition` path directly against
      // a definition with no stage repo guard in the way.
      const def = await service.createDefinition({ name: 'SelfLoop' });
      const s1 = await service.addStage({ workflowDefinitionId: def.id, name: 'Loopy' });
      await edgeRepo.create({
        id: 'self-edge-1',
        workflowDefinitionId: def.id,
        fromStageId: s1.id,
        toStageId: s1.id,
        edgeType: 'on_success',
      });

      const result = await service.validateDefinition(def.id);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Self-edge'))).toBe(true);
    });
  });

  // ── Item 8 — validate on save, not just on import ──

  describe('save-time DAG validation', () => {
    it('rejects a self-edge at addEdge time, before it is persisted', async () => {
      const def = await service.createDefinition({ name: 'SelfLoop2' });
      const s1 = await service.addStage({ workflowDefinitionId: def.id, name: 'Loopy' });

      await expect(
        service.addEdge({ workflowDefinitionId: def.id, fromStageId: s1.id, toStageId: s1.id }),
      ).rejects.toThrow(DAGValidationError);

      // Nothing was persisted — the definition is still a valid (edgeless) DAG.
      const edges = await edgeRepo.getByDefinitionId(def.id);
      expect(edges.length).toBe(0);
    });

    it('rejects a 3-stage cycle at the edge that closes it', async () => {
      const def = await service.createDefinition({ name: 'Cycle' });
      const a = await service.addStage({ workflowDefinitionId: def.id, name: 'A' });
      const b = await service.addStage({ workflowDefinitionId: def.id, name: 'B' });
      const c = await service.addStage({ workflowDefinitionId: def.id, name: 'C' });

      await service.addEdge({ workflowDefinitionId: def.id, fromStageId: a.id, toStageId: b.id });
      await service.addEdge({ workflowDefinitionId: def.id, fromStageId: b.id, toStageId: c.id });

      // A → B → C → A closes the loop.
      await expect(
        service.addEdge({ workflowDefinitionId: def.id, fromStageId: c.id, toStageId: a.id }),
      ).rejects.toThrow(DAGValidationError);

      const edges = await edgeRepo.getByDefinitionId(def.id);
      expect(edges.length).toBe(2);
    });

    it('carries structured validationErrors on the thrown error', async () => {
      const def = await service.createDefinition({ name: 'Structured' });
      const s1 = await service.addStage({ workflowDefinitionId: def.id, name: 'S1' });
      try {
        await service.addEdge({ workflowDefinitionId: def.id, fromStageId: s1.id, toStageId: s1.id });
        expect.unreachable('addEdge should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(DAGValidationError);
        const dagErr = err as DAGValidationError;
        expect(Array.isArray(dagErr.validationErrors)).toBe(true);
        expect(dagErr.validationErrors!.length).toBeGreaterThan(0);
      }
    });

    it('a valid linear DAG still saves normally', async () => {
      const def = await service.createDefinition({ name: 'StillValid' });
      const a = await service.addStage({ workflowDefinitionId: def.id, name: 'A' });
      const b = await service.addStage({ workflowDefinitionId: def.id, name: 'B' });
      const edge = await service.addEdge({ workflowDefinitionId: def.id, fromStageId: a.id, toStageId: b.id });
      expect(edge.id).toBeTruthy();
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
            name: 'Step 1', order: 0, prompts: [{ label: 'Step 1', text: 'Do step 1' }],
          },
          {
            name: 'Step 2', order: 1, prompts: [{ label: 'Step 2', text: 'Do step 2' }],
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

    // ── Item 7 ──

    it('keeps approvalRequired, retryPolicy, and timeoutMs through import (one importer, via templateStageToCreateParams)', async () => {
      const template: WorkflowTemplate = {
        id: 'gated-tmpl',
        name: 'Gated Template',
        description: 'Has an approval gate',
        category: 'custom',
        version: '1.0',
        requiresCodebase: false,
        stages: [
          {
            name: 'Risky step',
            order: 0,
            prompts: [{ label: 'Risky step', text: 'Do the risky thing' }],
            approvalRequired: true,
            retryPolicy: { maxRetries: 3, backoffMs: 1000, backoffMultiplier: 2 },
            timeoutMs: 45_000,
            condition: { type: 'on_success' },
            contextFilter: 'summary-only',
          },
        ],
        edges: [],
        variables: [
          { name: 'target', label: 'Target', type: 'string', required: true },
        ],
      } as unknown as WorkflowTemplate;
      templateRegistry.registerWorkflowTemplate(template);

      const def = await service.importFromTemplate('gated-tmpl');
      const stages = await stageRepo.getByDefinitionId(def.id);
      expect(stages.length).toBe(1);
      const stage = stages[0]!;

      expect(stage.approvalRequired).toBe(true);
      expect(stage.retryPolicy).toEqual({ maxRetries: 3, backoffMs: 1000, backoffMultiplier: 2 });
      expect(stage.timeoutMs).toBe(45_000);
      expect(stage.condition).toEqual({ type: 'on_success' });
      expect(stage.contextFilter).toBe('summary-only');

      // Definition-level fields also survive, not just the stage.
      expect(def.variables.length).toBe(1);
      expect(def.variables[0]!.name).toBe('target');
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
        prompts: [{ label: 'P1', text: 'Hello' }],
      });

      const template = await service.exportAsTemplate(def.id);
      expect(template.name).toBe('Export Me');
      expect(template.stages.length).toBe(1);
      expect(template.stages[0]!.prompts.length).toBe(1);
      expect(template.stages[0]!.prompts[0]!.label).toBe('P1');
    });
  });

  // ── Item 7 — the OTHER import path, for parity ──

  describe('importFromJSON', () => {
    it('keeps approvalRequired, retryPolicy, and timeoutMs (same mapper as importFromTemplate)', async () => {
      const result = await service.importFromJSON({
        name: 'JSON import',
        sessionMode: 'auto',
        variables: [],
        tags: [],
        skills: [],
        agents: [],
        stages: [
          {
            name: 'Gate',
            order: 0,
            prompts: [{ label: 'Gate', text: 'Do it' }],
            approvalRequired: true,
            retryPolicy: { maxRetries: 2, backoffMs: 500, backoffMultiplier: 2 },
            timeoutMs: 30_000,
          },
        ],
        edges: [],
      } as unknown as Parameters<typeof service.importFromJSON>[0]);

      expect(result.stages.length).toBe(1);
      const stage = result.stages[0]!;
      expect(stage.approvalRequired).toBe(true);
      expect(stage.retryPolicy).toEqual({ maxRetries: 2, backoffMs: 500, backoffMultiplier: 2 });
      expect(stage.timeoutMs).toBe(30_000);
    });
  });
});
