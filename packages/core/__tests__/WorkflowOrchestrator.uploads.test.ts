import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkflowOrchestrator } from '../src/services/WorkflowOrchestrator.js';
import { RunDefinitionReader } from '../src/services/definitions/RunDefinitionReader.js';
import {
  MockWorkflowDefinitionStore,
  MockWorkflowRunRepository,
  seedDefinition,
  testGraph,
} from './MockRepositories.js';

describe('WorkflowOrchestrator upload ordering', () => {
  it('awaits uploads in the final workspace before skill discovery and DAG start', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gai-orchestration-'));
    try {
      const store = new MockWorkflowDefinitionStore();
      const { versionId } = await seedDefinition(store, testGraph(['a', 'b']), 'def');
      const repo = new MockWorkflowRunRepository();
      const run = await repo.create({ id: 'run-upload', workflowDefinitionId: 'def', definitionVersionId: versionId, name: 'Audit', status: 'created', variables: {}, createdAt: new Date(), updatedAt: new Date() });
      let finishUpload!: () => void;
      const uploaded = new Promise<void>((resolve) => { finishUpload = resolve; });
      const startRun = vi.fn(async (id: string) => {
        const stored = await repo.getById(id);
        expect(stored.variables?.['__skillDirectories']).toEqual([join(dir, 'config/skills')]);
        expect(stored.variables?.['__promptDirectories']).toEqual([join(dir, 'config/prompts')]);
        expect(await readFile(join(dir, 'config/skills/audit/SKILL.md'), 'utf8')).toBe('audit skill');
      });
      const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
      const createRun = vi.fn(async () => run);
      const orchestrator = new WorkflowOrchestrator(
        { createRun, startRun } as never,
        { resolveVersionForRun: async () => versionId } as never,
        new RunDefinitionReader(store),
        {} as never,
        repo,
        { emitGlobal: async () => {}, subscribeGlobal: () => () => {} } as never,
        log as never,
        dir,
        { createWorkspace: async () => ({ id: 'ws', rootPath: dir }), getWorkingDirectory: () => join(dir, 'source'), findWorkspaceByOwner: async () => ({ rootPath: dir }) } as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        null,
      );
      const initialize = vi.fn(async () => {
        await uploaded;
        await mkdir(join(dir, 'config/skills/audit'), { recursive: true });
        await writeFile(join(dir, 'config/skills/audit/SKILL.md'), 'audit skill');
        await mkdir(join(dir, 'config/prompts'), { recursive: true });
        await writeFile(join(dir, 'config/prompts/audit.md'), 'uploaded prompt');
      });
      await orchestrator.startOrchestratedRun({ workflowDefinitionId: 'def', stageOverrides: [{ stageKey: 'b', skip: true }] }, initialize);
      await vi.waitFor(() => expect(initialize).toHaveBeenCalledWith('run-upload'));
      expect(startRun).not.toHaveBeenCalled();
      finishUpload();
      await vi.waitFor(() => expect(startRun).toHaveBeenCalledWith('run-upload'));
      // The overrides ride on the run row (`stage_overrides`), which the engine reads.
      expect(createRun).toHaveBeenCalledWith(expect.objectContaining({ stageOverrides: [{ stageKey: 'b', skip: true }] }));
      expect(log.error).not.toHaveBeenCalled();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
