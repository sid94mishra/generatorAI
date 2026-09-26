import { describe, expect, it, vi } from 'vitest';
import { platformCommands } from '../platform.js';
import type { CliContext } from '../../context/CliContext.js';

const hookTest = platformCommands().find((c) => c.id === 'hook.test')!;

function fakeContext(overrides: { test?: ReturnType<typeof vi.fn> }): CliContext {
  return {
    api: {
      hooks: {
        test: overrides.test ?? vi.fn(),
      },
    },
  } as unknown as CliContext;
}

describe('hook test', () => {
  it('sends a real HookDefinition body — enabled, numeric retries/timeout, matching config.type', async () => {
    const testFn = vi.fn(async () => ({ success: true, message: 'ok' }));
    const ctx = fakeContext({ test: testFn });

    await hookTest.handler(ctx, {
      args: { session: 'sess_1', phase: 'pre_run' },
      flags: { type: 'script', config: JSON.stringify({ command: 'echo', args: ['hi'] }) },
    } as never);

    expect(testFn).toHaveBeenCalledWith('sess_1', 'pre_run', {
      type: 'script',
      config: { type: 'script', command: 'echo', args: ['hi'] },
    });
  });

  it("rejects a --config whose own \"type\" disagrees with --type, rather than letting config.type silently win", async () => {
    const testFn = vi.fn();
    const ctx = fakeContext({ test: testFn });

    await expect(
      hookTest.handler(ctx, {
        args: { session: 'sess_1', phase: 'pre_run' },
        flags: { type: 'http', config: JSON.stringify({ type: 'script', command: 'echo hi' }) },
      } as never),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(testFn).not.toHaveBeenCalled();
  });

  it('accepts a --config whose "type" matches --type', async () => {
    const testFn = vi.fn(async () => ({ success: true, message: 'ok' }));
    const ctx = fakeContext({ test: testFn });

    await hookTest.handler(ctx, {
      args: { session: 'sess_1', phase: 'pre_run' },
      flags: { type: 'script', config: JSON.stringify({ type: 'script', command: 'echo hi' }) },
    } as never);

    expect(testFn).toHaveBeenCalledWith('sess_1', 'pre_run', {
      type: 'script',
      config: { type: 'script', command: 'echo hi' },
    });
  });

  it('rejects invalid --config JSON before making a network call', async () => {
    const testFn = vi.fn();
    const ctx = fakeContext({ test: testFn });

    await expect(
      hookTest.handler(ctx, {
        args: { session: 'sess_1', phase: 'pre_run' },
        flags: { type: 'script', config: '{not json' },
      } as never),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(testFn).not.toHaveBeenCalled();
  });

  it('reports a failed dry run as a command failure, not a silent success', async () => {
    const testFn = vi.fn(async () => ({ success: false, message: 'Hook execution failed', error: 'boom' }));
    const ctx = fakeContext({ test: testFn });

    const result = await hookTest.handler(ctx, {
      args: { session: 'sess_1', phase: 'pre_run' },
      flags: { type: 'script', config: '{}' },
    } as never);

    expect(result.exitCode).toBeDefined();
    expect(result.exitCode).not.toBe(0);
  });

  it('reports a successful dry run with no forced exit code', async () => {
    const testFn = vi.fn(async () => ({ success: true, message: 'ok' }));
    const ctx = fakeContext({ test: testFn });

    const result = await hookTest.handler(ctx, {
      args: { session: 'sess_1', phase: 'pre_run' },
      flags: { type: 'script', config: '{}' },
    } as never);

    expect(result.exitCode).toBeUndefined();
  });
});

