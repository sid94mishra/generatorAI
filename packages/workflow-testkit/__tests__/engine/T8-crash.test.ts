// ────────────────────────────────────────────────────────────────
// T8 on engine v2 — crash and restart recovery (F_live_tests §1 T8, §2 F-3;
// G5 §3.10; RV-10, RV-27).
//
// `killAndRestart()` kills the generation mid-turn (its harness never
// answers again, its frames and timers are gone, the engine lock stays
// behind) and boots a new RunSupervisor on the same database, which takes
// the stale lock and recovers.
//
// Flips of the v1 characterisation: an interrupted never-replay turn PAUSES
// the stage (W-16: it used to complete with empty output); settled turns
// replay from the journal and are never re-sent; recovery reads sessions at
// bind time, so the boot-order race is gone (W-32).
// ────────────────────────────────────────────────────────────────

import { afterEach, describe, expect, it } from 'vitest';
import { AdmissionController, EngineLockedError, RunSupervisor, type WorkspaceManager } from '@generatorai/core';
import { createEngineStores, DrizzleSessionRepository, DrizzleWorkflowRunRepository } from '@generatorai/db';
import { createTestEngine, type TestEngine } from '../../src/index.js';

let engine: TestEngine | undefined;
afterEach(async () => {
  await engine?.dispose();
  engine = undefined;
});

async function pendingCall(e: TestEngine, stage: string, kind = 'prompt'): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!e.calls.some((c) => c.stageName === stage && c.kind === kind && c.outcome === 'pending')) {
    if (Date.now() > deadline) throw new Error(`no pending ${kind} call for ${stage}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const T8 = {
  name: 't8-crash-v2',
  stages: [
    { name: 'c1', prompt: 'Write the numbers 1 to 600, one per line.' },
    { name: 'c2', prompt: 'Write one line containing the token C2.', context: { mode: 'output' } },
  ],
  edges: [['c1', 'c2']] as const,
};

describe('T8 crash recovery (engine)', () => {
  it('a crash mid-turn pauses the interrupted stage (never completes it); an operator retry finishes it (W-16)', async () => {
    engine = await createTestEngine({
      script: { c1: [{ hang: true }, { text: 'C1 answer after the restart: 1 2 3 ... 600, all written out.' }] },
    });
    const run = await engine.runWorkflow(T8);
    await pendingCall(engine, 'c1');
    expect((await run.snapshot()).stages['c1']!.status).toBe('running');

    await engine.killAndRestart();
    expect(engine.generation).toBe(1);

    let snap = await run.waitForStage('c1', 'paused');
    const c1 = snap.stages['c1']!;
    expect(c1.statusReason).toBe('interrupted:process_restart_unsafe');
    expect(c1.attempts?.map((a) => `${a.status}:${a.errorCode}`)).toEqual(['interrupted:process_restart_unsafe']);
    expect(c1.outputText ?? '').toBe('');
    expect(snap.stages['c2']!.status).toBe('pending');
    snap = await run.waitFor((s) => s.run.status === 'waiting', 5_000, 'run waiting on the operator');
    // Nothing was re-sent by the recovery itself.
    expect(snap.calls.filter((c) => c.stageName === 'c1').map((c) => c.generation)).toEqual([0]);

    expect((await engine.commands.send(run.runId, { type: 'retry-stage', stageRunId: run.stageRunId('c1') })).status).toBe(202);
    snap = await run.waitForTerminal();
    expect(snap.run.status).toBe('completed');
    expect(snap.stages['c1']!.attempts?.map((a) => `${a.mode}:${a.status}`)).toEqual(['fresh:interrupted', 'resume:succeeded']);
    const c1Calls = snap.calls.filter((c) => c.stageName === 'c1');
    expect(c1Calls.map((c) => `${c.generation}:${c.kind}`)).toEqual(['0:prompt', '1:continuation']);
    expect(snap.stages['c2']!.status).toBe('completed');
    expect(snap.calls.filter((c) => c.stageName === 'c2').every((c) => c.generation === 1)).toBe(true);
  });

  it('a crash while parked for approval: the settled turn replays, it is not re-sent (F-3)', async () => {
    engine = await createTestEngine({
      script: { c1: [{ text: 'C1 answer: 1 2 3 ... 600, all numbers written out as requested.' }] },
    });
    const run = await engine.runWorkflow({ ...T8, stages: [{ ...T8.stages[0], approval: {} }, T8.stages[1]] });
    await run.waitForStage('c1', 'awaiting_input');

    await engine.killAndRestart();
    let snap = await run.snapshot();
    // The frame died; the verdict still has somewhere to go.
    expect(snap.stages['c1']!.status).toBe('awaiting_input');
    expect(snap.stages['c1']!.attempts?.map((a) => a.status)).toEqual(['aborted']);

    expect((await engine.commands.approve(run.runId, run.stageRunId('c1'), { outcome: 'approved' })).status).toBe(202);
    snap = await run.waitForTerminal();
    expect(snap.run.status).toBe('completed');
    // The resume attempt carried the verdict and replayed the settled prompt: one model call for c1.
    expect(snap.stages['c1']!.attempts?.map((a) => `${a.mode}:${a.status}`)).toEqual(['fresh:aborted', 'resume:succeeded']);
    expect(snap.calls.filter((c) => c.stageName === 'c1').map((c) => `${c.generation}:${c.kind}`)).toEqual(['0:prompt']);
    expect(snap.stages['c1']!.outputText).toContain('C1 answer');
    expect(snap.calls.find((c) => c.stageName === 'c2')!.prompt).toContain('C1 answer');
  });

  it('a tool permission lost to a crash pauses the stage (interrupted); a resume re-sends the turn, which asks again', async () => {
    const ask = { type: 'shell_exec', description: 'run the test suite' };
    engine = await createTestEngine({
      script: { c1: [{ permission: ask, text: 'never sent' }, { permission: ask, text: 'C1 finished after the restart, tests green.' }] },
    });
    const run = await engine.runWorkflow(T8, {}, { permissionMode: 'default' });
    let snap = await run.waitForStage('c1', 'awaiting_input');
    expect(snap.stages['c1']!.interruptData).toMatchObject({ kind: 'tool_permission' });

    await engine.killAndRestart();
    snap = await run.waitForStage('c1', 'paused');
    // The request died with its turn: nothing to approve, the stage waits for an operator (G5 §3.10).
    expect(snap.stages['c1']!.statusReason).toBe('interrupted');
    expect(snap.stages['c1']!.attempts?.map((a) => a.status)).toEqual(['aborted']);

    expect((await engine.commands.send(run.runId, { type: 'command', command: { command: 'resume', instanceId: run.stageRunId('c1') } })).status).toBe(202);
    snap = await run.waitForStage('c1', 'awaiting_input');
    expect(snap.stages['c1']!.interruptData).toMatchObject({ kind: 'tool_permission' });
    expect((await engine.commands.approve(run.runId, run.stageRunId('c1'), { outcome: 'approved' })).status).toBe(202);
    snap = await run.waitForTerminal();
    expect(snap.run.status).toBe('completed');
    expect(snap.stages['c1']!.attempts?.map((a) => `${a.mode}:${a.status}`)).toEqual(['fresh:aborted', 'resume:succeeded']);
    expect(snap.calls.filter((c) => c.stageName === 'c1').map((c) => `${c.generation}:${c.kind}:${c.permission ?? '-'}`)).toEqual([
      '0:prompt:-',
      '1:continuation:true',
    ]);
  });

  it('a second engine on the same database refuses to start (RV-27)', async () => {
    engine = await createTestEngine();
    const { db, services, harness } = engine;
    const second = new RunSupervisor({
      stores: createEngineStores(db),
      runRepo: new DrizzleWorkflowRunRepository(db),
      definitions: services.runDefinitionReader,
      harness,
      composer: services.sessionComposer,
      sessionRepo: new DrizzleSessionRepository(db),
      eventBus: services.eventBus,
      workspaceManager: undefined as unknown as WorkspaceManager,
      admission: new AdmissionController(),
    });
    // The first engine holds a fresh lock (default staleness 30 s).
    await engine.settle(50);
    await expect(second.start()).rejects.toBeInstanceOf(EngineLockedError);
    expect(second.hostedRuns).toEqual([]);
  });
});
