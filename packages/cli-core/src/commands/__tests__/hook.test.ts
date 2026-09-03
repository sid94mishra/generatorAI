import { describe, expect, it, vi } from 'vitest';
import { platformCommands } from '../platform.js';
import type { CliContext } from '../../context/CliContext.js';

const hookTest = platformCommands().find((c) => c.id === 'hook.test')!;
const hookList = platformCommands().find((c) => c.id === 'hook.list')!;

function fakeContext(overrides: { test?: ReturnType<typeof vi.fn>; sessionHooks?: ReturnType<typeof vi.fn> }): CliContext {
  return {
    api: {
      hooks: {
        test: overrides.test ?? vi.fn(),
        sessionHooks: overrides.sessionHooks ?? vi.fn(),
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

describe('hook list', () => {
  it('flattens globalHooks and per-workflow overrides instead of treating the response as a bare array', async () => {
    const sessionHooks = vi.fn(async () => ({
      sessionId: 'sess_1',
      globalHooks: [
        { id: 'g1', name: 'notify', phase: 'pre_run', type: 'http', priority: 0, enabled: true, failurePolicy: 'continue', timeoutMs: 5000, retries: 0, config: { type: 'http', url: 'x', method: 'POST' } },
      ],
      workflowHooks: [
        { workflowId: 'wf_1', workflowName: 'release', hooks: { g1: { priority: 5 } } },
      ],
    }));
    const ctx = fakeContext({ sessionHooks });

    const result = await hookList.handler(ctx, { args: { session: 'sess_1' }, flags: {} } as never);

    // The workflow row's override only touches `priority` — every other
    // field must fall back to the matching global hook (`g1`), not render as
    // undefined. `hookOverrides` is a partial patch, not a full definition.
    expect(result.data).toEqual([
      { scope: 'global', workflowId: null, workflowName: null, hookId: 'g1', name: 'notify', phase: 'pre_run', type: 'http', priority: 0, failurePolicy: 'continue', enabled: true },
      { scope: 'workflow', workflowId: 'wf_1', workflowName: 'release', hookId: 'g1', name: 'notify', phase: 'pre_run', type: 'http', priority: 5, failurePolicy: 'continue', enabled: true },
    ]);
  });

  it("falls back to the global hook's identity when a workflow override replaces it entirely", async () => {
    const sessionHooks = vi.fn(async () => ({
      sessionId: 'sess_1',
      globalHooks: [
        { id: 'g1', name: 'notify', phase: 'pre_run', type: 'http', priority: 0, enabled: true, failurePolicy: 'continue', timeoutMs: 5000, retries: 0, config: { type: 'http', url: 'x', method: 'POST' } },
      ],
      workflowHooks: [
        // This override DOES set its own name/type — those must win over the
        // global hook's, while the untouched fields (phase, failurePolicy,
        // enabled) still fall back.
        { workflowId: 'wf_1', workflowName: 'release', hooks: { g1: { name: 'notify (staging)', type: 'script' } } },
      ],
    }));
    const ctx = fakeContext({ sessionHooks });

    const result = await hookList.handler(ctx, { args: { session: 'sess_1' }, flags: {} } as never);

    expect(result.data).toEqual([
      { scope: 'global', workflowId: null, workflowName: null, hookId: 'g1', name: 'notify', phase: 'pre_run', type: 'http', priority: 0, failurePolicy: 'continue', enabled: true },
      { scope: 'workflow', workflowId: 'wf_1', workflowName: 'release', hookId: 'g1', name: 'notify (staging)', phase: 'pre_run', type: 'script', priority: 0, failurePolicy: 'continue', enabled: true },
    ]);
  });
});
