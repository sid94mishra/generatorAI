// ────────────────────────────────────────────────────────────────
// A loop body that continues its session (`sessionReuse: continue`) keeps the
// conversation composed for its FIRST iteration — and with it that
// iteration's gate port. A tool permission raised in a later iteration must
// park on that iteration's attempt; it used to be refused at once ("The
// stage was stopped (cancelled)") because it parked on the finished one, so
// a fixer answering review comments could not run a single command.
// ────────────────────────────────────────────────────────────────

import { afterEach, describe, expect, it } from 'vitest';
import { createTestEngine, type TestEngine } from '../../src/index.js';

let engine: TestEngine | undefined;
afterEach(async () => {
  await engine?.dispose();
  engine = undefined;
});

const LOOP = {
  name: 't9-loop-continue',
  stages: [
    { key: 'l', name: 'l', kind: 'loop', loop: { maxIterations: 2, onLimit: { mode: 'accept_last' }, exits: [{ when: "stages.fix.output == 'never'", action: 'complete', reason: 'never' }] } },
    { key: 'fix', name: 'fix', parentKey: 'l', prompt: 'Fix it.', followUpPrompts: [{ label: 'again', text: 'Address the comments.' }], sessionReuse: 'continue' },
  ],
};

describe('T9 a continued loop session asks on the iteration that runs', () => {
  it('parks the second iteration\'s tool permission and delivers the answer', async () => {
    const ask = { type: 'shell_exec', description: 'run the tests' };
    // Each iteration is its own stage run: the first answers plainly, the second asks to run the tests.
    const runs: string[] = [];
    engine = await createTestEngine({
      script: (key) => {
        if (!runs.includes(key.stageRunId)) runs.push(key.stageRunId);
        return runs.indexOf(key.stageRunId) === 0 ? [{ text: 'First fix done.' }] : [{ permission: ask, text: 'Comments addressed, tests green.' }];
      },
    });
    const run = await engine.runWorkflow(LOOP as never, {}, { permissionMode: 'default' });

    // Iteration 2's request waits for a person instead of being refused.
    const deadline = Date.now() + 15_000;
    let parked: { instancePath: string } | undefined;
    while (!parked && Date.now() < deadline) {
      const snap = await run.snapshot();
      parked = Object.values(snap.stages).find(
        (s) => (s as { status?: string }).status === 'awaiting_input' && (s as { interruptData?: { kind?: string } }).interruptData?.kind === 'tool_permission',
      ) as { instancePath: string } | undefined;
      if (!parked) await new Promise((r) => setTimeout(r, 20));
    }
    expect(parked?.instancePath).toBe('l#1/fix');
    expect((await engine.commands.approve(run.runId, run.stageRunId(parked!.instancePath), { outcome: 'approved' })).status).toBe(202);

    const done = await run.waitForTerminal();
    expect(done.run.status).toBe('completed');
    // One conversation across both iterations, and the second turn's permission was granted.
    const fixCalls = done.calls.filter((c) => c.stageName === 'fix');
    expect(new Set(fixCalls.map((c) => c.conversationId)).size).toBe(1);
    expect(fixCalls.map((c) => c.permission ?? '-')).toEqual(['-', true]);
  });
});
