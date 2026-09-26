// ────────────────────────────────────────────────────────────────
// T5 on engine v2 — approve / reject / request changes / pause / cancel
// (F_live_tests §1 T5, §2 F-1, F-2; G5 §4.5, §5.9).
//
// Flips of the v1 characterisation: a requested revision runs through the
// same journalled turn path, is persisted, validated and handed to the
// successor (F-2, W-46); a pause mid-turn writes the desired state first and
// sends nothing after it, and the resume finishes the work (F-1, W-01); a
// cancel dispatches nothing after the cancel write (B-3) and releases the
// run's sessions (B-15).
// ────────────────────────────────────────────────────────────────

import { afterEach, describe, expect, it } from 'vitest';
import { createTestEngine, type TestEngine, type Turn } from '../../src/index.js';

let engine: TestEngine | undefined;
afterEach(async () => {
  await engine?.dispose();
  engine = undefined;
});

const P1_ANSWER = 'P1 alpha bravo charlie delta echo foxtrot golf hotel india.';

const HITL = {
  name: 't5-hitl-v2',
  stages: [
    { name: 'p1', prompt: 'Write one line containing the token P1.', approval: {} },
    { name: 'p2', prompt: 'Write one line containing the token P2.', context: { mode: 'output' } },
  ],
  edges: [['p1', 'p2']] as const,
};

async function pendingCall(e: TestEngine, stage: string, kind = 'prompt'): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!e.calls.some((c) => c.stageName === stage && c.kind === kind && c.outcome === 'pending')) {
    if (Date.now() > deadline) throw new Error(`no pending ${kind} call for ${stage}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('T5 human in the loop (engine)', () => {
  it('approve advances the DAG; a second approve and an approve of a non-parked instance are refused', async () => {
    engine = await createTestEngine({ script: { p1: [{ text: P1_ANSWER }] } });
    const run = await engine.runWorkflow(HITL);
    let snap = await run.waitForStage('p1', 'awaiting_input');
    expect(snap.stages['p1']!.interruptData).toMatchObject({ kind: 'stage_completion_review', reviewRound: 1, output: P1_ANSWER });
    expect(snap.stages['p2']!.status).toBe('pending');
    // Parked for a human: no lease, so nothing can reap it (B-2).
    expect((snap.stages['p1']!.row as unknown as Record<string, unknown>)['lease_owner']).toBeNull();

    expect((await engine.commands.approve(run.runId, run.stageRunId('p2'), { outcome: 'approved' })).status).toBe(409);
    const p1 = run.stageRunId('p1');
    expect((await engine.commands.approve(run.runId, p1, { outcome: 'approved' })).status).toBe(202);
    snap = await run.waitForTerminal();
    expect(snap.run.status).toBe('completed');
    expect((await engine.commands.approve(run.runId, p1, { outcome: 'approved' })).status).toBe(409);
    expect(snap.stages['p2']!.status).toBe('completed');
  });

  it('reject fails the stage without a retry and skips its successor', async () => {
    engine = await createTestEngine({ script: { p1: [{ text: P1_ANSWER }] } });
    const run = await engine.runWorkflow(HITL);
    await run.waitForStage('p1', 'awaiting_input');
    expect((await engine.commands.approve(run.runId, run.stageRunId('p1'), { outcome: 'rejected', reason: 'no' })).status).toBe(202);
    const snap = await run.waitForTerminal();
    expect(snap.stages['p1']!.status).toBe('failed');
    expect(snap.stages['p1']!.statusReason).toBe('rejected');
    expect(snap.stages['p1']!.attempts?.map((a) => `${a.status}:${a.errorCode}`)).toEqual(['failed:rejected_by_human']);
    expect(snap.stages['p2']!.status).toBe('skipped');
    expect(snap.run.status).toBe('failed');
  });

  it('request changes runs a journalled revision that is persisted and reaches the successor (F-2, W-46)', async () => {
    engine = await createTestEngine({ script: { p1: [{ text: P1_ANSWER }, { text: `${P1_ANSWER} REVISED` }] } });
    const run = await engine.runWorkflow(HITL);
    await run.waitForStage('p1', 'awaiting_input');
    const p1 = run.stageRunId('p1');
    const res = await engine.commands.approve(run.runId, p1, { outcome: 'changes_requested', reason: 'Append the word REVISED to your line.' });
    expect(res.status).toBe(202);

    let snap = await run.waitFor(
      (s) => s.stages['p1']!.status === 'awaiting_input' && (s.stages['p1']!.interruptData as { reviewRound?: number })?.reviewRound === 2,
      10_000,
      'p1 parked for review round 2',
    );
    const revision = snap.calls.find((c) => c.stageName === 'p1' && c.kind === 'approval_feedback')!;
    expect(revision.prompt).toBe('Append the word REVISED to your line.');
    expect((snap.stages['p1']!.interruptData as { output?: string }).output).toBe(`${P1_ANSWER} REVISED`);
    const assistant = snap.stages['p1']!.messages.filter((m) => m.role === 'assistant');
    expect(assistant.map((m) => [m.turnRole, m.content, m.complete])).toEqual([
      ['prompt', P1_ANSWER, true],
      ['approval_feedback', `${P1_ANSWER} REVISED`, true],
    ]);

    expect((await engine.commands.approve(run.runId, p1, { outcome: 'approved' })).status).toBe(202);
    snap = await run.waitForTerminal();
    expect(snap.run.status).toBe('completed');
    expect(snap.stages['p1']!.outputText).toBe(`${P1_ANSWER} REVISED`);
    const p2Prompt = snap.calls.find((c) => c.stageName === 'p2' && c.kind === 'prompt')!;
    expect(p2Prompt.prompt).toContain('REVISED');
  });
});

describe('T5 pause / cancel (engine)', () => {
  it('a pause mid-turn stops the stage with nothing sent after it; resume finishes the work (F-1, W-01)', async () => {
    engine = await createTestEngine({
      script: { l1: [{ hang: true }, { text: 'L1 finished its numbered list after the resume, as asked.' }] },
    });
    const run = await engine.runWorkflow({
      name: 't5-pause-v2',
      stages: [
        { name: 'l1', prompt: 'Write the numbers 1 to 600, one per line.' },
        { name: 'l2', prompt: 'Write one line containing the token L2.' },
      ],
      edges: [['l1', 'l2']],
    });
    await pendingCall(engine, 'l1');
    const pauseAt = Date.now();
    await engine.commands.pause(run.runId);

    let snap = await run.waitFor((s) => s.stages['l1']!.status === 'paused' && s.run.status === 'paused', 10_000, 'l1 paused');
    await engine.settle(200);
    snap = await run.snapshot();
    expect(snap.stages['l1']!.status).toBe('paused');
    expect(snap.calls.filter((c) => c.stageName === 'l1').map((c) => `${c.kind}:${c.outcome}`)).toEqual(['prompt:aborted']);
    // Nothing was sent after the pause (a call in the same millisecond is the one that was paused).
    expect(snap.calls.every((c) => c.startedAt <= pauseAt)).toBe(true);
    expect(snap.stages['l1']!.attempts?.map((a) => a.status)).toEqual(['aborted']);
    expect(snap.stages['l2']!.status).toBe('pending');

    await engine.commands.resume(run.runId);
    snap = await run.waitForTerminal();
    expect(snap.run.status).toBe('completed');
    const l1 = snap.stages['l1']!;
    expect(l1.outputText).toBe('L1 finished its numbered list after the resume, as asked.');
    expect(l1.attempts?.map((a) => `${a.mode}:${a.status}`)).toEqual(['fresh:aborted', 'resume:succeeded']);
    // The resumed attempt re-sent the interrupted turn in the same conversation.
    const l1Calls = snap.calls.filter((c) => c.stageName === 'l1');
    expect(l1Calls.map((c) => c.kind)).toEqual(['prompt', 'continuation']);
    expect(new Set(l1Calls.map((c) => c.conversationId)).size).toBe(1);
    expect(snap.stages['l2']!.status).toBe('completed');
  });

  it('cancel stops every live instance with nothing dispatched after it, and releases the sessions (B-3, B-15)', async () => {
    const hang: Turn[] = [{ hang: true }];
    engine = await createTestEngine({ script: { k1: hang, k2: hang, k3: hang } });
    const run = await engine.runWorkflow({
      name: 't5-cancel-v2',
      stages: [
        { name: 'root', prompt: 'root' },
        { name: 'k1', prompt: 'K1' },
        { name: 'k2', prompt: 'K2' },
        { name: 'k3', prompt: 'K3' },
        { name: 'after', prompt: 'after' },
      ],
      edges: [
        ['root', 'k1'],
        ['root', 'k2'],
        ['root', 'k3'],
        ['k1', 'after'],
        ['k2', 'after'],
        ['k3', 'after'],
      ],
    });
    for (const k of ['k1', 'k2', 'k3']) await pendingCall(engine, k);
    const cancelAt = Date.now();
    await engine.commands.cancel(run.runId);
    const snap = await run.waitForTerminal();
    await engine.settle(200);
    const after = await run.snapshot();

    expect(snap.run.status).toBe('cancelled');
    expect(after.stages['root']!.status).toBe('completed');
    for (const k of ['k1', 'k2', 'k3', 'after']) expect(after.stages[k]!.status).toBe('cancelled');
    expect(engine.calls.filter((c) => c.startedAt > cancelAt)).toEqual([]);
    for (const k of ['k1', 'k2', 'k3']) expect(after.stages[k]!.attempts?.map((a) => a.status)).toEqual(['aborted']);
    expect(after.sessions.every((s) => s.status === 'closed')).toBe(true);
    expect(after.events.some((e) => e.kind === 'workflow_run.cancelled')).toBe(true);
  });
});
