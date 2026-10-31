// ────────────────────────────────────────────────────────────────
// Code mode sandbox (D-182): run an agent-written async JavaScript body inside
// QuickJS compiled to WebAssembly, with the session's tools as `tools.<name>()`.
//
// Why QuickJS-wasm and not `node:vm` (SandboxedEval.ts): a vm context shares
// this process's heap and realm intrinsics, so it is not a security boundary.
// The QuickJS interpreter runs inside a wasm instance with its own linear
// memory; the only host objects it can reach are the ones injected below —
// `tools` and `console`. No `require`, `process`, `fetch`, timers, module
// loader or std/os modules exist in it.
//
// Build choice: the `release-sync` QuickJS build with host promises
// (`context.newPromise()`), not the asyncify build. An asyncified host function
// suspends the interpreter's C stack, which only works for a call made directly
// under `evalCodeAsync`: a call after the script's first `await` runs inside a
// promise job (`executePendingJobs` is synchronous) and cannot suspend, nested
// suspensions are refused, and `Promise.all` cannot overlap two calls. Host
// promises have none of those limits, are the documented pattern for async
// host functions, and the sync build is about half the size. The `singlefile`
// variant embeds the wasm bytes in its JS module, so there is no `.wasm` file to
// locate at runtime: esbuild inlines it into the server bundle like any other
// module, the same on Windows, macOS and Linux.
//
// Limits: a memory cap (64 MB), a native stack cap, a wall-clock deadline
// enforced both by QuickJS's interrupt handler (synchronous loops) and by the
// host (awaits on tool calls), a cap on tool calls and log lines, and a cap on
// the report's serialised size. The runtime and context are disposed after
// every run.
// ────────────────────────────────────────────────────────────────

import {
  newQuickJSWASMModuleFromVariant,
  type QuickJSContext,
  type QuickJSDeferredPromise,
  type QuickJSHandle,
  type QuickJSRuntime,
  type QuickJSWASMModule,
} from 'quickjs-emscripten-core';

/** A host function the script can call as `tools.<name>(args)`. */
export type SandboxTool = (args: Record<string, unknown>, signal: { readonly expired: boolean }) => Promise<unknown>;

export interface SandboxLimits {
  /** Wall-clock budget for the whole run, tool calls included. */
  timeoutMs: number;
  /** QuickJS heap cap in bytes. */
  memoryBytes: number;
  /** Tool calls allowed per run; the next one throws inside the script. */
  maxCalls: number;
  /** Serialised report size cap (characters). */
  maxOutputChars: number;
  /** Log lines kept per run (console.* calls beyond it are counted, not kept). */
  maxLogLines?: number;
  /** QuickJS native stack cap in bytes (deep recursion fails instead of crashing). */
  stackBytes?: number;
}

export const DEFAULT_SANDBOX_LIMITS: SandboxLimits = {
  timeoutMs: 60_000,
  memoryBytes: 64 * 1024 * 1024,
  maxCalls: 200,
  maxOutputChars: 24_000,
  maxLogLines: 1_000,
  stackBytes: 1024 * 1024,
};

/** One tool call the script made. */
export interface SandboxCall {
  tool: string;
  ok: boolean;
  ms: number;
  error?: string;
}

/** What a run reports back: what `run_code` returns as JSON text. */
export interface SandboxReport {
  /** False when the script threw, was interrupted or ran out of memory (the transcript's failed-envelope shape). */
  ok: boolean;
  /** Set when the script threw, was interrupted or ran out of memory. */
  error?: string;
  /** The script's return value (JSON-compatible), or its truncated JSON text when `truncated`. */
  result?: unknown;
  logs: string[];
  calls: SandboxCall[];
  /** Set when some of the result, logs or calls were cut to fit `maxOutputChars`. */
  truncated?: true;
}

let modulePromise: Promise<QuickJSWASMModule> | undefined;

/** The QuickJS wasm module: compiled once per process, a fresh runtime per run. */
function quickJs(): Promise<QuickJSWASMModule> {
  if (!modulePromise) {
    modulePromise = import('@jitl/quickjs-singlefile-mjs-release-sync')
      .then((m) => newQuickJSWASMModuleFromVariant(m.default))
      .catch((err: unknown) => {
        modulePromise = undefined;
        throw err;
      });
  }
  return modulePromise;
}

const MAX_ERROR_CHARS = 500;

/** "60 s", or "200 ms" under a second. */
function duration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${Math.round(ms / 1000)} s`;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const e = err as { name?: unknown; message?: unknown };
    if (typeof e.message === 'string') {
      return typeof e.name === 'string' && e.name && e.name !== 'Error' ? `${e.name}: ${e.message}` : e.message;
    }
  }
  return String(err);
}

/** A log argument as text: strings verbatim, everything else as JSON. */
function logPart(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return 'undefined';
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Run `code` — the body of an async function — with `tools` injected.
 * Never throws for anything the script does: failures are in `report.error`.
 */
export async function runInQuickJs(
  code: string,
  tools: Readonly<Record<string, SandboxTool>>,
  limitsIn: Partial<SandboxLimits> = {},
): Promise<SandboxReport> {
  const limits: SandboxLimits = { ...DEFAULT_SANDBOX_LIMITS, ...limitsIn };
  const maxLogLines = limits.maxLogLines ?? DEFAULT_SANDBOX_LIMITS.maxLogLines!;
  const logs: string[] = [];
  let droppedLogs = 0;
  const calls: SandboxCall[] = [];
  const started = Date.now();
  const deadline = started + limits.timeoutMs;
  const signal = { expired: false };

  const mod = await quickJs();
  const runtime: QuickJSRuntime = mod.newRuntime();
  runtime.setMemoryLimit(limits.memoryBytes);
  runtime.setMaxStackSize(limits.stackBytes ?? DEFAULT_SANDBOX_LIMITS.stackBytes!);
  runtime.setInterruptHandler(() => signal.expired || Date.now() > deadline);
  const ctx: QuickJSContext = runtime.newContext();

  /** Host promises the script is waiting on; disposed at the end whatever happened. */
  const pending = new Set<QuickJSDeferredPromise>();
  let disposed = false;
  /** Set by a failure that ends the run from the host side (deadline, a fatal job error). */
  let abort: ((reason: string) => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    abort = (reason) => reject(new Error(reason));
  });
  void aborted.catch(() => undefined);

  /** Drive the script's promise jobs after a host promise settles. */
  const pump = (): void => {
    if (disposed) return;
    const res = runtime.executePendingJobs();
    if (res.error) {
      const err = safeDump(res.error);
      res.error.dispose();
      abort?.(errorText(err));
    }
  };
  /** `dump` evaluates inside the guest, which refuses once interrupted: fall back to a plain message. */
  const safeDump = (h: QuickJSHandle): unknown => {
    try {
      return ctx.dump(h);
    } catch (err) {
      return errorText(err);
    }
  };

  /** JSON text → a guest value (via the guest's own JSON.parse). */
  const parseHandle = ctx.unwrapResult(ctx.evalCode('(s) => JSON.parse(s)', 'host-json.js'));
  const toGuest = (value: unknown): QuickJSHandle => {
    if (value === undefined) return ctx.undefined;
    let json: string | undefined;
    try {
      json = JSON.stringify(value);
    } catch {
      json = JSON.stringify(String(value));
    }
    if (json === undefined) return ctx.undefined;
    const str = ctx.newString(json);
    try {
      return ctx.unwrapResult(ctx.callFunction(parseHandle, ctx.undefined, str));
    } finally {
      str.dispose();
    }
  };

  const newGuestError = (name: string, message: string): QuickJSHandle => ctx.newError({ name, message });

  // ── console ──
  const consoleObj = ctx.newObject();
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const fn = ctx.newFunction(level, (...args) => {
      if (logs.length >= maxLogLines) {
        droppedLogs += 1;
        return;
      }
      const line = args.map((h) => logPart(ctx.dump(h))).join(' ');
      logs.push(level === 'log' || level === 'info' ? line : `[${level}] ${line}`);
    });
    ctx.setProp(consoleObj, level, fn);
    fn.dispose();
  }
  ctx.setProp(ctx.global, 'console', consoleObj);
  consoleObj.dispose();

  // ── tools ──
  const toolsObj = ctx.newObject();
  for (const [name, impl] of Object.entries(tools)) {
    const fn = ctx.newFunction(name, (argsHandle) => {
      if (calls.length >= limits.maxCalls) {
        return { error: newGuestError('LimitError', `run_code allows at most ${limits.maxCalls} tool calls per script.`) };
      }
      const raw: unknown = argsHandle ? ctx.dump(argsHandle) : undefined;
      if (raw !== undefined && raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) {
        return { error: newGuestError('TypeError', `tools.${name}(args) takes one object argument.`) };
      }
      const args = (raw ?? {}) as Record<string, unknown>;
      const call: SandboxCall = { tool: name, ok: false, ms: 0 };
      calls.push(call);
      const deferred = ctx.newPromise();
      pending.add(deferred);
      const t0 = Date.now();
      /** Hand the outcome to the script. Any failure here ends the run instead of escaping as an unhandled rejection. */
      const settle = (ok: boolean, value: unknown): void => {
        call.ms = Date.now() - t0;
        call.ok = ok;
        if (!ok) call.error = clip(errorText(value), MAX_ERROR_CHARS);
        if (disposed || !deferred.alive) return;
        try {
          let h: QuickJSHandle | undefined;
          if (ok) {
            try {
              h = toGuest(value);
            } catch (err) {
              // Too big for the sandbox's memory, or not representable.
              call.ok = false;
              call.error = clip(`returned a value the script cannot hold: ${errorText(err)}`, MAX_ERROR_CHARS);
            }
          }
          if (h) {
            deferred.resolve(h);
            if (h !== ctx.undefined && h.alive) h.dispose();
          } else {
            const e = newGuestError('ToolError', `tools.${name} failed: ${call.error ?? 'unknown error'}`);
            deferred.reject(e);
            e.dispose();
          }
          pending.delete(deferred);
          pump();
        } catch (err) {
          abort?.(errorText(err));
        }
      };
      void Promise.resolve()
        .then(() => impl(args, signal))
        .then(
          (value) => settle(true, value),
          (err: unknown) => settle(false, err),
        );
      return deferred.handle;
    });
    ctx.setProp(toolsObj, name, fn);
    fn.dispose();
  }
  ctx.setProp(ctx.global, 'tools', toolsObj);
  toolsObj.dispose();

  let timer: ReturnType<typeof setTimeout> | undefined;
  let result: unknown;
  let error: string | undefined;
  try {
    timer = setTimeout(() => {
      signal.expired = true;
      abort?.(`run_code exceeded its ${duration(limits.timeoutMs)} deadline and was stopped.`);
    }, Math.max(0, deadline - Date.now()));
    timer.unref?.();

    const evaluated = ctx.evalCode(`"use strict";\n(async () => {\n${code}\n})()`, 'run_code.js');
    if (evaluated.error) {
      const err = safeDump(evaluated.error);
      evaluated.error.dispose();
      throw new Error(errorText(err));
    }
    const promiseHandle = evaluated.value;
    const settled = ctx.resolvePromise(promiseHandle);
    void settled.catch(() => undefined);
    promiseHandle.dispose();
    pump();
    const outcome = await Promise.race([settled, aborted]);
    if (outcome.error) {
      const err = safeDump(outcome.error);
      outcome.error.dispose();
      throw new Error(errorText(err));
    }
    result = ctx.dump(outcome.value);
    outcome.value.dispose();
  } catch (err) {
    const message = errorText(err);
    error =
      message === 'interrupted' || /InternalError: interrupted/.test(message)
        ? `run_code exceeded its ${duration(limits.timeoutMs)} deadline and was stopped.`
        : /out of memory/i.test(message)
          ? `run_code ran out of memory (limit ${Math.round(limits.memoryBytes / (1024 * 1024))} MB).`
          : message;
  } finally {
    if (timer) clearTimeout(timer);
    signal.expired = true;
    disposed = true;
    for (const d of pending) d.dispose();
    pending.clear();
    parseHandle.dispose();
    try {
      ctx.dispose();
      runtime.dispose();
    } catch {
      // A leaked guest object only costs this run's wasm memory, which is freed with the runtime's module heap.
    }
  }

  if (droppedLogs > 0) logs.push(`… ${droppedLogs} more log line(s) dropped (limit ${maxLogLines}).`);
  return fitReport(
    {
      ok: !error,
      ...(error ? { error: clip(error, MAX_ERROR_CHARS * 4) } : {}),
      ...(result !== undefined ? { result } : {}),
      logs,
      calls,
    },
    limits.maxOutputChars,
  );
}

/**
 * Shrink a report until its JSON fits `max` characters: the result becomes its
 * clipped JSON text, logs are clipped from the end, then the call list keeps
 * its first entries. `truncated` marks any cut.
 */
export function fitReport(report: SandboxReport, max: number): SandboxReport {
  const size = (r: SandboxReport) => JSON.stringify(r).length;
  if (size(report) <= max) return report;
  const out: SandboxReport = { ...report, logs: [...report.logs], calls: [...report.calls], truncated: true };
  const note = (n: number) => `… [${n} characters truncated]`;

  // 1. the result: half of the budget at most, as clipped JSON text
  if (out.result !== undefined) {
    const text = typeof out.result === 'string' ? out.result : (JSON.stringify(out.result) ?? '');
    const budget = Math.floor(max / 2);
    if (text.length > budget) out.result = text.slice(0, budget) + note(text.length - budget);
  }
  // 2. logs: each line at most 2k, then drop from the end
  out.logs = out.logs.map((l) => (l.length > 2_000 ? l.slice(0, 2_000) + note(l.length - 2_000) : l));
  let droppedLogs = 0;
  while (out.logs.length > 0 && size(out) > max) {
    out.logs.pop();
    droppedLogs += 1;
  }
  if (droppedLogs > 0) out.logs.push(`… ${droppedLogs} log line(s) truncated`);
  // 3. calls: keep the first ones
  let droppedCalls = 0;
  while (out.calls.length > 0 && size(out) > max) {
    out.calls.pop();
    droppedCalls += 1;
  }
  if (droppedCalls > 0) out.logs.push(`… ${droppedCalls} call record(s) truncated`);
  // 4. still too big (a huge result and a tiny budget): clip the result harder
  if (size(out) > max && typeof out.result === 'string') {
    const over = size(out) - max + 64;
    const keep = Math.max(0, out.result.length - over);
    out.result = out.result.slice(0, keep) + note(out.result.length - keep);
  }
  if (size(out) > max) {
    out.logs = [`… output truncated`];
    if (typeof out.result === 'string') out.result = out.result.slice(0, Math.max(0, max - 200));
    if (out.error) out.error = out.error.slice(0, 200);
  }
  return out;
}
