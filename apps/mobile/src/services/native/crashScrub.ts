// Crash-report privacy (MD-42, 06 §8.6, M10-06; MD-197): what may leave the device in a crash report. Pure, vitest.
// The reporter is opt-in and off by default; even when on, a report carries the error type, the stack's function
// names and file base names, the app / OS / device model and breadcrumb categories — never message text, prompts,
// paths, URLs' queries, server addresses in messages, user data or extra context.

/** A Sentry-compatible DSN: `https://<public key>@<host>[:port]/<project id>` (self-hosted Sentry or GlitchTip). */
export function isValidDsn(input: string): boolean {
  const raw = input.trim();
  if (!raw) return false;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    if (!url.username || url.password) return false;
    return /^\/(?:[^/]+\/)*\d+$/.test(url.pathname);
  } catch {
    return false;
  }
}

/** The origin a DSN reports to (for the Settings row), without the key. */
export function dsnHost(input: string): string | null {
  if (!isValidDsn(input)) return null;
  return new URL(input.trim()).host;
}

const REDACTED = '[redacted]';

/** `/a/b/c.js?x=1` → `c.js`; `https://h/p?q#f` → `https://h/p`. */
export function baseName(path: string): string {
  const clean = path.split(/[?#]/)[0] ?? '';
  return clean.split(/[\\/]/).pop() || clean;
}
export function stripQuery(url: string): string {
  return url.split(/[?#]/)[0] ?? url;
}

interface Frame { filename?: string; abs_path?: string; function?: string; lineno?: number; colno?: number; in_app?: boolean; vars?: unknown; context_line?: string; pre_context?: unknown; post_context?: unknown; module?: string }
interface ExceptionValue { type?: string; value?: string; stacktrace?: { frames?: Frame[] }; mechanism?: unknown; module?: string; thread_id?: unknown }
interface Breadcrumb { type?: string; category?: string; level?: string; timestamp?: number; message?: string; data?: unknown }
/** The part of a Sentry event this scrubber touches (structurally compatible with `@sentry/core`'s `Event`). */
export interface CrashEvent {
  message?: unknown;
  logentry?: unknown;
  exception?: { values?: ExceptionValue[] };
  threads?: unknown;
  breadcrumbs?: Breadcrumb[];
  request?: { url?: string; query_string?: unknown; data?: unknown; cookies?: unknown; headers?: unknown };
  user?: unknown;
  extra?: unknown;
  tags?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  server_name?: unknown;
  transaction?: unknown;
  [key: string]: unknown;
}

const KEPT_CONTEXTS = new Set(['app', 'os', 'device', 'runtime', 'react_native_context']);

function scrubFrame(frame: Frame): Frame {
  const out: Frame = {};
  if (frame.function) out.function = frame.function;
  if (frame.filename) out.filename = baseName(frame.filename);
  if (frame.lineno !== undefined) out.lineno = frame.lineno;
  if (frame.colno !== undefined) out.colno = frame.colno;
  if (frame.in_app !== undefined) out.in_app = frame.in_app;
  return out;
}

/** `beforeSend`: returns a copy with only the allowed fields (never mutates the SDK's event). */
export function scrubEvent<E extends object>(event: E): E {
  const out: CrashEvent = { ...(event as CrashEvent) };
  delete out.message;
  delete out.logentry;
  delete out.user;
  delete out.extra;
  delete out.server_name;
  delete out.threads;
  if (typeof out.transaction === 'string') out.transaction = baseName(out.transaction);
  if (out.exception?.values) {
    out.exception = {
      values: out.exception.values.map((value) => ({
        ...(value.type ? { type: value.type } : {}),
        // The message of an error can quote a prompt, a file's content or a path: the type stays, the text goes.
        ...(value.value ? { value: REDACTED } : {}),
        ...(value.stacktrace?.frames ? { stacktrace: { frames: value.stacktrace.frames.map(scrubFrame) } } : {}),
        ...(value.mechanism ? { mechanism: value.mechanism } : {}),
      })),
    };
  }
  if (out.breadcrumbs) {
    out.breadcrumbs = out.breadcrumbs.map((crumb) => ({
      ...(crumb.type ? { type: crumb.type } : {}),
      ...(crumb.category ? { category: crumb.category } : {}),
      ...(crumb.level ? { level: crumb.level } : {}),
      ...(crumb.timestamp !== undefined ? { timestamp: crumb.timestamp } : {}),
    }));
  }
  if (out.request) out.request = out.request.url ? { url: stripQuery(out.request.url) } : {};
  if (out.contexts) out.contexts = Object.fromEntries(Object.entries(out.contexts).filter(([key]) => KEPT_CONTEXTS.has(key)));
  return out as unknown as E;
}
