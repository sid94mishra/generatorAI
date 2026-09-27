// ────────────────────────────────────────────────────────────────
// T3 on engine v2 — failure edges, retries, precedence (F_live_tests §1
// T3/T3b; G5 §3.1–3.6).
//
// Flips of the v1 characterisation: every attempt is a `stage_attempts`
// row with its own error (W-39); a retry resumes the same conversation by
// default; only a failure-handler edge absorbs a failure (W-29); an
// unhandled failure pauses for an operator instead of failing blind; the
// attempt deadline covers every turn (W-15).
// ────────────────────────────────────────────────────────────────

import { afterEach, describe, expect, it } from 'vitest';
import { createTestEngine, type TestEngine, type Turn } from '../../src/index.js';

let engine: TestEngine | undefined;
afterEach(async () => {
  await engine?.dispose();
  engine = undefined;
});

/** A transient provider failure (an overloaded upstream). */
const overloaded = (n: number): Turn => ({ error: { message: `upstream overloaded (${n})` } });

describe('T3 failure paths (engine)', () => {
  it('retries a transient failure in the same conversation, then routes failure / completion / always', async () => {
    engine = await createTestEngine({ script: { f: [overloaded(1), overloaded(2), overloaded(3)] } });
    const run = await engine.runWorkflow({
      name: 't3-failure-edges-v2',
      stages: [
        { name: 'f', prompt: 'F', retry: { maxAttempts: 3, initialDelayMs: 100, backoffMultiplier: 2 } },
        { name: 's', prompt: 'S' },
        { name: 'rec', prompt: 'REC' },
        { name: 'oc', prompt: 'OC' },
        { name: 'al', prompt: 'AL' },
        { name: 'z', prompt: 'Z' },
      ],
      edges: [
        ['f', 's', 'success'],
        ['f', 'rec', 'failure'],
        ['f', 'oc', 'completion'],
        ['f', 'al', 'always'],
        ['rec', 'z'],
      ],
    });
    const snap = await run.waitForTerminal();

    const f = snap.stages['f']!;
    expect(f.status).toBe('failed');
    expect(f.error).toBe('upstream overloaded (3)');
    // W-39: three attempt rows, each with its own error; retries resume (G5 §3.3).
    expect(f.attempts?.map((a) => `${a.attemptNo}:${a.mode}:${a.status}:${a.errorCode}`)).toEqual([
      '1:fresh:failed:overloaded',
      '2:resume:failed:overloaded',
      '3:resume:failed:overloaded',
    ]);
    const prompts = snap.calls.filter((c) => c.stageName === 'f');
    expect(prompts).toHaveLength(3);
    expect(new Set(prompts.map((c) => c.conversationId)).size).toBe(1);
    // The resumed turns were re-sent after the notice (they never settled).
    expect(prompts[1]!.prompt).toMatch(/^The previous request for this step was interrupted/);

    expect(snap.stages['s']!.status).toBe('skipped');
    for (const n of ['rec', 'oc', 'al', 'z']) expect(snap.stages[n]!.status).toBe('completed');
    // Handled by its failure edge: the run completes.
    expect(snap.run.status).toBe('completed');
    expect(snap.events.filter((e) => e.kind === 'stage_run.retrying').length).toBe(2);
  });

  it('an `always` cleanup no longer masks an unhandled failure (W-29)', async () => {
    engine = await createTestEngine({ script: { f: [overloaded(1)] } });
    const run = await engine.runWorkflow({
      stages: [
        { name: 'f', prompt: 'F', retry: { maxAttempts: 1, initialDelayMs: 100, backoffMultiplier: 1 }, onExhausted: 'fail' },
        { name: 'cleanup', prompt: 'cleanup' },
      ],
      edges: [['f', 'cleanup', 'always']],
    });
    const snap = await run.waitForTerminal();
    expect(snap.stages['f']!.status).toBe('failed');
    expect(snap.stages['cleanup']!.status).toBe('completed');
    expect(snap.run.status).toBe('failed');
    expect(snap.events.some((e) => e.kind === 'workflow_run.failed')).toBe(true);
  });

  it('a deterministic failure is not retried; unhandled, it pauses for an operator, who fails it', async () => {
    engine = await createTestEngine({ script: { ff: [{ error: { message: 'invalid api key' } }] } });
    const run = await engine.runWorkflow({
      stages: [
        { name: 'a', prompt: 'A' },
        { name: 'ff', prompt: 'FF', retry: { maxAttempts: 3, initialDelayMs: 100, backoffMultiplier: 1 } },
        { name: 'g', prompt: 'G' },
      ],
      edges: [
        ['a', 'ff'],
        ['ff', 'g'],
      ],
    });
    let snap = await run.waitForStage('ff', 'paused');
    expect(snap.stages['ff']!.statusReason).toBe('deterministic:auth');
    expect(snap.stages['ff']!.attempts?.map((a) => a.errorCode)).toEqual(['auth']);
    snap = await run.waitFor((s) => s.run.status === 'waiting', 5_000, 'run waiting on the operator');

    const res = await engine.commands.send(run.runId, { type: 'command', command: { command: 'fail', instanceId: run.stageRunId('ff') } });
    expect(res.status).toBe(202);
    snap = await run.waitForTerminal();
    expect(snap.stages['ff']!.status).toBe('failed');
    expect(snap.stages['g']!.status).toBe('skipped');
    expect(snap.run.status).toBe('failed');
  });

  it('the attempt deadline covers every turn and fails a hung one (W-15)', async () => {
    engine = await createTestEngine({ script: { ff: [{ hang: true }] } });
    const run = await engine.runWorkflow({
      stages: [{ name: 'ff', prompt: 'FF', timeouts: { attemptMs: 1000 }, retry: { maxAttempts: 1, initialDelayMs: 100, backoffMultiplier: 1 }, onExhausted: 'fail' }],
    });
    const snap = await run.waitForTerminal();
    expect(snap.calls.map((c) => `${c.kind}:${c.outcome}`)).toEqual(['prompt:aborted']);
    expect(snap.stages['ff']!.status).toBe('failed');
    expect(snap.stages['ff']!.attempts?.map((a) => a.errorCode)).toEqual(['attempt_timeout']);
    // The turn cut short is persisted incomplete (RV-10).
    expect(snap.stages['ff']!.messages.filter((m) => m.role === 'assistant').every((m) => m.complete === false)).toBe(true);
    expect(snap.run.status).toBe('failed');
  });
});
