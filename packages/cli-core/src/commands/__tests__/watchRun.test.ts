import { describe, expect, it, vi } from 'vitest';
import { watchRun } from '../run.js';
import type { CliContext } from '../../context/CliContext.js';

/**
 * Regression coverage for a real bug: `watchRun` (backing `run start --watch`
 * / `run watch`) switched on `stage.started`/`stage_run.started` and
 * `stage.awaiting_input` — kinds the server has never emitted (confirmed
 * against every producer in `packages/core/src/services/*.ts`; the real
 * kinds are `stage_run.running`/`stage_run.awaiting_input`, keyed by
 * `stageRunId`). Before the fix, `--watch` printed nothing at all for a
 * stage starting, completing, failing, or awaiting HITL approval against a
 * real run — every one of those `ctx.emit` calls was dead code.
 */
function fakeContext(
  events: Array<{ kind: string; data: Record<string, unknown> }>,
  runStatus: { status: string; error?: string | null } = { status: 'completed' },
): { ctx: CliContext; emitted: Array<{ level: string; message: string }> } {
  const emitted: Array<{ level: string; message: string }> = [];
  // `streamUntil` (`_shared.ts`) registers its own completion via
  // `ctx.onDispose(() => finish())` and resolves only once `ctx.dispose()`
  // actually runs that disposer — a fake that no-ops either half of that
  // pair hangs `watchRun` forever, since `streamUntil`'s promise never
  // settles any other way in this test (no `isDone`, no abort).
  const disposers: Array<() => void> = [];
  const ctx = {
    api: {
      runs: {
        get: vi.fn(async () => runStatus),
      },
    },
    stream: {
      subscribe: (
        _scope: string,
        _id: string,
        cb: (event: { kind: string; data: Record<string, unknown> }) => void,
      ) => {
        queueMicrotask(() => {
          for (const event of events) cb(event);
        });
        return () => {};
      },
    },
    emit: vi.fn((event: { type: string; level?: string; message?: string }) => {
      if (event.type === 'log') emitted.push({ level: String(event.level), message: String(event.message) });
    }),
    chunk: vi.fn(),
    onDispose: (fn: () => void) => disposers.push(fn),
    dispose: vi.fn(async () => {
      for (const fn of disposers) fn();
    }),
    signal: new AbortController().signal,
    assertNotCancelled: () => {},
  } as unknown as CliContext;
  return { ctx, emitted };
}

describe('watchRun', () => {
  it('prints a stage-started line on the real stage_run.running event', async () => {
    const { ctx, emitted } = fakeContext([
      { kind: 'stage_run.running', data: { stageRunId: 'sr_1', name: 'build' } },
    ]);
    await watchRun(ctx, 'run_1', 'normal');
    expect(emitted).toContainEqual({ level: 'info', message: '▶ build' });
  });

  it('prints a stage-completed line using the name it already tracked from .running', async () => {
    const { ctx, emitted } = fakeContext([
      { kind: 'stage_run.running', data: { stageRunId: 'sr_1', name: 'build' } },
      { kind: 'stage_run.completed', data: { stageRunId: 'sr_1' } },
    ]);
    await watchRun(ctx, 'run_1', 'normal');
    expect(emitted).toContainEqual({ level: 'info', message: '✓ build' });
  });

  it('prints a stage-failed line with the error message', async () => {
    const { ctx, emitted } = fakeContext([
      { kind: 'stage_run.running', data: { stageRunId: 'sr_1', name: 'deploy' } },
      { kind: 'stage_run.failed', data: { stageRunId: 'sr_1', error: 'timed out' } },
    ]);
    await watchRun(ctx, 'run_1', 'normal');
    expect(emitted).toContainEqual({ level: 'error', message: '✗ deploy: timed out' });
  });

  it('prints the waiting-for-approval hint on the real stage_run.awaiting_input event', async () => {
    const { ctx, emitted } = fakeContext([
      { kind: 'stage_run.running', data: { stageRunId: 'sr_1', name: 'review' } },
      { kind: 'stage_run.awaiting_input', data: { stageRunId: 'sr_1' } },
    ]);
    await watchRun(ctx, 'run_1', 'normal');
    expect(emitted).toContainEqual({
      level: 'warn',
      message: '⏳ review is waiting for approval — run `generatorai run hitl pending run_1`',
    });
  });

  it('is silent for a bare stage.started (the never-real legacy alias) with no real running event', async () => {
    // The legacy `stage.*` alias is kept only so an old recording/fixture
    // does not crash — it must not be treated as evidence anything else
    // still sends it.
    const { ctx, emitted } = fakeContext([{ kind: 'stage.started', data: { stageName: 'legacy' } }]);
    await watchRun(ctx, 'run_1', 'normal');
    expect(emitted).toContainEqual({ level: 'info', message: '▶ legacy' });
  });

  it('throws RESULT_FAILED when the run terminal state is failed, independent of stream events', async () => {
    const { ctx } = fakeContext([], { status: 'failed', error: 'boom' });
    await expect(watchRun(ctx, 'run_1', 'normal')).rejects.toMatchObject({
      code: 'RESULT_FAILED',
      message: 'Run failed: boom',
    });
  });
});
