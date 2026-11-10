// cancel_background_agent — an orchestrator stops a worker it spawned by mistake (found live: a worker bound to an
// agent that pins another model kept running beside its replacement, with no way to stop it).
import { describe, it, expect, vi } from 'vitest';
import { buildOrchestratorToolSet } from '../index.js';
import type { OrchestratorService } from '../../../services/orchestrator/OrchestratorService.js';

function cancelTool(tasks: Array<{ taskId: string; taskName: string; status: string }>) {
  const service = {
    listBackgroundAgents: vi.fn(async () => tasks),
    cancelBackgroundAgent: vi.fn(async () => ({ cancelledBy: 'orchestrator', cancelledAt: 1 })),
    getConfig: () => ({ maxWorkers: 8, maxReviewRounds: 2 }),
  };
  const tool = buildOrchestratorToolSet({ orchestratorService: service as unknown as OrchestratorService, parentId: 'parent-1' })
    .find((t) => t.name === 'cancel_background_agent')!;
  return { tool, service };
}

describe('cancel_background_agent', () => {
  it('stops a running worker of this orchestrator, attributed to it', async () => {
    const { tool, service } = cancelTool([{ taskId: 'w1', taskName: 'a', status: 'running' }]);
    expect(await tool.handler!({ taskId: 'w1' })).toMatchObject({ ok: true, status: 'cancelled' });
    expect(service.listBackgroundAgents).toHaveBeenCalledWith('parent-1');
    expect(service.cancelBackgroundAgent).toHaveBeenCalledWith('w1', 'orchestrator');
  });

  it('refuses a worker that is not its own, and one that already finished', async () => {
    const { tool, service } = cancelTool([{ taskId: 'w1', taskName: 'a', status: 'completed' }]);
    expect(await tool.handler!({ taskId: 'other' })).toMatchObject({ ok: false });
    expect(await tool.handler!({ taskId: 'w1' })).toMatchObject({ ok: false, error: expect.stringContaining('not running') });
    expect(service.cancelBackgroundAgent).not.toHaveBeenCalled();
  });
});
