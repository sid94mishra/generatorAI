import { describe, it, expect } from 'vitest';
import { compileSandboxedPageFunction, SandboxedCompileError } from '../SandboxedEval.js';

// A stand-in for Playwright's `page`: a host-realm object graph with
// methods, a nested namespace, promise-returning calls and a sync factory
// that returns another host object — the shapes agent code actually walks.
function makeFakePage() {
  const clicks: string[] = [];
  return {
    clicks,
    async title() {
      return 'Example Domain';
    },
    async evaluate(fn: (...a: unknown[]) => unknown) {
      // Playwright stringifies the function; assert we at least receive one.
      return typeof fn === 'function' ? 'evaluated' : 'not-a-function';
    },
    url() {
      return 'https://example.com/';
    },
    mouse: {
      async click(x: number, y: number) {
        clicks.push(`${x},${y}`);
      },
    },
    locator(selector: string) {
      return {
        selector,
        async click() {
          clicks.push(selector);
        },
        async count() {
          return 3;
        },
      };
    },
    async setViewportSize(size: { width: number; height: number }) {
      return `${size.width}x${size.height}`;
    },
    frames() {
      return [{ name: () => 'main' }, { name: () => 'child' }];
    },
  };
}

const run = async (code: string): Promise<unknown> => {
  const fn = compileSandboxedPageFunction<ReturnType<typeof makeFakePage>>(code);
  return fn(makeFakePage());
};

describe('SandboxedEval — host realm containment', () => {
  // The regression this module exists for: `o.constructor.constructor` on
  // ANY host value used to compile a function in the host realm, whose
  // scope chain reaches `process` — i.e. every API key in the environment.
  it('does not leak process.env through the this.constructor chain', async () => {
    const result = await run(
      "try { return this.constructor.constructor('return process.env.USERNAME')(); } catch (e) { return 'BLOCKED:' + e.message; }",
    );
    expect(String(result)).toMatch(/^BLOCKED:/);
  });

  it('does not leak process.env through the page.constructor chain', async () => {
    const result = await run(
      "try { return page.constructor.constructor('return process.env')(); } catch (e) { return 'BLOCKED:' + e.message; }",
    );
    expect(String(result)).toMatch(/^BLOCKED:/);
  });

  it('does not leak process through a nested namespace on page', async () => {
    const result = await run(
      "try { return page.mouse.constructor.constructor('return typeof process')(); } catch (e) { return 'BLOCKED:' + e.message; }",
    );
    expect(String(result)).toMatch(/^BLOCKED:/);
  });

  it('does not leak process through an injected global (console)', async () => {
    const result = await run(
      "try { return console.log.constructor('return typeof process')(); } catch (e) { return 'BLOCKED:' + e.message; }",
    );
    expect(String(result)).toMatch(/^BLOCKED:/);
  });

  it('does not leak process via Object.getPrototypeOf(page)', async () => {
    const result = await run(
      "try { return Object.getPrototypeOf(page).constructor.constructor('return typeof process')(); } catch (e) { return 'BLOCKED:' + e.message; }",
    );
    expect(String(result)).toMatch(/^BLOCKED:/);
  });

  // The vm realm has its own Function; it must compile against the vm
  // global, where Node's globals simply do not exist.
  it('vm-realm Function cannot see process or require', async () => {
    expect(await run("return Function('return typeof process')();")).toBe('undefined');
    expect(await run("return Function('return typeof require')();")).toBe('undefined');
  });

  it('has no require, process or globalThis.process in scope', async () => {
    expect(await run('return typeof require;')).toBe('undefined');
    expect(await run('return typeof process;')).toBe('undefined');
    expect(await run('return typeof globalThis.process;')).toBe('undefined');
  });

  it('cannot dynamically import node builtins', async () => {
    const result = await run(
      "try { const m = await import('node:fs'); return 'LEAK:' + typeof m.readFileSync; } catch (e) { return 'BLOCKED:' + e.message; }",
    );
    expect(String(result)).toMatch(/^BLOCKED:/);
  });
});

describe('SandboxedEval — Playwright ergonomics still work', () => {
  it('awaits async page methods', async () => {
    expect(await run('return await page.title();')).toBe('Example Domain');
  });

  it('calls sync page methods', async () => {
    expect(await run('return page.url();')).toBe('https://example.com/');
  });

  it('passes functions through to page.evaluate', async () => {
    expect(await run('return await page.evaluate(() => 1 + 1);')).toBe('evaluated');
  });

  it('walks nested namespaces and mutates host state', async () => {
    expect(await run('await page.mouse.click(12, 34); return page.clicks[0];')).toBe('12,34');
  });

  it('supports the sync-factory-then-await shape (locator)', async () => {
    expect(await run("return await page.locator('#submit').count();")).toBe(3);
    expect(await run("await page.locator('#submit').click(); return page.clicks[0];")).toBe('#submit');
  });

  it('passes plain option objects into host calls', async () => {
    expect(await run('return await page.setViewportSize({ width: 800, height: 600 });')).toBe('800x600');
  });

  it('supports array results and array methods', async () => {
    expect(await run('return page.frames().length;')).toBe(2);
    expect(await run('return page.frames().map((f) => f.name()).join(",");')).toBe('main,child');
  });

  it('keeps object identity stable across property reads', async () => {
    expect(await run('return page.mouse === page.mouse;')).toBe(true);
  });

  it('returns plain JSON-serialisable data unchanged', async () => {
    expect(await run('return { a: 1, b: [2, 3] };')).toEqual({ a: 1, b: [2, 3] });
  });

  it('unwraps a returned host object so callers see the real value', async () => {
    // `page.clicks` is a host array; the caller must not receive a proxy.
    const result = await run('await page.mouse.click(1, 2); return page.clicks;');
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual(['1,2']);
  });

  it('propagates errors thrown by agent code', async () => {
    await expect(run("throw new Error('boom');")).rejects.toThrow('boom');
  });

  it('reports a syntax error as SandboxedCompileError', () => {
    expect(() => compileSandboxedPageFunction('return (;')).toThrow(SandboxedCompileError);
  });
});
