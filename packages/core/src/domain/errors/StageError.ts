// ────────────────────────────────────────────────────────────────
// Stage error taxonomy (P03 WP-3.4, G5 §3.1).
//
// Every way an attempt can fail is classified into one of four classes,
// which decide the default action in the scheduler's precedence (G5 §3.5):
//
//   transient      retry with backoff, resuming the conversation
//   deterministic  no retry: routing, then onExhausted (pause or fail)
//   repairable     repair turns in the same session (inside the executor),
//                  then optionally one restart retry carrying the feedback
//   interrupted    a crash or lost lease: resume when the in-flight turn is
//                  safe to replay, pause otherwise
//
// The codes and their classes are data in `@generatorai/workflow-spec`
// (`STAGE_ERROR_CODE_CLASS`, which `retry.retryOn` names). This module maps
// thrown values onto them. Errors raised BEFORE the attempt body — agent
// resolution, composition, admission, a `pre_run` hook abort — go through
// the same classifier, so they get retries, routing and hooks like any
// other failure (B `(c)`).
//
// Unknown errors are `transient/transport` but flagged `unclassified`: the
// scheduler retries them at most once, so an unrecognised bug does not burn
// the whole retry budget.
// ────────────────────────────────────────────────────────────────

import {
  STAGE_ERROR_CODE_CLASS,
  type ErrorClass,
  type StageErrorCode,
} from '@generatorai/workflow-spec';

export type { ErrorClass, StageErrorCode };

export interface ClassifiedError {
  class: ErrorClass;
  code: StageErrorCode;
  message: string;
  /** Honoured over the computed backoff (a 429's Retry-After). */
  retryAfterMs?: number;
  /** The turn that was in flight; discarded before a resume. */
  inFlightOpId?: string;
  /** Machine detail: ajv errors, failing rule ids, the provider's raw code. */
  details?: unknown;
  /** No classifier recognised the error: retried at most once. */
  unclassified?: true;
}

/** The class of a code (the table in the spec package). */
export function errorClassOf(code: StageErrorCode): ErrorClass {
  return STAGE_ERROR_CODE_CLASS[code];
}

export function isStageErrorCode(value: unknown): value is StageErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STAGE_ERROR_CODE_CLASS, value);
}

/** Build a classified error for a code; the class always comes from the table. */
export function classified(
  code: StageErrorCode,
  message: string,
  extra: Omit<ClassifiedError, 'class' | 'code' | 'message'> = {},
): ClassifiedError {
  return { class: errorClassOf(code), code, message, ...extra };
}

/**
 * An error the engine raises with its classification attached. The executor
 * throws it (a `pre_run` abort, a failed output contract, an idle watchdog
 * abort); `classifyStageError` returns its classification unchanged.
 */
export class StageError extends Error {
  readonly classified: ClassifiedError;

  constructor(code: StageErrorCode, message: string, extra: Omit<ClassifiedError, 'class' | 'code' | 'message'> = {}) {
    super(message);
    this.name = 'StageError';
    this.classified = classified(code, message, extra);
  }

  get code(): StageErrorCode {
    return this.classified.code;
  }

  get errorClass(): ErrorClass {
    return this.classified.class;
  }
}

// ── Classification ───────────────────────────────────────────────

/** Composition failures (P02 `ComposeError.code`) → codes. */
const COMPOSE_CODES: Readonly<Record<string, StageErrorCode>> = {
  agent_not_found: 'agent_not_found',
  agent_disabled: 'agent_disabled',
  workspace_missing: 'config_invalid',
  secret_unresolved: 'config_invalid',
  PERMISSION_GATING_UNSUPPORTED: 'config_invalid',
};

/** Node / undici socket failures: the connection, not the request, failed. */
const TRANSPORT_ERRNO = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

function errorName(err: unknown): string | undefined {
  if (err && typeof err === 'object' && typeof (err as { name?: unknown }).name === 'string') {
    return (err as { name: string }).name;
  }
  return undefined;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  try {
    return JSON.stringify(err) ?? String(err);
  } catch {
    return String(err);
  }
}

function field<T>(err: unknown, key: string): T | undefined {
  return err && typeof err === 'object' ? ((err as Record<string, unknown>)[key] as T | undefined) : undefined;
}

/** HTTP status → code, for errors that carry one. */
export function codeForHttpStatus(status: number): StageErrorCode | undefined {
  if (status === 429) return 'rate_limited';
  if (status === 529) return 'overloaded';
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'model_not_found';
  if (status === 408) return 'transport';
  if (status === 413) return 'context_overflow';
  if (status >= 500 && status <= 599) return 'provider_5xx';
  if (status === 400 || status === 422) return 'config_invalid';
  return undefined;
}

/**
 * Message patterns every provider's plain errors share, most specific
 * first. Used only when nothing structured (a code, a status) is present.
 */
const MESSAGE_PATTERNS: ReadonlyArray<[RegExp, StageErrorCode]> = [
  [/\boverloaded(_error)?\b|\b529\b/i, 'overloaded'],
  [/\brate[ _-]?limit|\btoo many requests\b|\b429\b/i, 'rate_limited'],
  [/\b(usage|quota) (limit|exceeded)|insufficient[_ ]quota|\bbilling\b|credit balance/i, 'quota_exhausted'],
  [/context (window|length)|prompt is too long|maximum context|too many tokens/i, 'context_overflow'],
  [/\b(unauthori[sz]ed|authentication|invalid api key|not logged in|forbidden)\b|\b401\b|\b403\b/i, 'auth'],
  [/model[^.]{0,40}\b(not found|does not exist|not available|unknown)\b|unknown model/i, 'model_not_found'],
  [/\bmax(imum)?[ _-]?turns\b/i, 'max_turns'],
  [/\b(internal server error|bad gateway|service unavailable|gateway timeout)\b|\b50[0-4]\b/i, 'provider_5xx'],
  [/\b(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|socket hang up|network error|fetch failed|stream (closed|disconnected))\b/i, 'transport'],
  [/process exited|exited with code|terminated by signal|\bcrashed\b/i, 'provider_crashed'],
];

/** Parse a Retry-After value (seconds, or an HTTP date relative to nothing: ignored). */
function retryAfterFrom(err: unknown): number | undefined {
  const direct = field<number>(err, 'retryAfterMs');
  if (typeof direct === 'number' && Number.isFinite(direct) && direct >= 0) return direct;
  const headers = field<Record<string, unknown>>(err, 'headers');
  const raw = headers?.['retry-after'] ?? headers?.['Retry-After'];
  const secs = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (Number.isFinite(secs) && secs >= 0) return Math.round(secs * 1000);
  const m = /retry[- ]after[:= ]\s*(\d+(?:\.\d+)?)\s*(ms|s)?/i.exec(errorMessage(err));
  if (m) return Math.round(Number(m[1]) * (m[2]?.toLowerCase() === 'ms' ? 1 : 1000));
  return undefined;
}

function withRetryAfter(c: ClassifiedError, err: unknown): ClassifiedError {
  const ms = retryAfterFrom(err);
  return ms === undefined ? c : { ...c, retryAfterMs: ms };
}

/**
 * Classify anything an attempt threw or reported (G5 §3.1). Never throws.
 *
 * Recognised, in order: an engine `StageError`; an already-classified
 * object; a provider `HarnessError` (`{name: 'HarnessError', code}`, from
 * `@generatorai/agent-harness-providers`); composition, admission and human
 * rejection errors; an HTTP status or errno; then message patterns.
 */
export function classifyStageError(err: unknown): ClassifiedError {
  if (err instanceof StageError) return err.classified;

  // An already-classified value (e.g. read back from an attempt row).
  const cls = field<unknown>(err, 'class');
  const code = field<unknown>(err, 'code');
  if (typeof cls === 'string' && isStageErrorCode(code) && typeof field(err, 'message') === 'string') {
    return err as ClassifiedError;
  }

  const name = errorName(err);
  const message = errorMessage(err);

  if (name === 'HarnessError' && isStageErrorCode(code)) {
    const providerCode = field<unknown>(err, 'providerCode');
    return withRetryAfter(
      classified(code, message, {
        ...(providerCode === undefined ? {} : { details: { providerCode } }),
        ...(field(err, 'unclassified') === true ? { unclassified: true as const } : {}),
      }),
      err,
    );
  }
  if (name === 'ComposeError' && typeof code === 'string') {
    return classified(COMPOSE_CODES[code] ?? 'config_invalid', message, { details: { composeCode: code } });
  }
  if (name === 'AdmissionTimeoutError') return classified('queue_timeout', message);
  if (field(err, 'rejected') === true) return classified('rejected_by_human', message);
  if (name === 'PermissionGatingUnsupportedError') return classified('config_invalid', message);

  const status = field<unknown>(err, 'status') ?? field<unknown>(err, 'statusCode');
  if (typeof status === 'number') {
    const byStatus = codeForHttpStatus(status);
    if (byStatus) return withRetryAfter(classified(byStatus, message, { details: { status } }), err);
  }
  if (typeof code === 'string' && TRANSPORT_ERRNO.has(code)) return classified('transport', message, { details: { errno: code } });

  for (const [pattern, patternCode] of MESSAGE_PATTERNS) {
    if (pattern.test(message)) return withRetryAfter(classified(patternCode, message), err);
  }
  return classified('transport', message, { unclassified: true });
}
