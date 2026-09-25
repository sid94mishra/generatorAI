// ────────────────────────────────────────────────────────────────
// T1 on engine v2 — fan-out / fan-in (F_live_tests §1 T1).
//
// The v1 characterisation (`current-engine/T1`) pins three KNOWN-BUGs:
// every hop waits for a 3 s poll (B-1), every stage pays a context and a
// summary turn (W-49), and a short answer triggers an output-retry turn
// (W-48). On v2 the join runs on the actor's hop, context rides in the first
// prompt, and no retry turn exists.
// ────────────────────────────────────────────────────────────────

import { afterEach, describe, expect, it } from 'vitest';
import { createTestEngine, type TestEngine } from '../../src/index.js';

let engine: TestEngine | undefined;
afterEach(async () => {
  await engine?.dispose();
  engine = undefined;
});

const BRANCHES = ['b1', 'b2', 'b3', 'b4', 'b5'];

const T1 = {
  name: 't1-fanout-v2',
  stages: [
    { name: 'start', prompt: 'Write one line containing the token START.' },
    ...BRANCHES.map((b) => ({ name: b, prompt: `Write one line containing the token ${b}.` })),
    { name: 'join', prompt: 'Write one line containing the token JOIN.' },
    { name: 'final', prompt: 'Write one line containing the token FINAL.' },
  ],
  edges: [...BRANCHES.map((b) => ['start', b] as const), ...BRANCHES.map((b) => [b, 'join'] as const), ['join', 'final'] as const],
};

describe('T1 fan-out / fan-in (engine)', () => {
  it('runs the branches concurrently, joins once after all of them, and completes', async () => {
    engine = await createTestEngine({
      script: Object.fromEntries(BRANCHES.map((b) => [b, [{ text: `${b} branch output: this line is long enough to be kept.`, delayMs: 150 }]])),
    });
    const run = await engine.runWorkflow(T1);
    const snap = await run.waitForTerminal();

    expect(snap.run.status).toBe('completed');
    for (const path of snap.instanceOrder) expect(snap.stages[path]!.status).toBe('completed');

    // The branches overlapped (maxParallel 4 by default: four at once, then the fifth).
    const branchPrompts = snap.calls.filter((c) => BRANCHES.includes(c.stageName) && c.kind === 'prompt');
    expect(branchPrompts).toHaveLength(5);
    const firstEnd = Math.min(...branchPrompts.map((c) => c.endedAt!));
    expect(branchPrompts.filter((c) => c.startedAt < firstEnd).length).toBeGreaterThanOrEqual(4);

    // The join ran once, after every branch finished; its first prompt carries all five, fenced.
    const joinCalls = snap.calls.filter((c) => c.stageName === 'join');
    // A summary turn only because 'final' reads the join's summary (context.mode summary); the leaf pays none.
    expect(joinCalls.map((c) => c.kind)).toEqual(['prompt', 'summary']);
    expect(snap.calls.filter((c) => c.stageName === 'final').map((c) => c.kind)).toEqual(['prompt']);
    expect(joinCalls[0]!.startedAt).toBeGreaterThanOrEqual(Math.max(...branchPrompts.map((c) => c.endedAt!)));
    expect(joinCalls[0]!.prompt).toContain('<generatorai:stage-context trust="untrusted">');
    for (const b of BRANCHES) expect(joinCalls[0]!.prompt).toContain(`## Completed stage "${b}"`);

    // One attempt per instance, recorded as a row; one conversation each.
    for (const path of snap.instanceOrder) {
      expect(snap.stages[path]!.attempts?.map((a) => `${a.mode}:${a.status}`)).toEqual(['fresh:succeeded']);
    }
    expect(new Set(snap.calls.map((c) => c.conversationId)).size).toBe(snap.instanceOrder.length);
    // Terminal event contract (RV-5).
    expect(snap.events.some((e) => e.kind === 'workflow_run.completed' && e.data['workflowRunId'] === run.runId)).toBe(true);
  });

  it('spends no context, output-retry or leaf summary turns (W-48, W-49)', async () => {
    engine = await createTestEngine({ script: { start: [{ text: 'OK-START' }] } });
    const run = await engine.runWorkflow({ stages: [{ name: 'start', prompt: 'Say OK.' }] });
    const snap = await run.waitForTerminal();
    expect(snap.run.status).toBe('completed');
    expect(snap.calls.map((c) => c.kind)).toEqual(['prompt']);
    expect(snap.stages['start']!.outputText).toBe('OK-START');
    const assistant = snap.stages['start']!.messages.filter((m) => m.role === 'assistant');
    expect(assistant.map((m) => [m.turnRole, m.complete])).toEqual([['prompt', true]]);
  });
});
