import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkflowOrchestrator } from '../src/services/WorkflowOrchestrator.js';
import { MockWorkflowRunRepository } from './MockRepositories.js';

describe('WorkflowOrchestrator upload ordering', () => {
  it('awaits uploads in the final workspace before skill discovery and DAG start', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gai-orchestration-'));
    try {
      const repo = new MockWorkflowRunRepository();
      const run = await repo.create({ id: 'run-upload', workflowDefinitionId: 'def', name: 'Audit', status: 'pending', sessionMode: 'auto', variables: {}, createdAt: new Date(), updatedAt: new Date() });
      let finishUpload!: () => void;
      const uploaded = new Promise<void>((resolve) => { finishUpload = resolve; });
      const startRun = vi.fn(async (id: string) => {
        const stored = await repo.getById(id);
        expect(stored.variables?.['__skillDirectories']).toEqual([join(dir, 'config/skills')]);
        expect(stored.variables?.['__promptDirectories']).toEqual([join(dir, 'config/prompts')]);
        expect(await readFile(join(dir, 'config/skills/audit/SKILL.md'), 'utf8')).toBe('audit skill');
      });
      const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
      const orchestrator = new WorkflowOrchestrator(
        { createRun: async () => run, startRun } as never,
        { getDefinition: async () => ({ id: 'def', variables: [], hooks: [] }) } as never,
        {} as never, repo,
        { emitGlobal: async () => {}, subscribeGlobal: () => () => {} } as never,
        log as never, dir, undefined, undefined, undefined, undefined, undefined,
        { createWorkspace: async () => ({ id: 'ws', rootPath: dir }), getWorkingDirectory: () => join(dir, 'source'), findWorkspaceByOwner: async () => ({ rootPath: dir }) } as never,
      );
      const initialize = vi.fn(async () => {
        await uploaded;
        await mkdir(join(dir, 'config/skills/audit'), { recursive: true });
        await writeFile(join(dir, 'config/skills/audit/SKILL.md'), 'audit skill');
        await mkdir(join(dir, 'config/prompts'), { recursive: true });
        await writeFile(join(dir, 'config/prompts/audit.md'), 'uploaded prompt');
      });
      await orchestrator.startOrchestratedRun({ workflowDefinitionId: 'def', stageOverrides: [{ stageIndex: 1, skip: true }] }, initialize);
      await vi.waitFor(() => expect(initialize).toHaveBeenCalledWith('run-upload'));
      expect(startRun).not.toHaveBeenCalled();
      finishUpload();
      await vi.waitFor(() => expect(startRun).toHaveBeenCalledWith('run-upload'));
      expect((await repo.getById(run.id)).variables?.['__stageOverrides']).toEqual([{ stageIndex: 1, skip: true }]);
      expect(log.error).not.toHaveBeenCalled();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
