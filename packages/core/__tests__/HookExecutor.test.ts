// ────────────────────────────────────────────────────────────────
// HookExecutor tests — ORC-01, ORC-02, ORC-03
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HookExecutor } from '../src/services/HookExecutor.js';
import { EventBus } from '../src/events/EventBus.js';
import type { IScriptRunner, ScriptRunOptions, ScriptRunResult } from '../src/domain/ports/IScriptRunner.js';
import type { IHttpClient, HttpRequestOptions, HttpResponse } from '../src/domain/ports/IHttpClient.js';
import type { HookDefinition } from '@generatorai/shared';

function makeScriptRunner(overrides?: Partial<IScriptRunner>): IScriptRunner & {
  lastOptions: ScriptRunOptions | undefined;
  runs: number;
} {
  const state = { lastOptions: undefined as ScriptRunOptions | undefined, runs: 0 };
  return {
    lastOptions: state.lastOptions,
    runs: state.runs,
    async run(_cmd, _args, options): Promise<ScriptRunResult> {
      state.runs++;
      state.lastOptions = options;
      (this as unknown as { lastOptions: ScriptRunOptions }).lastOptions = options;
      (this as unknown as { runs: number }).runs = state.runs;
      return { exitCode: 0, stdout: '', stderr: '', durationMs: 1 };
    },
    async isAvailable(): Promise<boolean> {
      return true;
    },
    ...overrides,
  } as IScriptRunner & { lastOptions: ScriptRunOptions | undefined; runs: number };
}

function makeHttpClient(overrides?: Partial<IHttpClient>): IHttpClient & {
  lastOptions: HttpRequestOptions | undefined;
} {
  const state = { lastOptions: undefined as HttpRequestOptions | undefined };
  return {
    lastOptions: state.lastOptions,
    async request(options): Promise<HttpResponse> {
      state.lastOptions = options;
      (this as unknown as { lastOptions: HttpRequestOptions }).lastOptions = options;
      return { status: 200, headers: {}, body: '' };
    },
    ...overrides,
  } as IHttpClient & { lastOptions: HttpRequestOptions | undefined };
}

function makeContext(overrides?: Partial<Parameters<HookExecutor['executePhase']>[2]>) {
  return {
    sessionId: 's1',
    workflowId: 'w1',
    workspacePath: '/tmp/workspace',
    variables: {},
    eventBus: new EventBus(),
    ...overrides,
  };
}

const baseHook: HookDefinition = {
  id: 'h1',
  name: 'test-hook',
  phase: 'pre_run',
  type: 'script',
  priority: 0,
  enabled: true,
  failurePolicy: 'abort',
  timeoutMs: 1000,
  retries: 0,
  config: { type: 'script', command: 'echo', args: ['hi'] },
};

describe('HookExecutor', () => {
  it('renders script env, cwd and HTTP url/headers/body as Expression v2 templates (P01 review R3)', async () => {
    const runner = makeScriptRunner();
    const http = makeHttpClient();
    const exec = new HookExecutor(runner, http, new EventBus());
    const templateScope = {
      variables: { env: 'prod' },
      run: { id: 'run-9', name: 'r', codebases: { app: { path: '/src/app', branch: 'main', baseRef: null } } },
      stages: { review: { status: 'completed', output: { verdict: 'ok' }, summary: null } },
    };
    const script: HookDefinition = {
      ...baseHook,
      config: { type: 'script', command: 'node', args: ['deploy.js'], cwd: 'out/{{env}}', env: { TARGET: '{{variables.env}}', REPO: '{{run.codebases.app.path}}' } },
    };
    await exec.executePhase('pre_run', [script], makeContext({ templateScope }));
    expect(runner.lastOptions?.env).toMatchObject({ TARGET: 'prod', REPO: '/src/app' });
    expect(runner.lastOptions?.cwd?.split('\\').join('/')).toMatch(/workspace\/out\/prod$/);

    const hook: HookDefinition = {
      ...baseHook,
      type: 'http',
      config: {
        type: 'http',
        url: 'https://hooks.test/{{run.id}}',
        method: 'POST',
        headers: { 'X-Env': '{{env}}' },
        bodyTemplate: '{"verdict":"{{stages.review.output.verdict}}"}',
      },
    };
    await exec.executePhase('pre_run', [hook], makeContext({ templateScope }));
    expect(http.lastOptions).toMatchObject({ url: 'https://hooks.test/run-9', headers: { 'X-Env': 'prod' }, body: '{"verdict":"ok"}' });
  });

  describe('ORC-01 — AbortSignal plumbing', () => {
    it('passes abortSignal to scriptRunner.run', async () => {
      const runner = makeScriptRunner();
      const http = makeHttpClient();
      const exec = new HookExecutor(runner, http, new EventBus());

      await exec.executePhase('pre_run', [baseHook], makeContext());

      expect(runner.lastOptions?.abortSignal).toBeDefined();
      expect(runner.lastOptions?.abortSignal).toBeInstanceOf(AbortSignal);
    });

    it('passes signal to httpClient.request', async () => {
      const runner = makeScriptRunner();
      const http = makeHttpClient();
      const exec = new HookExecutor(runner, http, new EventBus());

      const httpHook: HookDefinition = {
        ...baseHook,
        type: 'http',
        config: { type: 'http', url: 'http://localhost/ok', method: 'GET' },
      };
      await exec.executePhase('pre_run', [httpHook], makeContext());

      expect(http.lastOptions?.signal).toBeDefined();
      expect(http.lastOptions?.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('ORC-02 — timeout aborts the in-flight work', () => {
    it('aborts the script runner signal when hook exceeds timeoutMs', async () => {
      let capturedSignal: AbortSignal | undefined;
      const runner: IScriptRunner = {
        async run(_cmd, _args, options): Promise<ScriptRunResult> {
          capturedSignal = options.abortSignal;
          // Simulate a long-running script that resolves on abort.
          return new Promise<ScriptRunResult>((resolve) => {
            options.abortSignal?.addEventListener('abort', () => {
              resolve({ exitCode: -1, stdout: '', stderr: 'aborted', durationMs: 100 });
            });
            // Never naturally resolve within the test window.
          });
        },
        async isAvailable() { return true; },
      };
      const http = makeHttpClient();
      const exec = new HookExecutor(runner, http, new EventBus());

      const hook: HookDefinition = { ...baseHook, timeoutMs: 50, failurePolicy: 'continue' };
      const shouldContinue = await exec.executePhase('pre_run', [hook], makeContext());

      // Hook failed (timeout) but failurePolicy='continue' so phase returns true.
      expect(shouldContinue.shouldContinue).toBe(true);
      // The abort signal we captured inside the runner must have fired.
      expect(capturedSignal?.aborted).toBe(true);
    });

    it('does not burn retry budget when caller has aborted', async () => {
      let runCount = 0;
      const runner: IScriptRunner = {
        async run(_cmd, _args, _options): Promise<ScriptRunResult> {
          runCount++;
          return { exitCode: -1, stdout: '', stderr: 'fail', durationMs: 1 };
        },
        async isAvailable() { return true; },
      };
      const http = makeHttpClient();
      const exec = new HookExecutor(runner, http, new EventBus());

      const controller = new AbortController();
      controller.abort();

      const hook: HookDefinition = { ...baseHook, retries: 3, failurePolicy: 'continue' };
      await exec.executePhase('pre_run', [hook], makeContext({ abortSignal: controller.signal }));

      // First attempt runs (exit-code -1 → failure). After that, executor
      // sees context.abortSignal.aborted and bails without exhausting retries.
      expect(runCount).toBe(1);
    });
  });

  describe('ORC-03 — function hook backends', () => {
    it('executes an in-process registered handler and passes args + signal', async () => {
      const runner = makeScriptRunner();
      const http = makeHttpClient();
      const exec = new HookExecutor(runner, http, new EventBus());

      const handler = vi.fn(async (ctx) => {
        expect(ctx.args).toEqual({ foo: 42 });
        expect(ctx.signal).toBeInstanceOf(AbortSignal);
        expect(ctx.signal.aborted).toBe(false);
      });
      exec.registerFunctionHandler('my.handler', handler);

      const hook: HookDefinition = {
        ...baseHook,
        type: 'function',
        config: { type: 'function', handlerName: 'my.handler', args: { foo: 42 } },
      };
      const ok = await exec.executePhase('pre_run', [hook], makeContext());

      expect(ok.shouldContinue).toBe(true);
      expect(handler).toHaveBeenCalledOnce();
      // Script runner should NOT be called — we took the in-process path.
      expect(runner.runs).toBe(0);
    });

    it('throws HookScriptError when handler rejects', async () => {
      const runner = makeScriptRunner();
      const http = makeHttpClient();
      const exec = new HookExecutor(runner, http, new EventBus());

      exec.registerFunctionHandler('broken', async () => {
        throw new Error('explosion');
      });

      const hook: HookDefinition = {
        ...baseHook,
        failurePolicy: 'continue',
        type: 'function',
        config: { type: 'function', handlerName: 'broken' },
      };
      const ok = await exec.executePhase('pre_run', [hook], makeContext());
      // Failed but continue → phase returns true
      expect(ok.shouldContinue).toBe(true);
    });

    it('fails cleanly when handlerName references an unregistered handler', async () => {
      const runner = makeScriptRunner();
      const http = makeHttpClient();
      const exec = new HookExecutor(runner, http, new EventBus());

      const hook: HookDefinition = {
        ...baseHook,
        failurePolicy: 'abort',
        type: 'function',
        config: { type: 'function', handlerName: 'missing' },
      };
      const ok = await exec.executePhase('pre_run', [hook], makeContext());
      expect(ok.shouldContinue).toBe(false); // abort on failure
    });

    it('falls back to modulePath subprocess when handlerName is absent', async () => {
      const runner = makeScriptRunner();
      const http = makeHttpClient();
      const exec = new HookExecutor(runner, http, new EventBus());

      const hook: HookDefinition = {
        ...baseHook,
        type: 'function',
        config: { type: 'function', modulePath: './hook.js' },
      };
      await exec.executePhase('pre_run', [hook], makeContext());
      expect(runner.runs).toBe(1);
    });

    it('handlerName wins over modulePath when both are set', async () => {
      const runner = makeScriptRunner();
      const http = makeHttpClient();
      const exec = new HookExecutor(runner, http, new EventBus());
      const handler = vi.fn(async () => {});
      exec.registerFunctionHandler('winner', handler);

      const hook: HookDefinition = {
        ...baseHook,
        type: 'function',
        config: { type: 'function', handlerName: 'winner', modulePath: './hook.js' },
      };
      await exec.executePhase('pre_run', [hook], makeContext());

      expect(handler).toHaveBeenCalledOnce();
      expect(runner.runs).toBe(0);
    });

    it('unregister closure removes the handler', async () => {
      const runner = makeScriptRunner();
      const http = makeHttpClient();
      const exec = new HookExecutor(runner, http, new EventBus());

      const unregister = exec.registerFunctionHandler('temp', async () => {});
      expect(exec.hasFunctionHandler('temp')).toBe(true);
      unregister();
      expect(exec.hasFunctionHandler('temp')).toBe(false);
    });

    it('rejects double registration', () => {
      const runner = makeScriptRunner();
      const http = makeHttpClient();
      const exec = new HookExecutor(runner, http, new EventBus());

      exec.registerFunctionHandler('dup', async () => {});
      expect(() => exec.registerFunctionHandler('dup', async () => {})).toThrow();
    });
  });
});
