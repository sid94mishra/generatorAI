// ────────────────────────────────────────────────────────────────
// T8 — crash recovery (F_live_tests §1 T8, §2 F-3; `t8.mts`).
//
// `killAndRestart()` kills the current process generation mid-turn (its
// harness never answers again, its timers stop) and boots a fresh service
// graph on the same database, running `StartupRecoveryService.recover()`
// exactly as the server does at boot.
//
// CHARACTERISATION of today's engine. `// KNOWN-BUG W-xx` marks the
// assertions PHASE-03 flips.
// ────────────────────────────────────────────────────────────────

import { afterEach, describe, expect, it } from 'vitest';
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
  name: 't8-crash',
  stages: [
    { name: 'C1', prompt: 'Write the numbers 1 to 600, one per line.' },
    { name: 'C2', prompt: 'Write one line containing the token C2.' },
    // A second root makes the graph parallel, so the v1 engine resolves the
    // run to per-stage sessions (a definition has no session mode since P01;
    // a linear graph would share one conversation).
    { name: 'side', prompt: 'Write one line containing the token SIDE.' },
  ],
  edges: [['C1', 'C2']] as const,
};

describe('T8 crash recovery (current engine)', () => {
  it('recovery re-drives runs before the session allocator is rehydrated', async () => {
    engine = await createTestEngine({ script: { C1: [{ hang: true }] } });
    const run = await engine.runWorkflow(T8);
    await pendingCall(engine, 'C1');
    await engine.killAndRestart();
    const snap = await run.waitForTerminal();
    // The relaunched C1 reaches allocateSession before step 4 of recover()
    // rehydrated the allocator, and inserts a second allocation row.
    expect(snap.stages['C1']!.status).toBe('failed'); // KNOWN-BUG W-32 (boot-order race: re-drive before allocator rehydrate)
    expect(snap.stages['C1']!.error).toBe('UNIQUE constraint failed: session_allocations.workflow_run_id'); // KNOWN-BUG W-32
    expect(snap.run.status).toBe('failed'); // KNOWN-BUG W-32
  });

  it('a crash mid-turn completes the interrupted stage with empty output', async () => {
    engine = await createTestEngine({
      // Generation 0 hangs in C1's prompt; anything asked after the restart
      // gets the default replies.
      script: { C1: [{ hang: true }] },
    });
    const run = await engine.runWorkflow(T8);
    await pendingCall(engine, 'C1');
    const before = await run.snapshot();
    expect(before.stages['C1']!.status).toBe('running');

    // Stand in for the live server's checkpoint latency (see RestartOptions).
    await engine.killAndRestart({ allocatorFirst: true });
    expect(engine.generation).toBe(1);

    const snap = await run.waitForTerminal();
    expect(snap.run.status).toBe('completed');

    // No double execution: the in-flight prompt was not re-sent after restart.
    const c1Prompts = snap.calls.filter((c) => c.stageName === 'C1' && c.kind === 'prompt');
    expect(c1Prompts).toHaveLength(1);
    expect(c1Prompts[0]!.generation).toBe(0);

    // ...but the stage was then COMPLETED with nothing to show for it (F-3).
    expect(snap.stages['C1']!.status).toBe('completed'); // KNOWN-BUG W-16 (interrupted stage completes)
    expect(snap.stages['C1']!.outputText ?? '').toBe(''); // KNOWN-BUG W-16 (with empty output)
    expect(
      snap.events.some((e) => e.kind === 'harness.session_info' && e.data['infoType'] === 'durable_turn_skipped'),
    ).toBe(true); // KNOWN-BUG W-16 (the in-flight turn is skipped, not resumed or paused)

    // C2 ran after the restart, in generation 1.
    expect(snap.stages['C2']!.status).toBe('completed');
    expect(snap.calls.filter((c) => c.stageName === 'C2').every((c) => c.generation === 1)).toBe(true);
  });

  it('a crash after a settled turn replays it from the journal instead of re-prompting', async () => {
    engine = await createTestEngine({
      script: {
        C1: [
          { text: 'C1 answer: 1 2 3 ... 600, all numbers written out as requested.' },
          { on: 'summary', hang: true },
        ],
      },
    });
    const run = await engine.runWorkflow(T8);
    await pendingCall(engine, 'C1', 'summary');

    await engine.killAndRestart({ allocatorFirst: true });
    const snap = await run.waitForTerminal();
    expect(snap.run.status).toBe('completed');

    // The settled prompt turn was replayed, not re-sent.
    expect(snap.calls.filter((c) => c.stageName === 'C1' && c.kind === 'prompt')).toHaveLength(1);
    expect(snap.stages['C1']!.status).toBe('completed');
    expect(snap.stages['C1']!.outputText).toContain('C1 answer');
  });
});
