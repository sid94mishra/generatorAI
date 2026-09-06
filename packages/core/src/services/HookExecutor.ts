// ────────────────────────────────────────────────────────────────
// HookExecutor — executes hook definitions (script / http / function)
//
// Responsibilities:
//   - Execute all hooks registered for a phase, in priority order.
//   - Enforce per-hook timeout with end-to-end cancellation (ORC-01, ORC-02).
//   - Support three hook backends (ORC-03):
//       • `script`    → sandboxed subprocess via IScriptRunner
//       • `http`      → outbound HTTP via IHttpClient
//       • `function`  → EITHER an in-process registered callback (trusted,
//                        shares the server's memory/DI container) OR a
//                        subprocess executing a user-supplied Node module.
//
// Cancellation semantics (ORC-01, ORC-02)
// ------------------------------------------------------------------
// Each hook invocation creates its own AbortController. When the
// per-hook timer fires OR the caller aborts via an externally plumbed
// signal, we call `controller.abort()` and both the script child process
// and any in-flight fetch request are cancelled at their respective
// ports — no orphan processes, no dangling sockets. In the old
// implementation the Promise.race() rejected on timeout but the
// underlying work kept running until natural completion, burning CPU
// and tokens on results we had already discarded.
// ────────────────────────────────────────────────────────────────

import * as path from 'node:path';
import type { HookDefinition, HookPhase, HookResult, HookPhaseResult } from '@generatorai/shared';
import type { ScriptHookConfig, HttpHookConfig, FunctionHookConfig } from '@generatorai/shared';
import { HookTimeoutError, HookScriptError, HookHttpError, HookConfigError, sleep } from '@generatorai/shared';
import type { IScriptRunner } from '../domain/ports/IScriptRunner.js';
import type { IHttpClient } from '../domain/ports/IHttpClient.js';
import type { EventBus } from '../events/EventBus.js';

export interface HookContext {
  sessionId: string;
  workflowId: string;
  workspacePath: string;
  variables: Record<string, string>;
  eventBus: EventBus;
  /**
   * Owning workflow run id, when the hook executes inside a run. Stamped onto
   * the `hook.started/completed/failed` events so the EventBus→StreamBroker
   * bridge republishes them to scope='run' — otherwise workflow-level hook
   * lifecycle (emitted under a synthetic session id) never reaches the
   * run-scoped SSE stream and stays invisible in the run timeline.
   */
  workflowRunId?: string;
  /**
   * Owning stage run id, when the hook executes inside a stage. Stamped onto
   * the `hook.*` events so the run inspector can attribute a hook execution
   * to the stage that fired it without guessing from session ids.
   */
  stageRunId?: string;
  /**
   * ORC-01/02 — external cancellation signal plumbed from the caller
   * (StageExecutionService / WorkflowRunService). When this fires BEFORE
   * the hook's own timeout we cancel the hook's work immediately and
   * re-throw, propagating cancellation up the stage.
   */
  abortSignal?: AbortSignal;
}

/**
 * ORC-03 — signature for in-process function hook handlers.
 *
 * Handlers run inside the main Node process and share everything the
 * server has access to (DB, event bus, config). That makes them the right
 * fit for trusted system hooks but the wrong fit for user-supplied code —
 * user code MUST continue to run in a subprocess via `modulePath`.
 *
 * Callers receive the same shape the subprocess path serialises over
 * process.argv so registered handlers and module-path handlers are
 * interchangeable from the author's perspective.
 */
export interface FunctionHookHandlerContext {
  sessionId: string;
  workflowId: string;
  workspacePath: string;
  variables: Record<string, string>;
  /** Optional caller-supplied args from `FunctionHookConfig.args`. */
  args?: Record<string, unknown>;
  /** Fires when the hook's timeout expires or the caller aborts. */
  signal: AbortSignal;
}

export type FunctionHookHandler = (ctx: FunctionHookHandlerContext) => Promise<HookResult | void>;

/**
 * What a dry run reports for one hook: exactly what `executePhase` would have
 * dispatched, after variable interpolation and policy checks, with nothing
 * actually spawned, fetched or invoked.
 */
export interface HookDryRunEntry {
  hookId: string;
  name: string;
  phase: HookPhase;
  type: HookDefinition['type'];
  priority: number;
  timeoutMs: number;
  retries: number;
  failurePolicy: HookDefinition['failurePolicy'];
  /** False when the hook would be refused before doing any work. */
  valid: boolean;
  errors: string[];
  script?: { command: string; args: string[]; cwd: string; resolvedCommand?: string };
  http?: { method: string; url: string; headers?: Record<string, string>; body?: string };
  function?: { handlerName?: string; registered?: boolean; modulePath?: string; resolvedModulePath?: string };
}

export interface HookDryRunPlan {
  phase: HookPhase;
  dryRun: true;
  /** Every hook is dispatchable. */
  valid: boolean;
  /** Hooks that would fire, in dispatch order. */
  hooks: HookDryRunEntry[];
  /** Hooks passed in that would NOT fire for this phase, and why. */
  skipped: Array<{ hookId: string; name: string; reason: string }>;
}

export class HookExecutor {
  constructor(
    private scriptRunner: IScriptRunner,
    private httpClient: IHttpClient,
    private eventBus: EventBus,
  ) {}

  /**
   * ORC-03 — in-process handler registry keyed by `FunctionHookConfig.handlerName`.
   *
   * Populated by composition roots or feature plug-ins at boot time; lookup
   * happens per-hook so unregistering a handler immediately disables it for
   * all subsequent executions. Registry is process-local — nothing is
   * persisted, so restarting the server clears it and hooks must be
   * re-registered by the owning module.
   */
  private readonly functionHandlers = new Map<string, FunctionHookHandler>();

  /**
   * Register an in-process function-hook handler by name. Subsequent hooks
   * with `FunctionHookConfig.handlerName === name` will call `handler`
   * instead of spawning a subprocess. Returns an unregister closure.
   *
   * Example:
   *   hookExecutor.registerFunctionHandler('metrics.emit', async (ctx) => {
   *     meter.counter.add(1, { workflow: ctx.workflowId });
   *   });
   */
  registerFunctionHandler(name: string, handler: FunctionHookHandler): () => void {
    if (this.functionHandlers.has(name)) {
      throw new HookConfigError(`Function hook handler '${name}' is already registered`);
    }
    this.functionHandlers.set(name, handler);
    return () => {
      // Only unregister if it's still the same handler — prevents a late
      // unregister call (from a teardown that raced a re-register) from
      // silently removing the wrong handler.
      if (this.functionHandlers.get(name) === handler) {
        this.functionHandlers.delete(name);
      }
    };
  }

  /** Returns true if a handler with this name is registered. (Testing helper.) */
  hasFunctionHandler(name: string): boolean {
    return this.functionHandlers.has(name);
  }

  /**
   * Execute all hooks for a given phase, in priority order.
   * Returns a HookPhaseResult with shouldContinue flag and merged results from all hooks.
   *
   * Backward-compatible: callers that only need the boolean can use `.shouldContinue`.
   */
  async executePhase(
    phase: HookPhase,
    hooks: HookDefinition[],
    context: HookContext,
  ): Promise<HookPhaseResult> {
    const phaseHooks = hooks
      .filter((h) => h.phase === phase && h.enabled)
      .sort((a, b) => a.priority - b.priority);

    const mergedResult: HookResult = {};

    for (const hook of phaseHooks) {
      // Identity fields shared by every lifecycle event for this invocation,
      // so the run inspector can pair started/completed and attribute the
      // hook to its stage (see `deriveRunView` → Hooks tab).
      const identity = {
        hookName: hook.name,
        hookId: hook.id,
        hookType: hook.type,
        phase,
        workflowRunId: context.workflowRunId,
        stageRunId: context.stageRunId,
        sessionId: context.sessionId,
      };
      const startedAt = Date.now();
      await this.eventBus.emit(context.sessionId, {
        kind: 'hook.started',
        data: identity,
      });

      const result = await this.executeHookWithRetry(hook, context);
      const durationMs = Date.now() - startedAt;

      if (result.success) {
        // Merge hook result data
        if (result.hookResult) {
          HookExecutor.mergeHookResult(mergedResult, result.hookResult);
        }

        // Check if the hook itself requested an abort via its result
        if (result.hookResult?.abort) {
          await this.eventBus.emit(context.sessionId, {
            kind: 'hook.completed',
            data: { ...identity, durationMs },
          });
          return {
            shouldContinue: false,
            mergedResult: { ...mergedResult, abortReason: result.hookResult.abortReason ?? `Hook '${hook.name}' requested abort` },
          };
        }

        await this.eventBus.emit(context.sessionId, {
          kind: 'hook.completed',
          data: { ...identity, durationMs },
        });
      } else {
        await this.eventBus.emit(context.sessionId, {
          kind: 'hook.failed',
          data: { ...identity, durationMs, error: result.error! },
        });

        switch (hook.failurePolicy) {
          case 'abort':
            return { shouldContinue: false, mergedResult };
          case 'skip':
          case 'continue':
            break;
        }
      }
    }

    return { shouldContinue: true, mergedResult };
  }

  /**
   * Dry run — resolve which hooks WOULD fire for `phase`, render their
   * command lines / URLs / module paths with the context's variables, and
   * run every policy check, without dispatching anything. No child process,
   * no HTTP request, no in-process handler call.
   *
   * This backs `POST /sessions/:id/hooks/test`, which used to call
   * `executePhase` for real and label the result "dry-run".
   */
  async planPhase(
    phase: HookPhase,
    hooks: HookDefinition[],
    context: Omit<HookContext, 'eventBus'> & { eventBus?: EventBus },
  ): Promise<HookDryRunPlan> {
    const skipped: HookDryRunPlan['skipped'] = [];
    const candidates: HookDefinition[] = [];
    for (const hook of hooks) {
      if (hook.phase !== phase) {
        skipped.push({ hookId: hook.id, name: hook.name, reason: `registered for phase '${hook.phase}', not '${phase}'` });
      } else if (!hook.enabled) {
        skipped.push({ hookId: hook.id, name: hook.name, reason: 'disabled' });
      } else {
        candidates.push(hook);
      }
    }
    candidates.sort((a, b) => a.priority - b.priority);

    const entries: HookDryRunEntry[] = [];
    for (const hook of candidates) {
      const entry: HookDryRunEntry = {
        hookId: hook.id,
        name: hook.name,
        phase,
        type: hook.type,
        priority: hook.priority,
        timeoutMs: hook.timeoutMs,
        retries: hook.retries,
        failurePolicy: hook.failurePolicy,
        valid: true,
        errors: [],
      };
      if (typeof hook.timeoutMs !== 'number' || hook.timeoutMs <= 0 || !Number.isFinite(hook.timeoutMs)) {
        entry.errors.push(`invalid timeout: ${hook.timeoutMs}`);
      }

      switch (hook.config.type) {
        case 'script': {
          const config = hook.config as ScriptHookConfig;
          const { cmd, args, cwd } = HookExecutor.resolveScriptInvocation(config, context.workspacePath);
          entry.script = { command: cmd, args, cwd };
          if (!cmd) {
            entry.errors.push('script hook has no command');
          } else if (this.scriptRunner.validate) {
            const verdict = await this.scriptRunner.validate(cmd, args);
            if (verdict.ok) entry.script.resolvedCommand = verdict.resolvedCommand;
            else entry.errors.push(verdict.reason ?? 'command refused by script policy');
          }
          break;
        }
        case 'http': {
          const config = hook.config as HttpHookConfig;
          const rendered = this.renderHttpRequest(config, context);
          entry.http = rendered;
          try {
            const parsed = new URL(rendered.url);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
              entry.errors.push(`unsupported URL scheme '${parsed.protocol}'`);
            }
          } catch {
            entry.errors.push(`invalid URL after interpolation: '${rendered.url}'`);
          }
          break;
        }
        case 'function': {
          const config = hook.config as FunctionHookConfig;
          entry.function = { handlerName: config.handlerName, modulePath: config.modulePath };
          if (config.handlerName) {
            entry.function.registered = this.functionHandlers.has(config.handlerName);
            if (!entry.function.registered) {
              entry.errors.push(`no in-process handler registered for '${config.handlerName}'`);
            }
          } else if (config.modulePath) {
            const resolvedWorkspace = path.resolve(context.workspacePath);
            const modulePath = path.resolve(resolvedWorkspace, config.modulePath);
            const relative = path.relative(resolvedWorkspace, modulePath);
            if (relative.startsWith('..') || path.isAbsolute(relative)) {
              entry.errors.push(`module path ${config.modulePath} resolves outside workspace`);
            } else {
              entry.function.resolvedModulePath = modulePath;
            }
          } else {
            entry.errors.push("function hook has neither 'handlerName' nor 'modulePath'");
          }
          break;
        }
        default:
          entry.errors.push(`unknown hook type '${String((hook.config as { type?: unknown }).type)}'`);
      }

      entry.valid = entry.errors.length === 0;
      entries.push(entry);
    }

    return {
      phase,
      dryRun: true,
      valid: entries.every((e) => e.valid),
      hooks: entries,
      skipped,
    };
  }

  /** Merge a single HookResult into an accumulator. Later hooks win for conflicting variable keys. */
  private static mergeHookResult(target: HookResult, source: HookResult): void {
    if (source.variables) {
      target.variables = { ...target.variables, ...source.variables };
    }
    if (source.contextMessages && source.contextMessages.length > 0) {
      target.contextMessages = [...(target.contextMessages ?? []), ...source.contextMessages];
    }
    if (source.attachments && source.attachments.length > 0) {
      target.attachments = [...(target.attachments ?? []), ...source.attachments];
    }
  }

  /**
   * Phase 2, 2.6 — cap the exponential backoff so pathological retry
   * policies can't pin the executor for minutes. Before: `1000 * 2^attempt`
   * unbounded; with `retries=10` that's >17 minutes of sleep for one hook.
   */
  private static readonly MAX_BACKOFF_MS = 60_000;

  private async executeHookWithRetry(
    hook: HookDefinition,
    context: HookContext,
  ): Promise<{ success: boolean; error?: string; hookResult?: HookResult }> {
    let lastError: string | undefined;

    for (let attempt = 0; attempt <= hook.retries; attempt++) {
      try {
        const hookResult = await this.executeHook(hook, context);
        return { success: true, hookResult: hookResult ?? undefined };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        // ORC-01/02 — if the caller aborted, do not burn the remaining
        // retry budget on work that will be immediately cancelled again.
        if (context.abortSignal?.aborted) {
          return { success: false, error: lastError };
        }
        if (attempt < hook.retries) {
          const backoff = Math.min(
            1000 * Math.pow(2, attempt),
            HookExecutor.MAX_BACKOFF_MS,
          );
          await sleep(backoff);
        }
      }
    }

    return { success: false, error: lastError };
  }

  private async executeHook(hook: HookDefinition, context: HookContext): Promise<HookResult | void> {
    if (typeof hook.timeoutMs !== 'number' || hook.timeoutMs <= 0 || !Number.isFinite(hook.timeoutMs)) {
      throw new HookConfigError(`Hook '${hook.name}' has invalid timeout: ${hook.timeoutMs}`);
    }

    // ORC-01/02 — one AbortController for the whole hook invocation.
    // Fires on (a) timeout expiry (b) caller-supplied signal aborting.
    // Its `signal` is forwarded to script runner + http client so the
    // underlying child process / fetch are cancelled, not just the wait.
    const controller = new AbortController();
    let externalHandler: (() => void) | undefined;
    if (context.abortSignal) {
      if (context.abortSignal.aborted) {
        controller.abort();
      } else {
        externalHandler = () => controller.abort();
        context.abortSignal.addEventListener('abort', externalHandler, { once: true });
      }
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        // Cancel the in-flight work first so the child process or fetch
        // actually stops; THEN reject so the caller sees the timeout.
        controller.abort();
        reject(new HookTimeoutError(`Hook '${hook.name}' timed out after ${hook.timeoutMs}ms`));
      }, hook.timeoutMs);
    });

    const executionPromise = (async (): Promise<HookResult | void> => {
      switch (hook.config.type) {
        case 'script':
          return this.executeScript(hook.config as ScriptHookConfig, context, controller.signal);
        case 'http':
          return this.executeHttp(hook.config as HttpHookConfig, context, controller.signal);
        case 'function':
          return this.executeFunction(hook.config as FunctionHookConfig, context, controller.signal);
      }
    })();

    let hookResult: HookResult | void;
    try {
      hookResult = await Promise.race([executionPromise, timeoutPromise]);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      if (externalHandler && context.abortSignal) {
        context.abortSignal.removeEventListener('abort', externalHandler);
      }
    }
    return hookResult;
  }

  private async executeScript(
    config: ScriptHookConfig,
    context: HookContext,
    abortSignal: AbortSignal,
  ): Promise<HookResult | void> {
    const { cmd, args, cwd } = HookExecutor.resolveScriptInvocation(config, context.workspacePath);

    // ORC-01 — forward the hook-level AbortSignal into the script runner
    // so SIGKILL fires the moment the hook times out, instead of the
    // child running to natural completion.
    const result = await this.scriptRunner.run(cmd, args, {
      cwd,
      env: {
        ...config.env,
        SESSION_ID: context.sessionId,
        WORKFLOW_ID: context.workflowId,
      },
      abortSignal,
    });

    if (result.exitCode !== 0) {
      throw new HookScriptError(
        `Script exited with code ${result.exitCode}: ${result.stderr}`,
      );
    }

    // Parse stdout as HookResult JSON if it looks like JSON
    return HookExecutor.tryParseHookResult(result.stdout);
  }

  /**
   * Split a script hook's command string into binary + args when args are not
   * explicitly provided (users type "echo hello" or "node script.js --flag"
   * as one string) and resolve its cwd. Shared by the real dispatch and the
   * dry run so both see the identical command line.
   */
  private static resolveScriptInvocation(
    config: ScriptHookConfig,
    workspacePath: string,
  ): { cmd: string; args: string[]; cwd: string } {
    const cwd = config.cwd ? path.resolve(workspacePath, config.cwd) : workspacePath;
    let cmd = config.command ?? '';
    let args = config.args ?? [];
    if (args.length === 0 && cmd.includes(' ')) {
      const parts = cmd.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [cmd];
      cmd = parts[0]!;
      args = parts.slice(1).map(a => a.replace(/^["']|["']$/g, ''));
    }
    return { cmd, args, cwd };
  }

  /**
   * Render an HTTP hook's URL / headers / body. Interpolation table: user
   * variables + built-in context fields (workflowRunId, sessionId,
   * workflowId, workspacePath) so HTTP hooks can reference the owning run
   * without callers having to shove those into `variables` manually.
   */
  private renderHttpRequest(
    config: HttpHookConfig,
    context: Pick<HookContext, 'variables' | 'workflowRunId' | 'sessionId' | 'workflowId' | 'workspacePath'>,
  ): { method: string; url: string; headers?: Record<string, string>; body?: string } {
    const vars: Record<string, string> = {
      ...context.variables,
      workflowRunId: context.workflowRunId ?? '',
      sessionId: context.sessionId,
      workflowId: context.workflowId,
      workspacePath: context.workspacePath,
    };
    const url = this.interpolateTemplate(config.url, vars);
    const headers = config.headers
      ? Object.fromEntries(
          Object.entries(config.headers).map(([k, v]) => [k, this.interpolateTemplate(v, vars)]),
        )
      : undefined;
    const body = config.bodyTemplate
      ? this.interpolateTemplate(config.bodyTemplate, vars)
      : undefined;
    return { method: config.method, url, headers, body };
  }

  private async executeHttp(
    config: HttpHookConfig,
    context: HookContext,
    abortSignal: AbortSignal,
  ): Promise<HookResult | void> {
    const { url, headers, body } = this.renderHttpRequest(config, context);

    // ORC-01 — forward the AbortSignal to fetch so the socket is closed
    // on hook timeout. The HTTP client already honours `signal`.
    const response = await this.httpClient.request({
      method: config.method,
      url,
      headers,
      body,
      signal: abortSignal,
    });

    if (response.status >= 400) {
      throw new HookHttpError(
        `HTTP hook returned ${response.status}: ${response.body}`,
      );
    }

    // Parse response body as HookResult JSON if it looks like JSON
    return HookExecutor.tryParseHookResult(response.body);
  }

  /**
   * ORC-03 — dispatches to either an in-process registered handler or the
   * subprocess-backed module loader. See `FunctionHookConfig` docs for the
   * resolution rules.
   */
  private async executeFunction(
    config: FunctionHookConfig,
    context: HookContext,
    abortSignal: AbortSignal,
  ): Promise<HookResult | void> {
    // Resolution rule: registry > modulePath.
    // We check the registry FIRST so a handlerName always wins over a
    // modulePath, even when both are configured. That keeps trusted
    // in-process hooks predictable — the operator can register or
    // unregister a handler without re-deploying workflow definitions.
    if (config.handlerName) {
      const handler = this.functionHandlers.get(config.handlerName);
      if (!handler) {
        throw new HookConfigError(
          `No in-process handler registered for function hook '${config.handlerName}'. ` +
          `Call HookExecutor.registerFunctionHandler('${config.handlerName}', fn) at boot.`,
        );
      }

      // In-process handlers are invoked directly — they share the server's
      // memory, so there's no serialisation cost, no spawn cost, and they
      // can use the DI container via closure. The trade-off is that a
      // thrown error propagates straight into our try/catch; we wrap so
      // consumers see a consistent HookScriptError.
      try {
        const handlerResult = await handler({
          sessionId: context.sessionId,
          workflowId: context.workflowId,
          workspacePath: context.workspacePath,
          variables: context.variables,
          args: config.args,
          signal: abortSignal,
        });
        return handlerResult ?? undefined;
      } catch (err) {
        if (err instanceof HookScriptError || err instanceof HookTimeoutError) throw err;
        throw new HookScriptError(
          `Function hook '${config.handlerName}' threw: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return;
    }

    // Fallback — subprocess-backed module path. Retains the sandbox-safe
    // execution model for user-supplied code that should NOT share the
    // server's memory space or credentials.
    if (!config.modulePath) {
      throw new HookConfigError(
        `Function hook has neither 'handlerName' nor 'modulePath' — one is required.`,
      );
    }

    const resolvedWorkspace = path.resolve(context.workspacePath);
    const modulePath = path.resolve(resolvedWorkspace, config.modulePath);
    // Security: ensure resolved path stays within the workspace (normalize for Windows case)
    const relative = path.relative(resolvedWorkspace, modulePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new HookConfigError(
        `Module path ${config.modulePath} resolves outside workspace`,
      );
    }

    // Execute the function module via subprocess (sandbox-safe) instead of import()
    // Module path is passed via environment variable to prevent command injection.
    const contextJson = JSON.stringify({
      sessionId: context.sessionId,
      workflowId: context.workflowId,
      workspacePath: context.workspacePath,
      variables: context.variables,
      args: config.args,
    });

    // The runner program is OURS and fixed; only the module path (env) and
    // the context (argv) vary. It is fed through stdin (`node -`) rather than
    // `node -e` because the script runner refuses `-e`/`--eval` for
    // everyone — a model-authored hook config can set command/args but never
    // stdin, so this stays a server-only capability.
    //
    // ORC-01 — forward AbortSignal so the subprocess is killed on timeout
    // instead of running to natural completion.
    const result = await this.scriptRunner.run(
      'node',
      ['-', contextJson],
      {
        cwd: context.workspacePath,
        env: { HOOK_MODULE_PATH: modulePath },
        abortSignal,
        stdin: HookExecutor.FUNCTION_HOOK_RUNNER,
      },
    );

    if (result.exitCode !== 0) {
      throw new HookScriptError(
        `Function hook exited with code ${result.exitCode}: ${result.stderr}`,
      );
    }

    // Parse stdout as HookResult JSON
    return HookExecutor.tryParseHookResult(result.stdout);
  }

  /**
   * Fixed program for subprocess-backed function hooks. With `node -` the
   * script arrives on stdin and `process.argv[1]` is the first user arg.
   */
  private static readonly FUNCTION_HOOK_RUNNER =
    `const fn = require(process.env.HOOK_MODULE_PATH); ` +
    `const ctx = JSON.parse(process.argv[1]); ` +
    `Promise.resolve((fn.default || fn)(ctx))` +
    `.then(() => process.exit(0))` +
    `.catch(e => { console.error(e.message || e); process.exit(1); });\n`;

  /**
   * Try to parse a string as a HookResult JSON.
   * Returns undefined if the string is empty or not valid JSON.
   * Only returns a result if the parsed object has at least one HookResult key.
   */
  private static tryParseHookResult(output: string | undefined): HookResult | undefined {
    if (!output) return undefined;
    const trimmed = output.trim();
    if (!trimmed || !trimmed.startsWith('{')) return undefined;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      // Only treat as HookResult if it has at least one recognized key
      if (parsed.variables || parsed.contextMessages || parsed.attachments || parsed.abort !== undefined) {
        return parsed as HookResult;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  private interpolateTemplate(template: string, vars: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '');
  }
}
