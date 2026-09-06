// ────────────────────────────────────────────────────────────────
// Stream reducer — hook invocations.
//
// `hook.started`/`hook.completed`/`hook.failed` used to be narrated as
// system-message text and nothing else, so the run inspector's Hooks tab
// had no structured data to render and stayed permanently empty. These
// tests pin the started/completed pairing rules `addHookStarted` and
// `completeHook` implement.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';

import type { StreamsRecord } from '../stream/types.js';
import * as r from '../stream/reducer.js';

const SID = 'session-1';

const run = (...steps: Array<(s: StreamsRecord) => StreamsRecord>): StreamsRecord =>
  steps.reduce<StreamsRecord>((s, step) => step(s), {});

const hooks = (s: StreamsRecord) => r.getStream(s, SID).hooks;

describe('stream reducer — hooks', () => {
  it('pairs a started hook with its completed event by hookId', () => {
    const s = run(
      (x) => r.addHookStarted(x, SID, 'pre-commit', 'pre_run', { hookId: 'h1', hookType: 'script' }),
      (x) => r.completeHook(x, SID, 'ok', 'pre-commit', 'pre_run', { hookId: 'h1', durationMs: 120 }),
    );
    expect(hooks(s)).toEqual([
      { id: 'h1', hookName: 'pre-commit', phase: 'pre_run', hookType: 'script', status: 'ok', durationMs: 120 },
    ]);
  });

  it('pairs a started hook with its failed event', () => {
    const s = run(
      (x) => r.addHookStarted(x, SID, 'notify', 'post_run', { hookId: 'h1' }),
      (x) => r.completeHook(x, SID, 'failed', 'notify', 'post_run', { hookId: 'h1', durationMs: 40 }),
    );
    expect(hooks(s)).toMatchObject([{ id: 'h1', status: 'failed', durationMs: 40 }]);
  });

  it('a completed event with no started event still produces a record', () => {
    // Replay can begin mid-hook — dropping this would under-report to the tab.
    const s = run((x) =>
      r.completeHook(x, SID, 'ok', 'pre-commit', 'pre_run', { hookId: 'h1', durationMs: 90 }),
    );
    expect(hooks(s)).toEqual([
      { id: 'h1', hookName: 'pre-commit', phase: 'pre_run', status: 'ok', durationMs: 90 },
    ]);
  });

  it('two concurrent hooks with the same name+phase pair independently without hookId', () => {
    const s = run(
      (x) => r.addHookStarted(x, SID, 'lint', 'pre_run'),
      (x) => r.addHookStarted(x, SID, 'lint', 'pre_run'),
      // No hookId to match on, so each completion takes the MOST RECENT
      // unfinished record — the second `hook_1` first, then `hook_0`.
      (x) => r.completeHook(x, SID, 'ok', 'lint', 'pre_run', { durationMs: 10 }),
      (x) => r.completeHook(x, SID, 'failed', 'lint', 'pre_run', { durationMs: 20 }),
    );
    expect(hooks(s)).toEqual([
      { id: 'hook_0', hookName: 'lint', phase: 'pre_run', status: 'failed', durationMs: 20 },
      { id: 'hook_1', hookName: 'lint', phase: 'pre_run', status: 'ok', durationMs: 10 },
    ]);
  });

  it('a running hook is left unmatched by a different name or phase', () => {
    const s = run(
      (x) => r.addHookStarted(x, SID, 'lint', 'pre_run', { hookId: 'h1' }),
      (x) => r.completeHook(x, SID, 'ok', 'lint', 'post_run', { durationMs: 5 }),
    );
    // No match found (different phase) — the original stays running and a
    // second, separately-finished record is appended.
    expect(hooks(s)).toEqual([
      { id: 'h1', hookName: 'lint', phase: 'pre_run', status: 'running' },
      // Counter-synthesised ids are independent of explicit hookIds, so this
      // is 'hook_0', not 'hook_1' — the counter only advances when a
      // synthesised id is actually used.
      { id: 'hook_0', hookName: 'lint', phase: 'post_run', status: 'ok', durationMs: 5 },
    ]);
  });

  it('carries stageRunId through for stage attribution', () => {
    const s = run(
      (x) => r.addHookStarted(x, SID, 'lint', 'pre_run', { stageRunId: 'sr1' }),
      (x) => r.completeHook(x, SID, 'ok', 'lint', 'pre_run', { durationMs: 5 }),
    );
    expect(hooks(s)).toMatchObject([{ stageRunId: 'sr1' }]);
  });
});
