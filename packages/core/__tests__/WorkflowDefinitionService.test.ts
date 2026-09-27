// ────────────────────────────────────────────────────────────────
// WorkflowDefinitionService Tests — definitions as versioned v2 graphs
// (P01 WP-1.7).
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import type { WorkflowTemplate } from '@generatorai/workflow-spec';
import {
  ConflictError,
  InsufficientScopeError,
  RevisionConflictError,
  ValidationError,
  WorkflowValidationError,
} from '@generatorai/shared';
import { WorkflowDefinitionService } from '../src/services/WorkflowDefinitionService.js';
import type { TemplateRegistry } from '../src/services/TemplateRegistry.js';
import { MockWorkflowDefinitionStore, testGraph } from './MockRepositories.js';

const ADMIN = { canEditCommands: true };
const USER = { canEditCommands: false };
const PROJECT_ID = '0b6c2f0e-5d1a-4c55-9a55-2f1f0a3c9e11';

/** A stage whose output rule runs a program (a command-bearing field). */
const scriptRule = (command: string) => ({
  key: 'b',
  output: { rules: [{ type: 'custom_script', command, args: [] }] },
});

function templateRegistry(templates: WorkflowTemplate[]): TemplateRegistry {
  const byId = new Map(templates.map((t) => [t.id, t]));
  return { getWorkflowTemplate: (id: string) => byId.get(id) } as unknown as TemplateRegistry;
}

describe('WorkflowDefinitionService', () => {
  let store: MockWorkflowDefinitionStore;
  let service: WorkflowDefinitionService;

  beforeEach(() => {
    store = new MockWorkflowDefinitionStore();
    service = new WorkflowDefinitionService(
      store,
      templateRegistry([{ id: 'tpl-1', category: 'general', graph: testGraph(['plan', 'build'], [['plan', 'build']]) } as WorkflowTemplate]),
    );
  });

  describe('createFromSpec', () => {
    it('creates a draft without a version by default', async () => {
      const record = await service.createFromSpec(testGraph(['a', 'b'], [['a', 'b']]), USER);
      expect(record.status).toBe('draft');
      expect(record.revision).toBe(1);
      expect(record.currentVersionId).toBeNull();
      expect(record.graph.stages.map((s) => s.key)).toEqual(['a', 'b']);
    });

    it('publishes version 1 when asked', async () => {
      const record = await service.createFromSpec(testGraph(['a']), { ...USER, status: 'published' });
      expect(record.status).toBe('published');
      expect(record.currentVersionId).not.toBeNull();
      expect(await service.listVersions(record.id)).toHaveLength(1);
    });

    it('refuses a command-bearing field without admin:settings', async () => {
      const graph = testGraph(['a', scriptRule('lint')], [['a', 'b']]);
      await expect(service.createFromSpec(graph, USER)).rejects.toThrow(InsufficientScopeError);
      await expect(service.createFromSpec(graph, USER)).rejects.toThrow(/admin:settings/);
      await expect(service.createFromSpec(graph, ADMIN)).resolves.toMatchObject({ status: 'draft' });
    });
  });

  describe('saveGraph', () => {
    it('replaces the graph and bumps the revision', async () => {
      const created = await service.createFromSpec(testGraph(['a']), USER);
      const saved = await service.saveGraph(created.id, testGraph(['a', 'b'], [['a', 'b']]), created.revision, USER);
      expect(saved.revision).toBe(created.revision + 1);
      expect(saved.graph.stages).toHaveLength(2);
    });

    it('throws RevisionConflictError carrying the current record on a stale revision', async () => {
      const created = await service.createFromSpec(testGraph(['a']), USER);
      await service.saveGraph(created.id, testGraph(['a', 'b'], [['a', 'b']]), created.revision, USER);
      const err = await service.saveGraph(created.id, testGraph(['x']), created.revision, USER).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RevisionConflictError);
      expect((err as RevisionConflictError).current.revision).toBe(created.revision + 1);
    });

    it('refuses adding or changing a command without admin:settings, but allows keeping one', async () => {
      const created = await service.createFromSpec(testGraph(['a']), USER);
      await expect(
        service.saveGraph(created.id, testGraph(['a', scriptRule('lint')], [['a', 'b']]), created.revision, USER),
      ).rejects.toThrow(/admin:settings/);

      const withCmd = await service.saveGraph(created.id, testGraph(['a', scriptRule('lint')], [['a', 'b']]), created.revision, ADMIN);
      // Same command, other edits: allowed.
      const renamed = testGraph(['a', scriptRule('lint')], [['a', 'b']], { name: 'renamed' });
      await expect(service.saveGraph(created.id, renamed, withCmd.revision, USER)).resolves.toMatchObject({
        revision: withCmd.revision + 1,
      });
      // Changed command: refused.
      await expect(
        service.saveGraph(created.id, testGraph(['a', scriptRule('rm')], [['a', 'b']]), withCmd.revision + 1, USER),
      ).rejects.toThrow(InsufficientScopeError);
    });

    it('rejects an invalid graph with WorkflowValidationError', async () => {
      const created = await service.createFromSpec(testGraph(['a']), USER);
      const bad = { ...testGraph(['a']), edges: [{ from: 'a', to: 'nope', on: 'success' }] };
      await expect(service.saveGraph(created.id, bad, created.revision, USER)).rejects.toThrow(WorkflowValidationError);
    });
  });

  describe('publish', () => {
    it('reuses the published version for identical content and appends one for new content', async () => {
      const created = await service.createFromSpec(testGraph(['a']), USER);
      const first = await service.publish(created.id);
      expect(first.status).toBe('published');
      expect(first.hasUnpublishedChanges).toBe(false);

      const again = await service.publish(created.id);
      expect(again.currentVersionId).toBe(first.currentVersionId);
      expect(await service.listVersions(created.id)).toHaveLength(1);

      await service.saveGraph(created.id, testGraph(['a', 'b'], [['a', 'b']]), again.revision, USER);
      const second = await service.publish(created.id);
      expect(second.currentVersionId).not.toBe(first.currentVersionId);
      expect(await service.listVersions(created.id)).toHaveLength(2);
    });
  });

  describe('resolveVersionForRun', () => {
    it('refuses a normal run of a draft; a test run pins a deduplicated test version', async () => {
      const created = await service.createFromSpec(testGraph(['a']), USER);
      await expect(service.resolveVersionForRun(created.id)).rejects.toThrow(ConflictError);

      const v1 = await service.resolveVersionForRun(created.id, { testRun: true });
      expect(await service.resolveVersionForRun(created.id, { testRun: true })).toBe(v1);
      expect((await service.getVersion(created.id, v1)).kind).toBe('test');

      await service.saveGraph(created.id, testGraph(['a', 'b'], [['a', 'b']]), created.revision, USER);
      expect(await service.resolveVersionForRun(created.id, { testRun: true })).not.toBe(v1);
    });

    it('runs the current published version, and never an archived definition', async () => {
      const published = await service.createFromSpec(testGraph(['a']), { ...USER, status: 'published' });
      expect(await service.resolveVersionForRun(published.id)).toBe(published.currentVersionId);

      await service.setArchived(published.id, true);
      await expect(service.resolveVersionForRun(published.id)).rejects.toThrow(/archived/);
    });
  });

  describe('delete', () => {
    it('hard-deletes a definition nothing ran', async () => {
      const created = await service.createFromSpec(testGraph(['a']), USER);
      expect(await service.delete(created.id)).toEqual({ deleted: true });
      await expect(service.get(created.id)).rejects.toThrow();
    });

    it('archives a definition with runs', async () => {
      const created = await service.createFromSpec(testGraph(['a']), USER);
      store.runCounts.set(created.id, 2);
      expect(await service.delete(created.id)).toEqual({ archived: true, runs: 2 });
      expect((await service.get(created.id)).archivedAt).not.toBeNull();
    });
  });

  describe('import', () => {
    it('rejects an invalid graph with the validation issues', async () => {
      const err = await service.import({ ...testGraph(['a']), edges: [{ from: 'a', to: 'missing', on: 'success' }] }, USER).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(WorkflowValidationError);
      expect((err as WorkflowValidationError).issues.length).toBeGreaterThan(0);
    });

    it('applies name / projectId overrides and publishes on request', async () => {
      const record = await service.import(testGraph(['a']), { ...USER, name: 'Imported', projectId: PROJECT_ID, publish: true });
      expect(record.graph.workflow.name).toBe('Imported');
      expect(record.graph.workflow.projectId).toBe(PROJECT_ID);
      expect(record.status).toBe('published');
    });

    it('creates a draft from a template, tagged with its id', async () => {
      const record = await service.importTemplate('tpl-1', USER);
      expect(record.status).toBe('draft');
      expect(record.graph.stages.map((s) => s.key)).toEqual(['plan', 'build']);
      expect(record.graph.workflow.tags).toContain('template:tpl-1');
    });

    it('rejects an unknown template', async () => {
      await expect(service.importTemplate('nope', USER)).rejects.toThrow(ValidationError);
    });
  });
});
