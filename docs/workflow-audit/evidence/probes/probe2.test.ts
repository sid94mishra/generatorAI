// Scratch probe 2 — cancel-vs-retry race and HITL-resume heartbeat reap.
const CORE = 'C:/Users/sidmishra/Desktop/New folder (2)/GeneratorAI/packages/core';

function makeHarness() {
  const calls: string[] = [];
  const pending = new Map<string, (e: Error) => void>();
  return {
    calls,
    onConversationEvent: () => () => {},
    async createConversation() {},
    async resumeConversation() {},
    async destroyConversation() { await new Promise((r) => setTimeout(r, 50)); /* real teardown takes time */ },
    async sendPrompt() {},
    // Claude/Copilot semantics: an aborted turn REJECTS.
    sendPromptAndWait(conv: string) {
      calls.push(`send:${conv}`);
      return new Promise((_res, rej) => pending.set(conv, rej));
    },
    async abortConversation(conv: string) {
      calls.push(`abort:${conv}`);
      pending.get(conv)?.(new Error('sendPromptAndWait aborted by caller'));
      pending.delete(conv);
    },
  };
}

describe('probe2', () => {
  it('P5: cancelling a running stage triggers retryStage, which resurrects and re-executes it', async () => {
    const M = await import(`${CORE}/__tests__/MockRepositories.ts`);
    const { EventBus } = await import(`${CORE}/src/events/EventBus.ts`);
    const { StageExecutionService } = await import(`${CORE}/src/services/StageExecutionService.ts`);
    const stageRunRepo = new M.MockStageRunRepository();
    const stageDefRepo = new M.MockStageDefinitionRepository();
    const harness = makeHarness();
    const session = { id: 'ses-1', conversationId: 'conv-1', name: 's', status: 'active', tags: [], createdAt: new Date(), updatedAt: new Date() };
    const alloc = {
      allocateSession: async () => session,
      releaseSession: async () => {},
      releaseAll: async () => {},
      getSessionById: async () => session,
    };
    const msgRepo = { create: async (m: unknown) => m, getBySessionAndStageRunId: async () => [], getBySessionId: async () => [] };
    const hooks = { executePhase: async () => ({ shouldContinue: true, mergedResult: {} }) };
    const svc = new StageExecutionService(stageRunRepo, stageDefRepo, msgRepo as never, harness as never, new EventBus(), alloc as never, hooks as never);
    await stageDefRepo.create({ id: 'sd', workflowDefinitionId: 'd', name: 'S', order: 0, prompts: [{ label: 'p', text: 'do work', waitForCompletion: true }], variables: {}, hooks: [], createdAt: new Date() });
    await stageRunRepo.create({ id: 'sr', workflowRunId: 'run', stageDefinitionId: 'sd', name: 'S', status: 'pending', currentStep: 0, totalSteps: 1, retryCount: 0, version: 0, createdAt: new Date() });

    void svc.executeStage(await stageRunRepo.getById('sr'), 'run', 'per-stage').catch(() => {});
    for (let i = 0; i < 50 && !harness.calls.includes('send:conv-1'); i++) await new Promise((r) => setTimeout(r, 20));
    await svc.cancelStage('sr');
    const afterCancel = (await stageRunRepo.getById('sr')).status;
    await new Promise((r) => setTimeout(r, 3600)); // DEFAULT_RETRY_POLICY backoff = 3000ms
    const later = await stageRunRepo.getById('sr');
    // eslint-disable-next-line no-console
    console.log(`[probe] status right after cancelStage=${afterCancel}; 3.6s later=${later.status} retryCount=${later.retryCount}; harness calls=${JSON.stringify(harness.calls)}`);
    expect(afterCancel).toBe('cancelled');
    expect(later.status).not.toBe('cancelled');
    expect(harness.calls.filter((c) => c.startsWith('send:')).length).toBe(2);
  }, 15000);

  it('P4: a stage resumed from awaiting_input is reaped as heartbeat-stale by the reconciler', async () => {
    const M = await import(`${CORE}/__tests__/MockRepositories.ts`);
    const { EventBus } = await import(`${CORE}/src/events/EventBus.ts`);
    const { DAGScheduler } = await import(`${CORE}/src/services/DAGScheduler.ts`);
    const { WorkflowRunService } = await import(`${CORE}/src/services/WorkflowRunService.ts`);
    const { HitlService } = await import(`${CORE}/src/services/HitlService.ts`);
    const runRepo = new M.MockWorkflowRunRepository();
    const stageRunRepo = new M.MockStageRunRepository();
    // Mirror DrizzleStageRunRepository.interrupt / resumeFromInterrupt (status + interruptData only).
    Object.assign(stageRunRepo, {
      async interrupt(id: string, data: unknown) { await stageRunRepo.update(id, { status: 'awaiting_input', interruptData: data }); },
      async resumeFromInterrupt(id: string, next: 'running' | 'pending' = 'running') {
        const r = await stageRunRepo.getById(id); if (r.status !== 'awaiting_input') return false;
        await stageRunRepo.update(id, { status: next, interruptData: undefined }); return true;
      },
    });
    const stageDefRepo = new M.MockStageDefinitionRepository();
    const defRepo = new M.MockWorkflowDefinitionRepository();
    const edgeRepo = new M.MockStageEdgeRepository();
    const bus = new EventBus();
    const sched = new DAGScheduler(stageDefRepo, edgeRepo, stageRunRepo, runRepo);
    const ses = { executeStage: async () => {}, abortStage: async () => {} };
    const alloc = { releaseSession: async () => {}, releaseAll: async () => {} };
    const svc = new WorkflowRunService(runRepo, stageRunRepo, stageDefRepo, defRepo, bus, sched, ses as never, alloc as never);
    // Production policy scaled down 100x: beat 100ms, stale after 300ms, tick 30ms.
    svc.setHeartbeatPolicy({ heartbeatIntervalMs: 100, staleMultiplier: 3, reconcileIntervalMs: 30 });
    const hitl = new HitlService(stageRunRepo, bus);
    await defRepo.create({ id: 'd', name: 'D', version: 1, sessionMode: 'per-stage', variables: [], tags: [], createdAt: new Date(), updatedAt: new Date() });
    await stageDefRepo.create({ id: 'a', workflowDefinitionId: 'd', name: 'a', order: 0, prompts: [], variables: {}, hooks: [], createdAt: new Date() });
    const run = await svc.createRun({ workflowDefinitionId: 'd' });
    await runRepo.updateStatus(run.id, 'running');
    const [sr] = await stageRunRepo.getByRunId(run.id);
    // Stage was running and beating; last beat just now.
    await stageRunRepo.update(sr!.id, { status: 'running', heartbeatAt: new Date() });
    await svc.redriveRun(run.id);
    // Tool-permission gate: stage parks awaiting a human (heartbeat writes are gated to queued/running).
    const decision = hitl.interrupt(sr!.id, run.id, { kind: 'tool_permission' });
    await new Promise((r) => setTimeout(r, 600)); // human takes "a while" (> stale window)
    const whileParked = (await stageRunRepo.getById(sr!.id)).status;
    await hitl.resume(sr!.id, run.id, { approved: true });
    await decision;
    await new Promise((r) => setTimeout(r, 90)); // < one heartbeat interval (100ms)
    const after = await stageRunRepo.getById(sr!.id);
    svc.shutdown();
    // eslint-disable-next-line no-console
    console.log(`[probe] parked=${whileParked}; after approval=${after.status} (${after.error ?? ''})`);
    expect(whileParked).toBe('awaiting_input');
    expect(after.status).toBe('failed');
  });
});
