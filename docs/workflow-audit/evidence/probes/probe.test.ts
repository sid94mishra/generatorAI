// Scratch probe — NOT part of the repo. Verifies runtime claims from the audit.
const CORE = 'C:/Users/sidmishra/Desktop/New folder (2)/GeneratorAI/packages/core';

describe('probe', () => {
  it('P1: session-scoped emit never reaches subscribeGlobal (event-driven routing is dead)', async () => {
    const { EventBus } = await import(`${CORE}/src/events/EventBus.ts`);
    const bus = new EventBus();
    const seen: string[] = [];
    bus.subscribeGlobal((e: { kind: string }) => seen.push(e.kind));
    await bus.emit('ses-1', { kind: 'stage_run.completed', data: { workflowRunId: 'r', stageRunId: 's' } } as never);
    await bus.emitGlobal({ kind: 'stage_run.skipped', data: { workflowRunId: 'r', stageRunId: 's' } } as never);
    expect(seen).toEqual(['stage_run.skipped']);
  });

  it('P2: successor launch waits for the poll tick, not the completion event', async () => {
    const M = await import(`${CORE}/__tests__/MockRepositories.ts`);
    const { EventBus } = await import(`${CORE}/src/events/EventBus.ts`);
    const { DAGScheduler } = await import(`${CORE}/src/services/DAGScheduler.ts`);
    const { WorkflowRunService } = await import(`${CORE}/src/services/WorkflowRunService.ts`);
    const runRepo = new M.MockWorkflowRunRepository();
    const stageRunRepo = new M.MockStageRunRepository();
    const stageDefRepo = new M.MockStageDefinitionRepository();
    const defRepo = new M.MockWorkflowDefinitionRepository();
    const edgeRepo = new M.MockStageEdgeRepository();
    const bus = new EventBus();
    const sched = new DAGScheduler(stageDefRepo, edgeRepo, stageRunRepo, runRepo);
    const launches: Array<{ id: string; at: number }> = [];
    const ses = {
      executeStage: async (sr: { id: string; status: string }, runId: string) => {
        launches.push({ id: sr.id, at: Date.now() });
        await stageRunRepo.claimForExecution(sr.id);
        await stageRunRepo.update(sr.id, { status: 'completed', completedAt: new Date() });
        // exactly what StageExecutionService does on success (session-scoped emit)
        await bus.emit('ses-x', { kind: 'stage_run.completed', data: { stageRunId: sr.id, workflowRunId: runId } } as never);
      },
    };
    const alloc = { releaseSession: async () => {}, releaseAll: async () => {} };
    const svc = new WorkflowRunService(runRepo, stageRunRepo, stageDefRepo, defRepo, bus, sched, ses as never, alloc as never);
    svc.setHeartbeatPolicy({ reconcileIntervalMs: 1500 });
    await defRepo.create({ id: 'd', name: 'D', version: 1, sessionMode: 'per-stage', variables: [], tags: [], createdAt: new Date(), updatedAt: new Date() });
    const mk = (id: string, order: number) => ({ id, workflowDefinitionId: 'd', name: id, order, prompts: [{ label: 'p', text: 'x', waitForCompletion: true }], variables: {}, hooks: [], createdAt: new Date() });
    await stageDefRepo.create(mk('a', 0));
    await stageDefRepo.create(mk('b', 1));
    await edgeRepo.create({ id: 'e', workflowDefinitionId: 'd', fromStageId: 'a', toStageId: 'b', edgeType: 'on_success' });
    const run = await svc.createRun({ workflowDefinitionId: 'd' });
    const t0 = Date.now();
    await svc.startRun(run.id);
    for (let i = 0; i < 60 && launches.length < 2; i++) await new Promise((r) => setTimeout(r, 100));
    svc.shutdown();
    expect(launches.length).toBe(2);
    const gap = launches[1]!.at - launches[0]!.at;
    // eslint-disable-next-line no-console
    console.log(`[probe] A launched at +${launches[0]!.at - t0}ms, B launched ${gap}ms after A`);
    expect(gap).toBeGreaterThan(1000); // waited for the 1.5s reconciler tick
  });

  it('P3: retryRun copies a completed stage; validation re-runs on it with no session and fails it', async () => {
    const M = await import(`${CORE}/__tests__/MockRepositories.ts`);
    const { EventBus } = await import(`${CORE}/src/events/EventBus.ts`);
    const { DAGScheduler } = await import(`${CORE}/src/services/DAGScheduler.ts`);
    const { WorkflowRunService } = await import(`${CORE}/src/services/WorkflowRunService.ts`);
    const { ResultValidator } = await import(`${CORE}/src/services/ResultValidator.ts`);
    const runRepo = new M.MockWorkflowRunRepository();
    const stageRunRepo = new M.MockStageRunRepository();
    const stageDefRepo = new M.MockStageDefinitionRepository();
    const defRepo = new M.MockWorkflowDefinitionRepository();
    const edgeRepo = new M.MockStageEdgeRepository();
    const bus = new EventBus();
    const sched = new DAGScheduler(stageDefRepo, edgeRepo, stageRunRepo, runRepo);
    const ses = { executeStage: async () => { /* never finishes B */ } };
    const alloc = { releaseSession: async () => {}, releaseAll: async () => {} };
    const logger = { info() {}, warn() {}, error() {}, debug() {} };
    const msgRepo = { getBySessionAndStageRunId: async () => [] };
    const rv = new ResultValidator(msgRepo as never, stageRunRepo as never, bus, logger as never);
    const svc = new WorkflowRunService(runRepo, stageRunRepo, stageDefRepo, defRepo, bus, sched, ses as never, alloc as never);
    svc.setResultValidator(rv);
    svc.setHeartbeatPolicy({ reconcileIntervalMs: 50 });
    await defRepo.create({ id: 'd', name: 'D', version: 1, sessionMode: 'per-stage', variables: [], tags: [], createdAt: new Date(), updatedAt: new Date() });
    const mk = (id: string, order: number, extra: object = {}) => ({ id, workflowDefinitionId: 'd', name: id, order, prompts: [{ label: 'p', text: 'x', waitForCompletion: true }], variables: {}, hooks: [], createdAt: new Date(), ...extra });
    await stageDefRepo.create(mk('a', 0, { resultValidation: [{ type: 'min_length', value: 10, message: 'A too short' }] }));
    await stageDefRepo.create(mk('b', 1));
    await edgeRepo.create({ id: 'e', workflowDefinitionId: 'd', fromStageId: 'a', toStageId: 'b', edgeType: 'on_success' });
    // Ancestor: A completed (with real output), B failed.
    const anc = await svc.createRun({ workflowDefinitionId: 'd' });
    const ancStages = await stageRunRepo.getByRunId(anc.id);
    const aA = ancStages.find((s: { stageDefinitionId: string }) => s.stageDefinitionId === 'a')!;
    const aB = ancStages.find((s: { stageDefinitionId: string }) => s.stageDefinitionId === 'b')!;
    await stageRunRepo.update(aA.id, { status: 'completed', sessionId: 'old-ses', outputText: 'a long and valid output', summary: 'ok' });
    await stageRunRepo.update(aB.id, { status: 'failed', error: 'boom' });
    await runRepo.updateStatus(anc.id, 'failed');
    const retried = await svc.retryRun(anc.id);
    await svc.startRun(retried.id);
    await new Promise((r) => setTimeout(r, 400));
    svc.shutdown();
    const after = await stageRunRepo.getByRunId(retried.id);
    const newA = after.find((s: { stageDefinitionId: string }) => s.stageDefinitionId === 'a')!;
    // eslint-disable-next-line no-console
    console.log(`[probe] copied stage A in retry run is now: ${newA.status} (${newA.error ?? ''})`);
    expect(newA.status).toBe('failed');
  });
});
