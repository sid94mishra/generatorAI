// ────────────────────────────────────────────────────────────────
// T1 — fan-out / fan-in (F_live_tests §1 T1, §5).
//
// CHARACTERISATION of today's engine: these tests pin current behaviour,
// bugs included. Every assertion that encodes a bug is marked
// `// KNOWN-BUG W-xx`; PHASE-03 flips (or deletes) exactly those lines.
// ────────────────────────────────────────────────────────────────

import { afterEach, describe, expect, it } from 'vitest';
import { createTestEngine, type TestEngine } from '../../src/index.js';

let engine: TestEngine | undefined;
afterEach(async () => {
  await engine?.dispose();
  engine = undefined;
});

const BRANCHES = ['B1', 'B2', 'B3', 'B4', 'B5'];

const T1 = {
  name: 't1-fanout',
  sessionMode: 'auto',
  stages: [
    { name: 'start', prompt: 'Write one line containing the token START.' },
    ...BRANCHES.map((b) => ({ name: b, prompt: `Write one line containing the token ${b}.` })),
    { name: 'join', prompt: 'Write one line containing the token JOIN.' },
    { name: 'final', prompt: 'Write one line containing the token FINAL.' },
  ],
  edges: [
    ...BRANCHES.map((b) => ['start', b] as const),
    ...BRANCHES.map((b) => [b, 'join'] as const),
    ['join', 'final'] as const,
  ],
};

describe('T1 fan-out / fan-in (current engine)', () => {
  it('runs the five branches concurrently, joins once, and completes', async () => {
    engine = await createTestEngine({
      script: Object.fromEntries(
        BRANCHES.map((b) => [b, [{ text: `${b} branch output: this line is long enough to be kept.`, delayMs: 150 }]]),
      ),
    });
    const run = await engine.runWorkflow(T1);
    const snap = await run.waitForTerminal();

    expect(snap.run.status).toBe('completed');
    for (const name of snap.stageOrder) expect(snap.stages[name]!.status).toBe('completed');

    // auto mode resolves to per-stage for a DAG with parallelism (FEAT-1).
    expect(snap.run.sessionMode).toBe('per-stage');

    // The branches overlapped: every branch's prompt turn started before any
    // of them finished. (Row timestamps have one-second precision, so the
    // harness call times are the only usable clock here.)
    const branchPrompts = snap.calls.filter((c) => BRANCHES.includes(c.stageName) && c.kind === 'prompt');
    expect(branchPrompts).toHaveLength(5);
    const lastStart = Math.max(...branchPrompts.map((c) => c.startedAt));
    const firstEnd = Math.min(...branchPrompts.map((c) => c.endedAt!));
    expect(lastStart).toBeLessThan(firstEnd);

    // The join ran once, after every branch had finished its last turn.
    const joinCalls = snap.calls.filter((c) => c.stageName === 'join');
    expect(joinCalls.filter((c) => c.kind === 'prompt')).toHaveLength(1);
    const branchEnd = Math.max(...snap.calls.filter((c) => BRANCHES.includes(c.stageName)).map((c) => c.endedAt!));
    expect(joinCalls[0]!.startedAt).toBeGreaterThanOrEqual(branchEnd);

    // The join's context turn carries all five predecessors.
    const joinContext = snap.calls.find((c) => c.stageName === 'join' && c.kind === 'context')!;
    for (const b of BRANCHES) expect(joinContext.prompt).toContain(`## Completed Stage: "${b}"`);
  });

  it('spends a context + prompt + summary model turn on every non-root stage', async () => {
    engine = await createTestEngine();
    const run = await engine.runWorkflow(T1);
    const snap = await run.waitForTerminal();
    expect(snap.run.status).toBe('completed');

    const kindsOf = (stage: string) => snap.calls.filter((c) => c.stageName === stage).map((c) => c.kind);
    expect(kindsOf('start')).toEqual(['prompt', 'summary']); // KNOWN-BUG W-49 (a root stage pays a summary turn)
    for (const stage of [...BRANCHES, 'join', 'final']) {
      expect(kindsOf(stage)).toEqual(['context', 'prompt', 'summary']); // KNOWN-BUG W-49 (3 turns per stage, O-3)
    }
    // Every stage got its own conversation.
    expect(new Set(snap.calls.map((c) => c.conversationId)).size).toBe(snap.stageOrder.length);
  });

  it('a short answer triggers an extra output-retry turn whose reply is appended to the output', async () => {
    engine = await createTestEngine({ script: { start: [{ text: 'OK-START' }] } });
    const run = await engine.runWorkflow({ stages: [{ name: 'start', prompt: 'Say OK.' }] });
    const snap = await run.waitForTerminal();
    expect(snap.run.status).toBe('completed');
    const kinds = snap.calls.map((c) => c.kind);
    expect(kinds).toEqual(['prompt', 'output_retry', 'summary']); // KNOWN-BUG W-48 (F-10: extra turn for < 50 chars)
    expect(snap.stages['start']!.outputText).toBe('OK-START\nSummary: start produced its scripted output.'); // KNOWN-BUG W-48 (retry reply pollutes outputText)
  });
});
