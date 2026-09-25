// ────────────────────────────────────────────────────────────────
// T5 — approve / reject / request changes / pause / cancel / retry
// (F_live_tests §1 T5, §2 F-1, F-2, F-11, F-15).
//
// CHARACTERISATION of today's engine. `// KNOWN-BUG W-xx` marks the
// assertions PHASE-03 flips.
// ────────────────────────────────────────────────────────────────

import { afterEach, describe, expect, it } from 'vitest';
import { createTestEngine, type RunHandle, type TestEngine, type Turn } from '../../src/index.js';

let engine: TestEngine | undefined;
afterEach(async () => {
  await engine?.dispose();
  engine = undefined;
});

const P1_ANSWER = 'P1 alpha bravo charlie delta echo foxtrot golf hotel india.';

const HITL = {
  name: 't5-hitl',
  stages: [
    { name: 'P1', prompt: 'Write one line containing the token P1.', approval: {} },
    { name: 'P2', prompt: 'Write one line containing the token P2.' },
  ],
  edges: [['P1', 'P2']] as const,
};

/** Wait until the harness has a pending call for `stage` (a hung turn). */
async function pendingCall(e: TestEngine, stage: string, kind = 'prompt'): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!e.calls.some((c) => c.stageName === stage && c.kind === kind && c.outcome === 'pending')) {
    if (Date.now() > deadline) throw new Error(`no pending ${kind} call for ${stage}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('T5 human in the loop (current engine)', () => {
  it('approve advances the DAG; a second approve and an approve of a non-parked stage are 409', async () => {
    engine = await createTestEngine({ script: { P1: [{ text: P1_ANSWER }] } });
    const run = await engine.runWorkflow(HITL);
    let snap = await run.waitForStage('P1', 'awaiting_input');
    expect(snap.stages['P1']!.outputText).toBe(P1_ANSWER);
    expect(snap.stages['P2']!.status).toBe('pending');

    // P2 is not parked.
    expect((await engine.commands.approve(run.runId, run.stageRunId('P2'), { outcome: 'approved' })).status).toBe(409);

    const p1 = run.stageRunId('P1');
    expect((await engine.commands.approve(run.runId, p1, { outcome: 'approved' })).status).toBe(202);
    expect((await engine.commands.approve(run.runId, p1, { outcome: 'approved' })).status).toBe(409);

    snap = await run.waitForTerminal();
    expect(snap.run.status).toBe('completed');
    expect(snap.stages['P1']!.status).toBe('completed');
    expect(snap.stages['P2']!.status).toBe('completed');
  });

  it('reject fails the stage without retry and skips its successor', async () => {
    engine = await createTestEngine({ script: { P1: [{ text: P1_ANSWER }] } });
    const run = await engine.runWorkflow(HITL);
    await run.waitForStage('P1', 'awaiting_input');
    const res = await engine.commands.approve(run.runId, run.stageRunId('P1'), { outcome: 'rejected', reason: 'no' });
    expect(res.status).toBe(202);
    const snap = await run.waitForTerminal();
    expect(snap.stages['P1']!.status).toBe('failed');
    expect(snap.stages['P1']!.retryCount).toBe(0);
    expect(snap.stages['P1']!.error).toBe('Stage "P1" was rejected by the reviewer: no');
    expect(snap.stages['P2']!.status).toBe('skipped');
    expect(snap.run.status).toBe('failed');
  });

  it('request changes runs a revision turn whose reply is lost', async () => {
    engine = await createTestEngine({
      script: { P1: [{ text: P1_ANSWER }, { text: `${P1_ANSWER} REVISED` }] },
    });
    const run = await engine.runWorkflow(HITL);
    await run.waitForStage('P1', 'awaiting_input');
    const p1 = run.stageRunId('P1');
    const res = await engine.commands.approve(run.runId, p1, {
      outcome: 'changes_requested',
      followUpPrompt: 'Append the word REVISED to your line.',
    });
    expect(res.status).toBe(202);

    // The revision turn runs and the stage re-parks for round 2.
    let snap = await run.waitFor(
      (s) => s.stages['P1']!.status === 'awaiting_input' && (s.stages['P1']!.interruptData as { reviewRound?: number })?.reviewRound === 2,
      10_000,
      'P1 parked for review round 2',
    );
    const revision = snap.calls.find((c) => c.stageName === 'P1' && c.kind === 'follow_up')!;
    expect(revision.prompt).toBe('Append the word REVISED to your line.');
    expect(revision.response).toBe(`${P1_ANSWER} REVISED`);

    // ...but its reply was never merged, persisted or streamed (F-2).
    expect(snap.stages['P1']!.outputText).toBe(P1_ANSWER); // KNOWN-BUG W-46 (revision reply not merged into outputText)
    const assistant = snap.stages['P1']!.messages.filter((m) => m.role === 'assistant').map((m) => m.content);
    expect(assistant).not.toContain(`${P1_ANSWER} REVISED`); // KNOWN-BUG W-46 (revision reply not persisted)
    const feedback = snap.stages['P1']!.messages.find((m) => m.metadata?.['isApprovalFeedback'] === true);
    expect(feedback?.content).toBe('Append the word REVISED to your line.');

    expect((await engine.commands.approve(run.runId, p1, { outcome: 'approved' })).status).toBe(202);
    snap = await run.waitForTerminal();
    expect(snap.run.status).toBe('completed');
    // P2 was handed the pre-revision output.
    const p2Context = snap.calls.find((c) => c.stageName === 'P2' && c.kind === 'context')!;
    expect(p2Context.prompt).not.toContain('REVISED'); // KNOWN-BUG W-46
  });
});

describe('T5 manual interrupt (testkit helper)', () => {
  it('parks a running stage in awaiting_input with the given data, and approve answers it', async () => {
    engine = await createTestEngine({ script: { M1: [{ hang: true }] } });
    const run = await engine.runWorkflow({ name: 't5-interrupt', stages: [{ name: 'M1', prompt: 'Write one line.' }], edges: [] });
    await pendingCall(engine, 'M1');
    const m1 = run.stageRunId('M1');
    expect((await engine.commands.interrupt(run.runId, m1, { type: 'manual', reason: 'check' })).status).toBe(202);
    const snap = await run.waitForStage('M1', 'awaiting_input');
    expect(snap.stages['M1']!.interruptData).toMatchObject({ type: 'manual', reason: 'check' });
    expect((await engine.commands.approve(run.runId, m1, { outcome: 'approved' })).status).toBe(202);
    await engine.commands.cancel(run.runId);
  });
});

describe('T5 plan-mode stage records its harness (WP-1.4)', () => {
  it('files the plan under the configured harness, not a guessed copilot', async () => {
    engine = await createTestEngine({ script: { PL: [{ text: '# Plan\n1. Do the thing.' }] } });
    const { definitionId } = await engine.importDefinition({
      name: 't5-plan-harness',
      stages: [
        {
          name: 'PL',
          prompt: 'Plan it.',
          approval: {},
          session: { harnessType: 'claude-agent', defaultAgentMode: 'plan' },
        },
      ],
      edges: [],
    });
    const run = await engine.runWorkflow({ definitionId });
    await run.waitForStage('PL', 'awaiting_input');
    const rows = engine.sqlite.prepare('SELECT harness_type FROM plan_documents WHERE stage_run_id = ?').all(run.stageRunId('PL')) as Array<{ harness_type: string }>;
    expect(rows.map((r) => r.harness_type)).toEqual(['claude-agent']);
    await engine.commands.cancel(run.runId);
  });
});

describe('T5 pause / cancel (current engine)', () => {
  it('pausing mid-turn completes the stage with empty output; resume never re-runs it', async () => {
    engine = await createTestEngine({ script: { L1: [{ hang: true }] } });
    const run = await engine.runWorkflow({
      name: 't5-pause',
      stages: [
        { name: 'L1', prompt: 'Write the numbers 1 to 600, one per line.' },
        { name: 'L2', prompt: 'Write one line containing the token L2.' },
      ],
      edges: [['L1', 'L2']],
    });
    await pendingCall(engine, 'L1');
    const pauseAt = Date.now();
    await engine.commands.pause(run.runId);

    let snap = await run.waitFor((s) => s.stages['L1']!.status === 'completed', 10_000, 'L1 completed after pause');
    expect(snap.run.status).toBe('paused');
    const l1 = snap.calls.filter((c) => c.stageName === 'L1');
    expect(l1.map((c) => `${c.kind}:${c.outcome}`)).toEqual(['prompt:aborted', 'summary:replied']); // KNOWN-BUG W-01 (summary turn sent after the pause)
    expect(l1[1]!.startedAt).toBeGreaterThanOrEqual(pauseAt); // KNOWN-BUG W-01
    expect(snap.stages['L1']!.status).toBe('completed'); // KNOWN-BUG W-01 (paused stage completes)
    expect(snap.stages['L1']!.outputText ?? '').toBe(''); // KNOWN-BUG W-01 (with empty output)

    await engine.commands.resume(run.runId);
    snap = await run.waitForTerminal();
    expect(snap.run.status).toBe('completed');
    expect(snap.calls.filter((c) => c.stageName === 'L1' && c.kind === 'prompt')).toHaveLength(1); // KNOWN-BUG W-01 (never re-run)
    expect(snap.stages['L2']!.status).toBe('completed');
  });

  it('cancel cancels the run and every non-terminal stage', async () => {
    const hang: Turn[] = [{ hang: true }];
    engine = await createTestEngine({ script: { K1: hang, K2: hang, K3: hang } });
    const run = await engine.runWorkflow({
      name: 't5-cancel',
      stages: [
        { name: 'root', prompt: 'root' },
        { name: 'K1', prompt: 'K1' },
        { name: 'K2', prompt: 'K2' },
        { name: 'K3', prompt: 'K3' },
        { name: 'after', prompt: 'after' },
      ],
      edges: [
        ['root', 'K1'],
        ['root', 'K2'],
        ['root', 'K3'],
        ['K1', 'after'],
        ['K2', 'after'],
        ['K3', 'after'],
      ],
    });
    for (const k of ['K1', 'K2', 'K3']) await pendingCall(engine, k);
    const cancelAt = Date.now();
    await engine.commands.cancel(run.runId);
    const snap = await run.waitForTerminal();
    await engine.settle();

    expect(snap.run.status).toBe('cancelled');
    expect(snap.stages['root']!.status).toBe('completed');
    for (const k of ['K1', 'K2', 'K3', 'after']) expect((await run.snapshot()).stages[k]!.status).toBe('cancelled');
    // The aborted turns resolve and each stage frame carries on into its
    // summary turn while the cancel is still in progress (O-9); the turn
    // then fails because cancel destroyed the conversation underneath it.
    const summariesAfterCancel = engine.calls.filter(
      (c) => c.kind === 'summary' && c.startedAt >= cancelAt && ['K1', 'K2', 'K3'].includes(c.stageName),
    );
    expect(summariesAfterCancel.map((c) => c.stageName).sort()).toEqual(['K1', 'K2', 'K3']); // KNOWN-BUG W-01 (turns dispatched after cancel began)
  });
});

describe('T5 retries (current engine)', () => {
  /** FF fails in the first run only; every later run's FF answers. */
  function failFirstFF(): (key: { stageName: string }) => Turn[] | undefined {
    let seen = 0;
    return (key) => (key.stageName === 'FF' && seen++ === 0 ? [{ error: { message: 'first' } }] : undefined);
  }

  async function failedRun(e: TestEngine): Promise<RunHandle> {
    const run = await e.runWorkflow({
      name: 't5-retry',
      stages: [
        { name: 'A', prompt: 'A' },
        { name: 'FF', prompt: 'FF', retry: { maxAttempts: 1, initialDelayMs: 100, backoffMultiplier: 1 } },
      ],
      edges: [['A', 'FF']],
    });
    await run.waitForTerminal();
    return run;
  }

  it('run retry creates a new run that copies completed stages and re-runs the failed one', async () => {
    engine = await createTestEngine({ script: failFirstFF() });
    const run = await failedRun(engine);
    expect((await run.snapshot()).run.status).toBe('failed');

    const callsBefore = engine.calls.length;
    const retryId = await engine.commands.retryRun(run.runId);
    expect(retryId).not.toBe(run.runId);
    const retried = await (await engine.handle(retryId)).waitForTerminal();
    expect(retried.run.ancestorRunId).toBe(run.runId);
    expect(retried.run.status).toBe('completed');
    expect(retried.stages['A']!.status).toBe('completed');
    const newCalls = engine.calls.slice(callsBefore);
    expect(newCalls.some((c) => c.stageName === 'A' && c.kind === 'prompt')).toBe(false);
    expect(newCalls.some((c) => c.stageName === 'FF' && c.kind === 'prompt')).toBe(true);
  });

  it('retrying a completed run throws a plain Error; the same failed run can be retried twice', async () => {
    engine = await createTestEngine({ script: failFirstFF() });
    const run = await failedRun(engine);

    const r1 = await engine.commands.retryRun(run.runId);
    const r2 = await engine.commands.retryRun(run.runId);
    expect(r1).not.toBe(r2); // KNOWN-BUG W-12 (no guard or idempotency on run retry; F-15)

    const done = await (await engine.handle(r1)).waitForTerminal();
    expect(done.run.status).toBe('completed');
    await (await engine.handle(r2)).waitForTerminal();
    const err = await engine.commands.retryRun(r1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).constructor).toBe(Error); // KNOWN-BUG W-12 (plain Error → HTTP 502 UNKNOWN_ERROR, F-15)
    expect((err as Error).message).toMatch(/current status is 'completed'/);
  });

  it('stage retry on a terminal run re-executes without validation and leaves the run failed', async () => {
    engine = await createTestEngine();
    const run = await engine.runWorkflow({
      stages: [
        {
          name: 'V',
          prompt: 'V',
          output: { rules: [{ type: 'contains', value: 'PURPLE-0000', message: 'purple' }] },
        },
      ],
    });
    let snap = await run.waitForTerminal();
    expect(snap.stages['V']!.status).toBe('failed');
    expect(snap.run.status).toBe('failed');

    await engine.commands.retryStage(run.runId, run.stageRunId('V'));
    snap = await run.waitFor((s) => s.stages['V']!.status === 'completed', 10_000, 'V completed after stage retry');
    await engine.settle();
    snap = await run.snapshot();
    expect(snap.stages['V']!.status).toBe('completed'); // KNOWN-BUG W-12 (validation skipped; rule still cannot pass)
    expect(snap.stages['V']!.retryCount).toBe(1);
    expect(snap.run.status).toBe('failed'); // KNOWN-BUG W-12 (run left failed with a stale error)
    expect(snap.run.error).toContain('V (Validation failed');
  });
});
