// ────────────────────────────────────────────────────────────────
// Fork (P03 WP-3.8, G5 §3.8): re-running a terminal run is a NEW run.
//
// The source run is never mutated; instances not downstream of a re-run
// path are memoized (copied with their results, never re-run or
// re-validated: B-6); the fork keeps the source's permission mode and
// lineage (W-59); a live run cannot be forked, and an idempotency key makes
// a double click one fork (W-12, F-15).
// ────────────────────────────────────────────────────────────────

import { afterEach, describe, expect, it } from 'vitest';
import { createTestEngine, type TestEngine } from '../../src/index.js';

let engine: TestEngine | undefined;
afterEach(async () => {
  await engine?.dispose();
  engine = undefined;
});

const RULE = { type: 'contains', value: 'A-OK', message: 'has A-OK' };

const WORKFLOW = {
  name: 'fork',
  stages: [
    { name: 'a', prompt: 'Write A-OK.', output: { rules: [RULE] } },
    { name: 'b', prompt: 'Build on A.', retry: { maxAttempts: 1 }, onExhausted: 'fail' },
    { name: 'c', prompt: 'Finish.' },
  ],
  edges: [
    ['a', 'b'],
    ['b', 'c'],
  ] as const,
};

describe('forkRun', () => {
  it('retries a failed run as a new run: memoized stages are copied, the failed branch runs again', async () => {
    // Scripts are per stage run: `b` fails in the source run and succeeds in the fork.
    let bRuns = 0;
    engine = await createTestEngine({
      script: (key) => {
        if (key.stageName === 'a') return [{ text: 'A-OK, the first stage is done.' }];
        if (key.stageName === 'b') return bRuns++ === 0 ? [{ error: { message: 'invalid api key' } }] : [{ text: 'B succeeded on the fork.' }];
        return undefined;
      },
    });
    const run = await engine.runWorkflow(WORKFLOW, {}, { permissionMode: 'acceptEdits' });
    const failed = await run.waitForTerminal();
    expect(failed.run.status).toBe('failed');
    expect(failed.stages['b']!.status).toBe('failed');
    expect(failed.stages['c']!.status).toBe('skipped');
    const aCalls = failed.calls.filter((c) => c.stageName === 'a').length;

    const forkId = await engine.commands.fork(run.runId);
    const fork = await engine.handle(forkId);
    const done = await fork.waitForTerminal();
    expect(done.run.status).toBe('completed');
    expect(done.run.ancestorRunId).toBe(run.runId);
    // W-59: the operator's run-level permission mode and the lineage carry over.
    expect(done.run.permissionMode).toBe('acceptEdits');
    expect(done.run.trigger).toMatchObject({ kind: 'fork', sourceRunId: run.runId });

    // `a` is memoized: copied with its result, no new attempt and no model call (B-6).
    expect(done.stages['a']!.status).toBe('completed');
    expect(done.stages['a']!.outputText).toBe('A-OK, the first stage is done.');
    expect(done.stages['a']!.attempts).toEqual([]);
    expect((done.stages['a']!.row as unknown as Record<string, unknown>)['copied_from_stage_run_id']).toBe(failed.stages['a']!.row.id);
    expect(engine.calls.filter((c) => c.stageName === 'a')).toHaveLength(aCalls);
    // `b` and its successor ran again.
    expect(done.stages['b']!.outputText).toBe('B succeeded on the fork.');
    expect(done.stages['c']!.status).toBe('completed');

    // The source run is untouched.
    const source = await run.snapshot();
    expect(source.run.status).toBe('failed');
    expect(source.stages['b']!.status).toBe('failed');
  });

  it('refuses a live run, and an idempotency key makes a repeated fork one fork (W-12, F-15)', async () => {
    engine = await createTestEngine({ script: { a: [{ hang: true }] } });
    const run = await engine.runWorkflow({ stages: [{ name: 'a', prompt: 'A' }] });
    await run.waitForStage('a', 'running');
    const live = await engine.commands.send(run.runId, { type: 'retry-run' });
    expect(live.status).toBe(409);

    await engine.commands.cancel(run.runId);
    await run.waitForTerminal();
    const first = await engine.commands.send(run.runId, { type: 'retry-run', request: { idempotencyKey: 'click-1', start: false } });
    const second = await engine.commands.send(run.runId, { type: 'retry-run', request: { idempotencyKey: 'click-1', start: false } });
    // A re-run is an invocation (P04): 202, the new run in `runId`.
    expect(first.status).toBe(202);
    expect(second.runId).toBe(first.runId);
    const third = await engine.commands.send(run.runId, { type: 'retry-run', request: { idempotencyKey: 'click-2', start: false } });
    expect(third.runId).not.toBe(first.runId);
  });
});
