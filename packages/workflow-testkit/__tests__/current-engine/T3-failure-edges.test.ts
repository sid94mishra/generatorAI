// ────────────────────────────────────────────────────────────────
// T3 — failure paths and edge types (F_live_tests §1 T3/T3b, §5).
//
// CHARACTERISATION of today's engine. `// KNOWN-BUG W-xx` marks the
// assertions PHASE-03 flips.
// ────────────────────────────────────────────────────────────────

import { afterEach, describe, expect, it } from 'vitest';
import { createTestEngine, type TestEngine, type Turn } from '../../src/index.js';

let engine: TestEngine | undefined;
afterEach(async () => {
  await engine?.dispose();
  engine = undefined;
});

const fail = (message = 'provider exploded'): Turn => ({ error: { message, code: 'PROVIDER_ERROR' } });

describe('T3 failure paths and edge types (current engine)', () => {
  it('retries with backoff on fresh sessions, then routes failure / completion / always', async () => {
    engine = await createTestEngine({ script: { F: [fail('boom-1'), fail('boom-2'), fail('boom-3')] } });
    const run = await engine.runWorkflow({
      name: 't3-failure-edges',
      stages: [
        { name: 'F', prompt: 'F', retry: { maxAttempts: 3, initialDelayMs: 100, backoffMultiplier: 2 } },
        { name: 'S', prompt: 'S' },
        { name: 'Rec', prompt: 'REC' },
        { name: 'OC', prompt: 'OC' },
        { name: 'AL', prompt: 'AL' },
        { name: 'Z', prompt: 'Z' },
      ],
      edges: [
        ['F', 'S', 'success'],
        ['F', 'Rec', 'failure'],
        ['F', 'OC', 'completion'],
        ['F', 'AL', 'always'],
        ['Rec', 'Z'],
      ],
    });
    const snap = await run.waitForTerminal();

    expect(snap.stages['F']!.status).toBe('failed');
    expect(snap.stages['F']!.retryCount).toBe(2);
    expect(snap.stages['F']!.error).toBe('boom-3');
    expect(snap.stages['S']!.status).toBe('skipped');
    for (const n of ['Rec', 'OC', 'AL', 'Z']) expect(snap.stages[n]!.status).toBe('completed');
    // The failure was handled by a failure branch → the run completes.
    expect(snap.run.status).toBe('completed');

    // Three attempts, each on a fresh conversation, backoff 100 ms then 200 ms.
    const attempts = snap.calls.filter((c) => c.stageName === 'F' && c.kind === 'prompt');
    expect(attempts).toHaveLength(3);
    expect(new Set(attempts.map((c) => c.conversationId)).size).toBe(3);
    expect(attempts[1]!.startedAt - attempts[0]!.endedAt!).toBeGreaterThanOrEqual(90);
    expect(attempts[2]!.startedAt - attempts[1]!.endedAt!).toBeGreaterThanOrEqual(190);
    // O-5: no attempt history is kept. Only the last attempt's error survives;
    // v57 created the stage_attempts table, but the v1 engine never writes it.
    const e = engine;
    const stored = (text: string) =>
      (e.sqlite.prepare(`SELECT COUNT(*) AS n FROM stage_runs WHERE error LIKE ?`).get(`%${text}%`) as { n: number }).n;
    expect(stored('boom-1') + stored('boom-2')).toBe(0); // KNOWN-BUG W-39 (earlier attempts' errors are lost)
    expect(e.sqlite.prepare(`SELECT COUNT(*) AS n FROM stage_attempts`).get()).toEqual({ n: 0 }); // KNOWN-BUG W-39 (no per-attempt record)
  });

  it('an `always` cleanup turns an unhandled failure into a completed run', async () => {
    engine = await createTestEngine({ script: { F: [fail()] } });
    const run = await engine.runWorkflow({
      stages: [
        { name: 'F', prompt: 'F', retry: { maxAttempts: 1, initialDelayMs: 100, backoffMultiplier: 1 } },
        { name: 'cleanup', prompt: 'cleanup' },
      ],
      edges: [['F', 'cleanup', 'always']],
    });
    const snap = await run.waitForTerminal();
    expect(snap.stages['F']!.status).toBe('failed');
    expect(snap.stages['cleanup']!.status).toBe('completed');
    expect(snap.run.status).toBe('completed'); // KNOWN-BUG W-29 (failure masking by always/completion)
  });

  it('an unhandled failure retries once by default and fails the run', async () => {
    engine = await createTestEngine({ script: { FF: [fail('boom 1'), fail('boom 2')] } });
    const run = await engine.runWorkflow({
      name: 't3b-unhandled-default-retry',
      stages: [
        { name: 'A', prompt: 'A' },
        { name: 'FF', prompt: 'FF' },
        { name: 'G', prompt: 'G' },
      ],
      edges: [
        ['A', 'FF'],
        ['FF', 'G'],
      ],
    });
    const snap = await run.waitForTerminal();
    expect(snap.stages['FF']!.status).toBe('failed');
    // No retry → DEFAULT_RETRY_POLICY: one retry after 3 s. Validation
    // failures with no policy never retry (O-8).
    expect(snap.stages['FF']!.retryCount).toBe(1); // KNOWN-BUG W-39 (execution vs validation retry defaults differ)
    expect(snap.stages['G']!.status).toBe('skipped');
    expect(snap.run.status).toBe('failed');
    expect(snap.run.error).toContain('FF (boom 2)');
  });

  it('`timeouts.attemptMs` bounds only the prompt turn, not the context turn before it', async () => {
    engine = await createTestEngine({
      script: { FF: [{ on: 'context', text: 'Context received.', delayMs: 1500 }, { hang: true }] },
    });
    const run = await engine.runWorkflow({
      stages: [
        { name: 'A', prompt: 'A' },
        {
          name: 'FF',
          prompt: 'FF',
          timeouts: { attemptMs: 1000 },
          retry: { maxAttempts: 1, initialDelayMs: 100, backoffMultiplier: 1 },
        },
      ],
      edges: [['A', 'FF']],
    });
    const snap = await run.waitForTerminal();
    const ff = snap.calls.filter((c) => c.stageName === 'FF');
    expect(ff.map((c) => `${c.kind}:${c.outcome}`)).toEqual(['context:replied', 'prompt:aborted']);
    // The 1.5 s context turn ran past the stage's 1 s deadline untouched.
    expect(ff[0]!.endedAt! - ff[0]!.startedAt).toBeGreaterThanOrEqual(1400); // KNOWN-BUG W-15 (internal turns have no timeout)
    expect(snap.stages['FF']!.status).toBe('failed');
    expect(snap.stages['FF']!.error).toMatch(/timed out after 1000ms/);
    expect(snap.run.status).toBe('failed');
  });
});
