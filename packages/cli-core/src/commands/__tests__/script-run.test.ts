import { describe, expect, it, vi } from 'vitest';
import { scriptCommands } from '../platform.js';
import type { CliContext } from '../../context/CliContext.js';

const scriptRun = scriptCommands().find((c) => c.id === 'script.run')!;

function fakeContext(overrides: { runsGet?: ReturnType<typeof vi.fn>; subscribed?: { count: number } }): CliContext {
  const disposers: Array<() => void> = [];
  return {
    api: {
      scripts: {
        list: vi.fn(async () => [{ id: 'my-script', name: 'my-script', status: 'active', createdAt: 0 }]),
        run: vi.fn(async () => ({ definitionId: 'def_1', runId: 'run_1', status: 'running' })),
      },
      runs: { get: overrides.runsGet ?? vi.fn(async () => ({ id: 'run_1', status: 'completed' })) },
    },
    stream: {
      subscribe: (_scope: string, _id: string, cb: (event: { kind: string; data: Record<string, unknown> }) => void) => {
        if (overrides.subscribed) overrides.subscribed.count += 1;
        queueMicrotask(() => cb({ kind: 'harness.completion', data: {} }));
        return () => {};
      },
    },
    emit: vi.fn(),
    chunk: vi.fn(),
    // `streamUntil`'s only way to end a stream with no `isDone` predicate is
    // via `ctx.dispose()` running the callbacks `onDispose` collected — a
    // fake that no-ops `onDispose` leaves that promise pending forever.
    onDispose: (fn: () => void) => disposers.push(fn),
    assertNotCancelled: vi.fn(),
    dispose: vi.fn(async () => {
      for (const fn of disposers.splice(0)) fn();
    }),
    signal: new AbortController().signal,
  } as unknown as CliContext;
}

describe('script run --watch', () => {
  it('actually subscribes and waits for completion, not just a suggestion message', async () => {
    const subscribed = { count: 0 };
    const runsGet = vi.fn(async () => ({ id: 'run_1', status: 'completed' }));
    const ctx = fakeContext({ runsGet, subscribed });

    const result = await scriptRun.handler(ctx, {
      args: { script: 'my-script' },
      flags: { watch: true, verbosity: 'normal' },
    } as never);

    expect(subscribed.count).toBe(1);
    expect(runsGet).toHaveBeenCalledWith('run_1');
    expect(result.data).toEqual({ id: 'run_1', status: 'completed' });
  });

  it('without --watch, starts the run and does not subscribe to its stream', async () => {
    const subscribed = { count: 0 };
    const ctx = fakeContext({ subscribed });

    const result = await scriptRun.handler(ctx, {
      args: { script: 'my-script' },
      flags: { watch: false, verbosity: 'normal' },
    } as never);

    expect(subscribed.count).toBe(0);
    expect(result.data).toEqual({ definitionId: 'def_1', runId: 'run_1', status: 'running' });
  });
});
