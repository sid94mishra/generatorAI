// ────────────────────────────────────────────────────────────────
// W13 — the hardening is WIRED, not merely available.
//
// "Built but never wired" is the failure mode this package's audit names
// eleven times (`docs/V2_REMAINING_WORK_AUDIT.md` §0, §3). These tests drive
// the SHIPPED tool factories — the same functions `ClaudeAgentProvider` and
// `CopilotProvider` call — and assert the mechanisms actually engage on the
// path a real tool call takes. Deleting `runGuarded` from either factory turns
// this file red.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import type { ToolDefinition } from '@generatorai/core';

import { buildClaudeAgentMcpTools } from '../../src/providers/claude-agent/tool-factory.js';
import { buildSdkTools } from '../../src/providers/copilot/tool-factory.js';
import { ToolSemaphore, MAX_PARALLEL_TOOLS, DEFAULT_TOOL_TIMEOUT_MS } from '../../src/toolSemaphore.js';

type McpHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}>;

/**
 * Reach the handler the SDK will actually invoke.
 *
 * `createSdkMcpServer` returns `{type, name, instance}` where `instance` is an
 * `@modelcontextprotocol/sdk` McpServer holding `_registeredTools[name]`.
 * Reaching through it is deliberate: the alternative is asserting against a
 * copy of the handler, which is exactly what made the old
 * `truncation-guard.test.ts` worthless as regression evidence.
 */
function claudeHandlers(defs: ToolDefinition[], sem?: ToolSemaphore, convId?: string): McpHandler[] {
  const { mcpServerConfig } = buildClaudeAgentMcpTools(defs, sem, convId);
  const registered = (mcpServerConfig as unknown as {
    instance?: { _registeredTools?: Record<string, { handler?: McpHandler; callback?: McpHandler }> };
  }).instance?._registeredTools;
  if (!registered) throw new Error('could not reach the SDK tool registry — the SDK shape changed');
  return defs.map((d) => {
    const entry = registered[d.name];
    const fn = entry?.handler ?? entry?.callback;
    if (!fn) throw new Error(`tool "${d.name}" was not registered with the SDK`);
    return fn;
  });
}

function def(name: string, handler: ToolDefinition['handler']): ToolDefinition {
  return {
    name,
    description: `test tool ${name}`,
    parametersSchema: { type: 'object', properties: {} },
    handler,
  } as ToolDefinition;
}

describe('W13 — MAX_PARALLEL_TOOLS lives in one place', () => {
  it('is 8 by default', () => {
    expect(MAX_PARALLEL_TOOLS).toBe(8);
  });

  it('a ToolSemaphore is hardened by DEFAULT, not by opt-in', () => {
    const sem = new ToolSemaphore(MAX_PARALLEL_TOOLS);
    // A provider that only ever wrote `new ToolSemaphore(MAX_PARALLEL_TOOLS)`
    // still gets every mechanism. That is the whole design: nothing here needs
    // a call site to remember to enable it.
    expect(sem.poison).toBeDefined();
    expect(sem.byteCap).toBeDefined();
    expect(sem.latch).toBeDefined();
    expect(sem.perItemTimeoutMs).toBe(DEFAULT_TOOL_TIMEOUT_MS);
  });
});

describe('W13 — claude-agent tool factory', () => {
  it('bounds concurrent handler invocations to the semaphore permits', async () => {
    const sem = new ToolSemaphore(2);
    let active = 0;
    let maxActive = 0;
    const [handler] = claudeHandlers(
      [def('Slow', async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 5));
        active -= 1;
        return 'done';
      })],
      sem,
    );

    await Promise.all(Array.from({ length: 6 }, () => handler!({})));
    expect(maxActive).toBe(2);
  });

  it('REFUSES to execute after the turn is marked truncated (B1)', async () => {
    const sem = new ToolSemaphore(8);
    let ran = false;
    const [handler] = claudeHandlers([def('Write', async () => { ran = true; return 'wrote'; })], sem, 'conv-1');

    sem.beginTurn('conv-1');
    const ok = await handler!({ file_path: '/danger' });
    expect(ok.isError).toBeFalsy();
    expect(ran).toBe(true);

    ran = false;
    sem.markTruncated('conv-1', 'length');
    const out = await handler!({ file_path: '/danger' });
    // The handler body did not run: no half-argument write happened (X-2).
    expect(ran).toBe(false);
    expect(out.isError).toBe(true);
    expect(out.content[0]?.text).toMatch(/cut off before it finished/);
    expect(out.content[0]?.text).toMatch(/stop reason: length/);
  });

  it('applies the per-record byte cap to the text the model receives', async () => {
    const sem = new ToolSemaphore(8, { byteCap: new (await import('../../src/hardening/byteCap.js')).ByteCapper({ capBytes: 200 }) });
    const [handler] = claudeHandlers([def('Read', async () => 'x'.repeat(50_000))], sem);
    const out = await handler!({});
    const text = out.content[0]?.text ?? '';
    expect(text.length).toBeLessThan(1_000);
    expect(text).toMatch(/\[result dropped\]/);
    expect(text).toContain('Read');
    expect(sem.byteCap.stats.cappedCount).toBe(1);
  });

  it('quarantines a repeatedly-failing tool through the poison ladder', async () => {
    const sem = new ToolSemaphore(8);
    let invocations = 0;
    const [handler] = claudeHandlers(
      [def('Broken', async () => { invocations += 1; throw new Error('wedged'); })],
      sem,
    );

    for (let i = 0; i < 5; i++) await handler!({});
    expect(sem.poison.statusOf('Broken')).toBe('quarantined');

    const before = invocations;
    const out = await handler!({});
    expect(invocations).toBe(before); // never reached the body
    expect(out.isError).toBe(true);
    expect(out.content[0]?.text).toMatch(/disabled for the rest of this batch/);
  });

  it('reaps a wedged handler at the per-item timeout instead of hanging the turn', async () => {
    const sem = new ToolSemaphore(8, { perItemTimeoutMs: 60 });
    const [handler] = claudeHandlers([def('Wedged', () => new Promise<string>(() => { /* never */ }))], sem);
    const out = await handler!({});
    expect(out.isError).toBe(true);
    expect(out.content[0]?.text).toMatch(/exceeded its 60ms budget/);
  });
});

describe('W13 — copilot tool factory', () => {
  const handlerOf = (tool: unknown): ((args: unknown) => Promise<unknown>) =>
    (tool as { handler: (args: unknown) => Promise<unknown> }).handler;

  it('bounds concurrent handler invocations to the semaphore permits', async () => {
    const sem = new ToolSemaphore(2);
    let active = 0;
    let maxActive = 0;
    const [tool] = buildSdkTools(
      [def('Slow', async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 5));
        active -= 1;
        return 'done';
      })],
      sem,
    );

    await Promise.all(Array.from({ length: 6 }, () => handlerOf(tool)({})));
    expect(maxActive).toBe(2);
  });

  it('REFUSES to execute after the turn is marked truncated (B1)', async () => {
    const sem = new ToolSemaphore(8);
    let ran = false;
    const [tool] = buildSdkTools([def('Write', async () => { ran = true; return 'wrote'; })], sem, 'conv-1');

    sem.markTruncated('conv-1', 'length');
    // The Copilot SDK surfaces a thrown handler as a tool error; the point is
    // that the body never ran.
    await expect(handlerOf(tool)({})).rejects.toThrow(/cut off before it finished/);
    expect(ran).toBe(false);
  });

  it('drops an oversized result rather than sending it to the model', async () => {
    const { ByteCapper } = await import('../../src/hardening/byteCap.js');
    const sem = new ToolSemaphore(8, { byteCap: new ByteCapper({ capBytes: 200 }) });
    const [tool] = buildSdkTools([def('Read', async () => 'y'.repeat(50_000))], sem);
    const result = await handlerOf(tool)({});
    expect(String(result)).toMatch(/\[result dropped\]/);
    expect(String(result).length).toBeLessThan(1_000);
  });

  it('passes a within-cap result through unchanged, preserving the domain result shape', async () => {
    const sem = new ToolSemaphore(8);
    const structured = { ok: true, rows: [1, 2, 3] };
    const [tool] = buildSdkTools([def('Query', async () => structured)], sem);
    await expect(handlerOf(tool)({})).resolves.toBe(structured);
  });
});
