// Whole-run regressions of the final review (ENGINE-R1..R4, R7, R8, R10):
// the approval gate, the journal replay of a resumed attempt, and recovery
// of an attempt whose desired state was written before the process died.

import { afterEach, describe, expect, it } from 'vitest';
import { createTestEngine, type TestEngine } from '../../src/index.js';

let engine: TestEngine | undefined;
afterEach(async () => {
  await engine?.dispose();
  engine = undefined;
});

async function pendingCall(e: TestEngine, stage: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!e.calls.some((c) => c.stageName === stage && c.outcome === 'pending')) {
    if (Date.now() > deadline) throw new Error(`no pending call for ${stage}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const reviewRound = (s: { stages: Record<string, { interruptData?: unknown; status: string }> }, name: string) =>
  (s.stages[name]!.interruptData as { reviewRound?: number } | null)?.reviewRound;

describe('the approval gate', () => {
  it('R1: a verdict given after a crash at review round 2 approves the REVISED output', async () => {
    const A = 'P1 alpha bravo charlie delta echo foxtrot golf hotel india.';
    engine = await createTestEngine({ script: { p1: [{ text: A }, { text: `${A} REVISED` }] } });
    const run = await engine.runWorkflow({
      name: 'carried-round',
      stages: [
        { name: 'p1', prompt: 'Write one line containing the token P1.', approval: {} },
        { name: 'p2', prompt: 'Write one line containing the token P2.', context: { mode: 'output' } },
      ],
      edges: [['p1', 'p2']],
    });
    await run.waitForStage('p1', 'awaiting_input');
    const p1 = run.stageRunId('p1');
    expect((await engine.commands.approve(run.runId, p1, { outcome: 'changes_requested', reason: 'Append REVISED.' })).status).toBe(202);
    await run.waitFor((s) => s.stages['p1']!.status === 'awaiting_input' && reviewRound(s, 'p1') === 2, 10_000, 'round 2');
    await engine.killAndRestart();
    expect((await engine.commands.approve(run.runId, p1, { outcome: 'approved' })).status).toBe(202);
    const snap = await run.waitForTerminal();
    expect(snap.stages['p1']!.outputText).toBe(`${A} REVISED`);
    expect(snap.calls.find((c) => c.stageName === 'p2' && c.kind === 'prompt')?.prompt).toContain('REVISED');
  });

  it('R2: an approval that lands while the gate is being announced completes the stage', async () => {
    engine = await createTestEngine({ script: { p1: [{ text: 'P1 answer line with enough words to pass.' }] } });
    const bus = engine.services.eventBus as unknown as { emit: (id: string, e: { kind: string }) => Promise<void> };
    const orig = bus.emit.bind(bus);
    let fired = false;
    let runRef: { runId: string; stageRunId(p: string): string } | undefined;
    bus.emit = async (id, e) => {
      if (e.kind === 'stage_run.awaiting_input' && !fired && runRef) {
        fired = true;
        await engine!.commands.approve(runRef.runId, runRef.stageRunId('p1'), { outcome: 'approved' });
        await new Promise((res) => setTimeout(res, 300));
      }
      return orig(id, e);
    };
    const run = await engine.runWorkflow({
      name: 'park-race',
      stages: [
        { name: 'p1', prompt: 'Write one line containing the token P1.', approval: {} },
        { name: 'p2', prompt: 'Write one line containing the token P2.' },
      ],
      edges: [['p1', 'p2']],
    });
    runRef = run;
    const snap = await run.waitForTerminal();
    expect(fired).toBe(true);
    expect(snap.run.status).toBe('completed');
    expect(snap.stages['p1']!.attempts?.map((a) => a.status)).toEqual(['succeeded']);
  });
});

describe('a desired state written, then the process died (R3, R4)', () => {
  const WF = {
    name: 'crash',
    stages: [
      { name: 'c1', prompt: 'Write one line.' },
      { name: 'c2', prompt: 'Write another line.' },
    ],
    edges: [['c1', 'c2']] as const,
  };

  it('R3: a cancel mid-turn, then a crash: recovery finishes the cancel', async () => {
    engine = await createTestEngine({ script: { c1: [{ hang: true }] } });
    const run = await engine.runWorkflow(WF);
    await pendingCall(engine, 'c1');
    (engine.harness as unknown as { kill(): void }).kill();
    expect((await engine.commands.send(run.runId, { type: 'command', command: { command: 'cancel' } })).status).toBe(202);
    await engine.killAndRestart();
    const snap = await run.waitForTerminal();
    expect(snap.run.status).toBe('cancelled');
  });

  it('R4: pause(interrupt) mid-turn, a crash, then resume: the stage runs again', async () => {
    engine = await createTestEngine({ script: { c1: [{ hang: true }, { text: 'C1 after resume' }] } });
    const run = await engine.runWorkflow(WF);
    await pendingCall(engine, 'c1');
    (engine.harness as unknown as { kill(): void }).kill();
    expect((await engine.commands.send(run.runId, { type: 'command', command: { command: 'pause', mode: 'interrupt' } })).status).toBe(202);
    await engine.killAndRestart();
    expect((await engine.commands.send(run.runId, { type: 'command', command: { command: 'resume' } })).status).toBe(202);
    const snap = await run.waitForTerminal();
    expect(snap.run.status).toBe('completed');
  });
});

describe('the journal replay of a resumed attempt', () => {
  it('R7: a settled operator turn is replayed by a later resume attempt', async () => {
    engine = await createTestEngine({
      script: { c1: [{ hang: true }, { text: 'PROMPT ANSWER one two three four five six.' }, { text: 'OPERATOR ANSWER one two three four five six.' }] },
    });
    const run = await engine.runWorkflow({ name: 'operator', stages: [{ name: 'c1', prompt: 'Write a line.', approval: {} }], edges: [] });
    await pendingCall(engine, 'c1');
    await engine.killAndRestart();
    await run.waitForStage('c1', 'paused');
    const id = run.stageRunId('c1');
    const r = await engine.commands.send(run.runId, { type: 'command', command: { command: 'retry', instanceId: id, mode: 'resume', promptOverride: 'Rewrite it starting with OPERATOR.' } });
    expect(r.status).toBe(202);
    await run.waitForStage('c1', 'awaiting_input');
    await engine.killAndRestart();
    expect((await engine.commands.approve(run.runId, id, { outcome: 'approved' })).status).toBe(202);
    const snap = await run.waitForTerminal();
    expect(snap.stages['c1']!.outputText).toContain('OPERATOR ANSWER');
  });

  it('R8: a requested revision of a json stage reaches outputData', async () => {
    const SCHEMA = { type: 'object', properties: { severity: { type: 'string', enum: ['low', 'high'] } }, required: ['severity'], additionalProperties: false };
    engine = await createTestEngine({
      script: {
        triage: [
          { text: 'Submitted.', submit: { severity: 'low' } },
          { on: 'approval_feedback', text: 'Revised:\n```json\n{"severity": "high"}\n```' },
        ],
      },
    });
    const run = await engine.runWorkflow({
      name: 'stale-submit',
      stages: [{ name: 'triage', prompt: 'Triage.', output: { format: 'json', schema: SCHEMA }, approval: {} }],
      edges: [],
    });
    await run.waitForStage('triage', 'awaiting_input');
    const id = run.stageRunId('triage');
    expect((await engine.commands.approve(run.runId, id, { outcome: 'changes_requested', reason: 'Severity must be high.' })).status).toBe(202);
    await run.waitFor((s) => reviewRound(s, 'triage') === 2 && s.stages['triage']!.status === 'awaiting_input', 10_000, 'round 2');
    expect((await engine.commands.approve(run.runId, id, { outcome: 'approved' })).status).toBe(202);
    const snap = await run.waitForTerminal();
    expect(snap.stages['triage']!.outputData).toEqual({ severity: 'high' });
  });

  it('R9: a revision is judged again, never passed on the verdict of the output before it', async () => {
    const judge = (score: number) => ({ text: `\`\`\`json\n{"score": ${score}, "reasons": ["r${score}"]}\n\`\`\`` });
    engine = await createTestEngine({
      script: (key) =>
        key.stageName.startsWith('judge-')
          ? [judge(9), judge(2), judge(9)]
          : [
              { text: 'VERSION ONE of the answer, complete and correct.' },
              { on: 'approval_feedback', text: 'VERSION TWO of the answer, sloppy.' },
              { on: 'repair', text: 'VERSION THREE of the answer, repaired.' },
            ],
    });
    const run = await engine.runWorkflow({
      name: 'judge-revision',
      stages: [{ name: 'j1', prompt: 'Answer.', output: { rules: [{ type: 'judge', rubric: 'Is it good?', threshold: 5 }] }, approval: {} }],
      edges: [],
    });
    await run.waitForStage('j1', 'awaiting_input');
    const id = run.stageRunId('j1');
    expect((await engine.commands.approve(run.runId, id, { outcome: 'changes_requested', reason: 'Make it version two.' })).status).toBe(202);
    const snap = await run.waitFor((s) => reviewRound(s, 'j1') === 2 && s.stages['j1']!.status === 'awaiting_input', 10_000, 'round 2');
    expect((snap.stages['j1']!.interruptData as { output?: string }).output).toBe('VERSION THREE of the answer, repaired.');
  });

  it('R10: the summary after a revision describes the revised output', async () => {
    const LONG_V1 = 'VERSION-ONE ' + 'x'.repeat(7000);
    const LONG_V2 = 'VERSION-TWO ' + 'y'.repeat(7000);
    engine = await createTestEngine({
      script: {
        p1: [
          { text: LONG_V1 },
          { on: 'summary', text: 'SUMMARY OF VERSION ONE' },
          { on: 'approval_feedback', text: LONG_V2 },
          { on: 'summary', text: 'SUMMARY OF VERSION TWO' },
        ],
      },
    });
    const run = await engine.runWorkflow({
      name: 'summary-replay',
      stages: [
        { name: 'p1', prompt: 'Write a long report.', approval: {} },
        { name: 'p2', prompt: 'Use the summary.', context: { mode: 'summary' } },
      ],
      edges: [['p1', 'p2']],
    });
    await run.waitForStage('p1', 'awaiting_input');
    const id = run.stageRunId('p1');
    expect((await engine.commands.approve(run.runId, id, { outcome: 'changes_requested', reason: 'Rewrite it as version two.' })).status).toBe(202);
    await run.waitFor((s) => reviewRound(s, 'p1') === 2 && s.stages['p1']!.status === 'awaiting_input', 10_000, 'round 2');
    expect((await engine.commands.approve(run.runId, id, { outcome: 'approved' })).status).toBe(202);
    const snap = await run.waitForTerminal();
    expect(snap.stages['p1']!.summary).toBe('SUMMARY OF VERSION TWO');
  });
});
