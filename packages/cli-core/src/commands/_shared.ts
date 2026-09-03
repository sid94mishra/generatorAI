// ────────────────────────────────────────────────────────────────
// Helpers shared by every command module.
//
// Kept deliberately small: anything that looks like domain logic belongs in
// the command that owns it, and anything that looks like transport belongs in
// client-core.
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';
import * as fs from 'node:fs/promises';
import type { CliContext } from '../context/CliContext.js';
import { CliError } from '../errors/CliError.js';
import type { ColumnSpec, CommandFlag, CommandResult } from '../registry/CommandSpec.js';

/** Shorthand for a handler that returns a single entity. */
export function record<T>(data: T, message?: string): CommandResult<T> {
  return message === undefined ? { data } : { data, message };
}

export function list<T>(data: T[]): CommandResult<T[]> {
  return { data };
}

export function ok(message: string): CommandResult<null> {
  return { data: null, message };
}

/** `{ args: {}, flags: {} }` for commands that take neither. */
export const NO_INPUT = z.object({ args: z.object({}), flags: z.object({}) });

export const emptyArgs = z.object({});

/** Zod passthrough for Commander's parsed options: unknown keys are dropped. */
export function inputSchema<A extends z.ZodRawShape, F extends z.ZodRawShape>(
  args: A,
  flags: F,
) {
  return z.object({ args: z.object(args), flags: z.object(flags) });
}

/** Commander gives `undefined` for absent options and `''` for `--flag ""`. */
export const optionalString = z.string().optional();
export const optionalBool = z.boolean().optional();

/** `--limit 50` arrives as the string "50". */
export const numericString = z
  .union([z.string(), z.number()])
  .optional()
  .transform((v) => (v === undefined || v === '' ? undefined : Number(v)))
  .refine((v) => v === undefined || Number.isFinite(v), { message: 'must be a number' });

/**
 * `--var key=value` repeated.
 *
 * Values that parse as JSON are decoded, so `--var count=3` and
 * `--var tags=["a","b"]` both produce the type the server expects. A bare
 * string that happens to look like JSON is the price; quoting it keeps it a
 * string.
 */
export function parseKeyValues(pairs: string[] | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const pair of pairs ?? []) {
    const index = pair.indexOf('=');
    if (index === -1) {
      throw CliError.usage(`Expected key=value, got "${pair}".`);
    }
    const key = pair.slice(0, index).trim();
    const raw = pair.slice(index + 1);
    if (!key) throw CliError.usage(`Empty key in "${pair}".`);
    try {
      out[key] = JSON.parse(raw);
    } catch {
      out[key] = raw;
    }
  }
  return out;
}

/** `--tag a --tag b` or `--tags a,b`. */
export function parseList(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const items = Array.isArray(value) ? value : value.split(',');
  const cleaned = items.map((i) => i.trim()).filter(Boolean);
  return cleaned.length ? cleaned : undefined;
}

/**
 * Reads a text file the user pointed a flag/arg at, converting a missing or
 * unreadable path into a clean `CliError` instead of a raw Node ENOENT/EACCES
 * that would otherwise reach `toCliError`'s fallback and get reported as an
 * "internal" error — misleading the user into thinking the tool is broken
 * when they just typo'd a path. Matches the pattern already used by
 * `loadRunProfile` (run.ts) and `readAttachments` (chat.ts).
 */
export async function readTextFile(filePath: string, label = 'file'): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    throw new CliError('VALIDATION', `Could not read ${label} at ${filePath}.`, {
      hint: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Drops undefined so a PATCH body never clears a field it did not mention. */
export function compact<T extends Record<string, unknown>>(input: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out as Partial<T>;
}

/** Rejects an update whose body would be empty — the server would 400 anyway. */
export function requireSomeUpdate<T extends Record<string, unknown>>(
  body: T,
  hint: string,
): T {
  if (Object.keys(body).length === 0) {
    throw CliError.usage('Nothing to update.', { hint });
  }
  return body;
}

// ── Reusable flags ────────────────────────────────────────────────

export const projectFlag: CommandFlag = {
  name: 'project',
  description: 'Project id or name',
  type: 'string',
  completes: 'project',
};

export const limitFlag: CommandFlag = {
  name: 'limit',
  description: 'Maximum rows to return',
  type: 'number',
};

export const watchFlag: CommandFlag = {
  name: 'watch',
  short: 'w',
  description: 'Stream events until the operation reaches a terminal state',
  type: 'boolean',
};

export const verbosityFlag: CommandFlag = {
  name: 'verbosity',
  description: 'Stream detail level',
  type: 'string',
  choices: ['minimal', 'normal', 'verbose'] as const,
  default: 'normal',
};

export const forceFlag: CommandFlag = {
  name: 'force',
  short: 'f',
  description: 'Proceed even when the server reports dependants',
  type: 'boolean',
};

// ── Reusable columns ──────────────────────────────────────────────

export const idColumn: ColumnSpec = { key: 'id', header: 'ID', format: 'id', priority: 0 };
export const nameColumn: ColumnSpec = { key: 'name', header: 'Name', priority: 0 };
export const statusColumn: ColumnSpec = { key: 'status', header: 'Status', format: 'status', priority: 0 };
export const createdColumn: ColumnSpec = { key: 'createdAt', header: 'Created', format: 'relative', priority: 3 };
export const updatedColumn: ColumnSpec = { key: 'updatedAt', header: 'Updated', format: 'relative', priority: 4 };

// ── Terminal-state helpers ────────────────────────────────────────

export const TERMINAL_RUN_STATES = new Set(['completed', 'failed', 'cancelled']);
export const TERMINAL_STAGE_STATES = new Set(['completed', 'failed', 'cancelled', 'skipped']);

export function isTerminalRunState(status: string | undefined | null): boolean {
  return status ? TERMINAL_RUN_STATES.has(status) : false;
}

/**
 * Waits for a run to leave the non-terminal states.
 *
 * Polls rather than relying purely on the stream because a run can reach its
 * terminal state during a reconnect gap; the poll is the backstop that stops
 * `--watch` hanging forever on a run that already finished.
 */
export async function waitForRunTerminal(
  ctx: CliContext,
  runId: string,
  options: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<{ status: string; error?: string | null }> {
  const interval = options.intervalMs ?? 2000;
  const deadline = options.timeoutMs ? Date.now() + options.timeoutMs : Infinity;

  for (;;) {
    ctx.assertNotCancelled();
    const run = await ctx.api.runs.get(runId);
    if (isTerminalRunState(run.status)) {
      return { status: run.status, error: run.error ?? null };
    }
    if (Date.now() > deadline) {
      throw new CliError('TIMEOUT', `Run ${runId} did not finish within the timeout.`, {
        details: { status: run.status },
      });
    }
    await sleep(interval, ctx.signal);
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Streams a scope until `isDone` says stop, forwarding every event to the
 * surface. The disposer is registered on the context so an interrupt tears
 * the subscription down instead of leaking the socket.
 */
export async function streamUntil(
  ctx: CliContext,
  scope: 'run' | 'chat' | 'session' | 'global',
  id: string,
  options: {
    afterSequence?: number;
    filter?: string[];
    isDone?: (event: { kind: string; data: Record<string, unknown> }) => boolean;
    onEvent?: (event: { kind: string; data: Record<string, unknown>; sequence?: number }) => void;
    /**
     * Suppresses every emit this function makes on the caller's behalf —
     * the generic `stream` event AND the reconnect/disconnect log lines —
     * not just whatever the caller's own `onEvent` chooses to render.
     * Without this, `--ndjson` still echoed one `data` frame per event for
     * a caller that asked to wait silently (e.g. `chat send --no-stream`),
     * because that path only gated its OWN callback, not this one.
     */
    silent?: boolean;
  } = {},
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      if (error) reject(error);
      else resolve();
    };

    const unsubscribe = ctx.stream.subscribe(
      scope,
      id,
      (event) => {
        options.onEvent?.(event);
        if (!options.silent) {
          ctx.emit({ type: 'stream', kind: event.kind, data: event.data, ...(event.sequence !== undefined ? { sequence: event.sequence } : {}) });
        }
        if (options.isDone?.(event)) finish();
      },
      {
        ...(options.afterSequence !== undefined ? { afterSequence: options.afterSequence } : {}),
        ...(options.filter ? { filter: options.filter } : {}),
        onReconnecting: (attempt) => {
          if (!options.silent) {
            ctx.emit({ type: 'log', level: 'debug', message: `Stream reconnecting (attempt ${attempt})` });
          }
        },
        onDisconnected: (reason) => {
          if (!options.silent) {
            ctx.emit({ type: 'log', level: 'debug', message: `Stream disconnected${reason ? `: ${reason}` : ''}` });
          }
        },
      },
    );

    ctx.onDispose(() => finish());
    ctx.signal.addEventListener('abort', () => finish(), { once: true });
  });
}
