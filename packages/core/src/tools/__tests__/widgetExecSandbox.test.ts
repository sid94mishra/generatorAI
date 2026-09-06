// ────────────────────────────────────────────────────────────────
// Review 6.1 — the widget script sandbox.
//
// `widget_exec` runs model-authored JavaScript inside the server process. Its
// own documentation promised "no access to require/process/globals", but it
// compiled the script with `new Function`, whose body runs in the global
// scope: `process`, `globalThis` and `global` were all reachable, and there
// was no timeout at all. Two one-liners were enough — one to read every API
// key in the environment into the transcript, one to freeze the server.
//
// These tests exercise the real tool handler, so they fail if the sandbox is
// ever swapped back for something that shares this realm.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it, vi } from 'vitest';
import { buildWidgetExecTool } from '../widgetTools.js';

/** Minimal widget service + registry: one declared action, a readable state. */
function makeCtx() {
  return {
    widgetService: {
      invokeAction: vi.fn(async () => ({ ok: true, result: 'done' })),
      getInstance: vi.fn(async () => ({ id: 'w1', descriptorId: 'd1', state: { count: 1 } })),
    },
    widgetRegistry: {
      get: vi.fn(() => ({ actions: [{ name: 'bump' }] })),
    },
  } as never;
}

async function run(code: string): Promise<Record<string, unknown>> {
  const tool = buildWidgetExecTool(makeCtx(), { instanceId: 'w1' } as never);
  return (await tool.handler({ instanceId: 'w1', code } as never)) as Record<
    string,
    unknown
  >;
}

describe('widget_exec sandbox (review 6.1)', () => {
  it('cannot reach process, so it cannot read the environment', async () => {
    const result = await run('return typeof process;');
    // Either the identifier is undefined inside the context, or the script
    // threw on touching it. Both are acceptable; reaching the real `process`
    // is not.
    if (result['ok'] === true) {
      expect(result['returned']).toBe('undefined');
    } else {
      expect(String(result['error'])).toMatch(/process is not defined/i);
    }
  });

  it('cannot reach globalThis from the host realm', async () => {
    const result = await run('return typeof globalThis.process;');
    if (result['ok'] === true) {
      expect(result['returned']).toBe('undefined');
    } else {
      expect(String(result['error'])).toBeTruthy();
    }
  });

  it('cannot require modules', async () => {
    const result = await run('return typeof require;');
    if (result['ok'] === true) {
      expect(result['returned']).toBe('undefined');
    } else {
      expect(String(result['error'])).toMatch(/require is not defined/i);
    }
  });

  it('stops an infinite loop instead of freezing the server', async () => {
    const result = await run('while (true) {}');
    expect(result['ok']).toBe(false);
    expect(String(result['error'])).toMatch(/exceeded|timed out|Script execution/i);
  }, 20_000);

  it('stops an ASYNC loop, which the vm timeout alone does not', async () => {
    // The vm's own timeout bounds only synchronous execution: once the script
    // awaits, that budget stops applying, so a loop like this would keep
    // driving the real widget after the caller was handed an error. It is also
    // why time alone is not enough — the loop must be bounded by what it DOES.
    const ctx = makeCtx() as unknown as {
      widgetService: { invokeAction: { mock: { calls: unknown[] } } };
    };
    const tool = buildWidgetExecTool(ctx as never, { instanceId: 'w1' } as never);
    const result = (await tool.handler({
      instanceId: 'w1',
      code: 'while (true) { await widget.bump({}); }',
    } as never)) as Record<string, unknown>;

    expect(result['ok']).toBe(false);
    expect(String(result['error'])).toMatch(/exceeded/i);

    // Bounded, and it really stopped: the count does not keep climbing.
    const after = ctx.widgetService.invokeAction.mock.calls.length;
    expect(after).toBeLessThanOrEqual(1_100);
    await new Promise((r) => setTimeout(r, 200));
    expect(ctx.widgetService.invokeAction.mock.calls.length).toBe(after);
  }, 30_000);

  it('still runs an ordinary script and returns its value', async () => {
    const result = await run('await widget.bump(); log("hi"); return 42;');
    expect(result['ok']).toBe(true);
    expect(result['returned']).toBe(42);
    expect(result['logs']).toEqual(['hi']);
  });
});
