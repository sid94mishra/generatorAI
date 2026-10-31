import { describe, expect, it } from 'vitest';
import { fitReport, runInQuickJs, type SandboxTool } from '../sandbox.js';
import { buildCodeModeTool, toScriptValue } from '../codeModeTool.js';
import type { ToolDefinition } from '../../../domain/ports/IAgentHarness.js';

const echo: SandboxTool = async (args) => ({ got: args });

describe('runInQuickJs', () => {
  it('returns the script value', async () => {
    const r = await runInQuickJs('return { sum: [1, 2, 3].reduce((a, b) => a + b, 0) };', {});
    expect(r.error).toBeUndefined();
    expect(r.result).toEqual({ sum: 6 });
    expect(r.calls).toEqual([]);
  });

  it('captures console output', async () => {
    const r = await runInQuickJs('console.log("a", 1, { b: 2 }); console.warn("careful"); return null;', {});
    expect(r.logs).toEqual(['a 1 {"b":2}', '[warn] careful']);
  });

  it('round-trips tool args and results, sequentially and in parallel', async () => {
    const seen: unknown[] = [];
    const tools: Record<string, SandboxTool> = {
      double: async (args) => {
        seen.push(args);
        await new Promise((r) => setTimeout(r, 5));
        return { n: (args['n'] as number) * 2 };
      },
    };
    const r = await runInQuickJs(
      'const a = await tools.double({ n: 2 }); const [b, c] = await Promise.all([tools.double({ n: a.n }), tools.double({ n: 10 })]); return [a.n, b.n, c.n];',
      tools,
    );
    expect(r.error).toBeUndefined();
    expect(r.result).toEqual([4, 8, 20]);
    expect(seen).toEqual([{ n: 2 }, { n: 4 }, { n: 10 }]);
    expect(r.calls.map((c) => [c.tool, c.ok])).toEqual([['double', true], ['double', true], ['double', true]]);
    expect(r.calls.every((c) => typeof c.ms === 'number')).toBe(true);
  });

  it('makes a tool failure a catchable exception', async () => {
    const tools: Record<string, SandboxTool> = {
      boom: async () => {
        throw new Error('not allowed');
      },
    };
    const r = await runInQuickJs(
      'try { await tools.boom({}); return "no"; } catch (e) { return e.message; }',
      tools,
    );
    expect(r.error).toBeUndefined();
    expect(r.result).toBe('tools.boom failed: not allowed');
    expect(r.calls).toEqual([expect.objectContaining({ tool: 'boom', ok: false, error: 'not allowed' })]);
  });

  it('reports an uncaught error with the logs and calls so far', async () => {
    const r = await runInQuickJs('console.log("before"); await tools.echo({ x: 1 }); throw new Error("bad");', { echo });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('bad');
    expect(r.logs).toEqual(['before']);
    expect(r.calls).toHaveLength(1);
  });

  it('stops a synchronous infinite loop at the deadline', async () => {
    const t0 = Date.now();
    const r = await runInQuickJs('while (true) {}', {}, { timeoutMs: 300 });
    expect(r.error).toMatch(/deadline/);
    expect(Date.now() - t0).toBeLessThan(5_000);
  });

  it('stops an infinite loop after an await at the deadline', async () => {
    const r = await runInQuickJs('await tools.echo({}); for (;;) {}', { echo }, { timeoutMs: 300 });
    expect(r.error).toMatch(/deadline/);
  });

  it('stops a script that awaits a slow tool at the deadline', async () => {
    const slow: SandboxTool = () => new Promise((r) => setTimeout(r, 5_000));
    const t0 = Date.now();
    const r = await runInQuickJs('await tools.slow({}); return 1;', { slow }, { timeoutMs: 200 });
    expect(r.error).toMatch(/deadline/);
    expect(Date.now() - t0).toBeLessThan(2_000);
  });

  it('stops a memory bomb at the memory limit', async () => {
    const r = await runInQuickJs(
      'const a = []; for (;;) a.push("x".repeat(1024 * 1024) + a.length);',
      {},
      { memoryBytes: 16 * 1024 * 1024, timeoutMs: 20_000 },
    );
    expect(r.error).toMatch(/memory/i);
  });

  it('fails deep recursion instead of crashing', async () => {
    const r = await runInQuickJs('const f = (n) => f(n + 1) + 1; return f(0);', {});
    expect(r.error).toMatch(/stack|recursion/i);
  });

  it('refuses tool calls past the cap', async () => {
    const r = await runInQuickJs(
      'let n = 0; try { for (;;) { await tools.echo({}); n++; } } catch (e) { return [n, e.message]; }',
      { echo },
      { maxCalls: 200 },
    );
    expect(r.result).toEqual([200, 'run_code allows at most 200 tool calls per script.']);
    expect(r.calls).toHaveLength(200);
  });

  it('caps the output and marks it truncated', async () => {
    const r = await runInQuickJs(
      'for (let i = 0; i < 100; i++) console.log("line " + i + " " + "y".repeat(500)); return "z".repeat(50000);',
      {},
      { maxOutputChars: 24_000 },
    );
    expect(r.truncated).toBe(true);
    expect(JSON.stringify(r).length).toBeLessThanOrEqual(24_000);
    expect(typeof r.result).toBe('string');
    expect(String(r.result)).toMatch(/characters truncated/);
  });

  it('exposes nothing but tools and console', async () => {
    const r = await runInQuickJs(
      'return [typeof require, typeof process, typeof fetch, typeof setTimeout, typeof std, typeof os, typeof module, typeof Deno, typeof Buffer].join(",");',
      {},
    );
    expect(r.result).toBe(Array(9).fill('undefined').join(','));
    const dyn = await runInQuickJs('const m = await import("node:fs"); return typeof m;', {});
    expect(dyn.error).toBeDefined();
    expect(dyn.result).toBeUndefined();
    const stat = await runInQuickJs('import fs from "node:fs"; return 1;', {});
    expect(stat.error).toMatch(/SyntaxError|import/i);
  });

  it('passes non-object arguments as a type error', async () => {
    const r = await runInQuickJs('try { await tools.echo("x"); } catch (e) { return e.message; }', { echo });
    expect(r.result).toBe('tools.echo(args) takes one object argument.');
  });
});

describe('fitReport', () => {
  it('leaves a small report alone', () => {
    const r = { ok: true, result: 1, logs: ['a'], calls: [] };
    expect(fitReport(r, 1000)).toBe(r);
  });

  it('cuts logs and calls to fit', () => {
    const r = {
      ok: true,
      logs: Array.from({ length: 200 }, (_, i) => `log ${i} ${'x'.repeat(100)}`),
      calls: Array.from({ length: 200 }, (_, i) => ({ tool: `t${i}`, ok: true, ms: 1 })),
    };
    const out = fitReport(r, 4_000);
    expect(out.truncated).toBe(true);
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(4_000);
  });
});

describe('buildCodeModeTool', () => {
  const tool = (name: string, handler: ToolDefinition['handler'], extra: Partial<ToolDefinition> = {}): ToolDefinition => ({
    name,
    description: `${name} tool.\nMore text.`,
    parametersSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
    handler,
    ...extra,
  });

  it('lists the other tools and calls their handlers with parsed results', async () => {
    const calls: Array<[Record<string, unknown>, unknown]> = [];
    const search = tool('search', async (args, ctx) => {
      calls.push([args, ctx]);
      return JSON.stringify({ hits: [args['q']] });
    });
    const plain = tool('plain', async () => 'just text');
    const runCode = buildCodeModeTool([search, plain, { ...search, name: 'run_code' }]);
    expect(runCode.name).toBe('run_code');
    expect(runCode.description).toContain('- search(args: {q: string}): Promise<unknown> — search tool.');
    expect(runCode.description).toContain('- plain(');
    expect(runCode.description).not.toMatch(/- run_code\(/);

    const text = (await runCode.handler(
      { code: 'const r = await tools.search({ q: "hi" }); const p = await tools.plain({ q: "" }); return [r.hits[0], p];' },
      { toolCallId: 'call-1' },
    )) as string;
    const report = JSON.parse(text);
    expect(report.result).toEqual(['hi', 'just text']);
    expect(report.calls.map((c: { tool: string }) => c.tool)).toEqual(['search', 'plain']);
    expect(calls[0]).toEqual([{ q: 'hi' }, { toolCallId: 'call-1:1' }]);
  });

  it('turns a refusing handler (an approval gate) into a catchable error', async () => {
    const gated = tool('merge', async () => {
      throw new Error('Using merge was not allowed.');
    });
    const runCode = buildCodeModeTool([gated]);
    const report = JSON.parse(
      (await runCode.handler({ code: 'try { await tools.merge({ q: "x" }); } catch (e) { return e.message; }' })) as string,
    );
    expect(report.result).toBe('tools.merge failed: Using merge was not allowed.');
    expect(report.calls[0]).toMatchObject({ tool: 'merge', ok: false });
  });

  it('applies a tool\'s own budget to calls from a script', async () => {
    const slow = tool('slow', () => new Promise((r) => setTimeout(r, 2_000)), { timeoutMs: 50 });
    const report = JSON.parse(
      (await buildCodeModeTool([slow]).handler({ code: 'try { await tools.slow({ q: "" }); } catch (e) { return e.message; }' })) as string,
    );
    expect(report.result).toMatch(/slow timed out/);
  });

  it('clamps the deadline and refuses empty code', async () => {
    const runCode = buildCodeModeTool([]);
    await expect(runCode.handler({ code: '  ' })).rejects.toThrow(/code is required/);
    const report = JSON.parse((await runCode.handler({ code: 'return 1', timeoutSeconds: 10_000 })) as string);
    expect(report.result).toBe(1);
  });
});

describe('toScriptValue', () => {
  it('parses JSON text, keeps other text and drops binaries', () => {
    expect(toScriptValue('{"a":1}')).toEqual({ a: 1 });
    expect(toScriptValue('hello')).toBe('hello');
    expect(toScriptValue({ ok: true, __binary: [{ data: 'x', mimeType: 'image/png' }] })).toEqual({ ok: true, attachmentsOmitted: 1 });
    expect(toScriptValue(undefined)).toBeUndefined();
  });
});
