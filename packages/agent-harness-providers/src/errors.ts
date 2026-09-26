// ────────────────────────────────────────────────────────────────
// HarnessError — provider failures in the stage error vocabulary
// (P03 WP-3.4, G5 §3.1).
//
// Every provider reports failure its own way: the Claude Agent SDK as an
// assistant-message `error` enum or a `result` subtype, Codex as a
// `codexErrorInfo` tag on a turn error, Copilot, opencode and ACP as HTTP
// statuses, JSON-RPC errors or plain messages. `toHarnessError(provider,
// raw)` maps each onto a `StageErrorCode` (the table lives in
// `@generatorai/workflow-spec`), so the engine's `classifyStageError`
// (`@generatorai/core`) sees one shape: `{name: 'HarnessError', code,
// retryAfterMs?}`. The mapping is per provider because the same word means
// different things (`usageLimitExceeded` is a quota for Codex, not a rate
// limit to wait out; `error_during_execution` is a crashed Claude turn).
//
// Unrecognised values map to `transport` with `unclassified: true`; the
// scheduler retries those at most once.
// ────────────────────────────────────────────────────────────────

// Types only: the barrel must not load core at runtime (W41 lazy loading).
import type { StageErrorCode } from '@generatorai/core';

export type HarnessErrorProvider = 'claude-agent' | 'codex' | 'copilot' | 'opencode' | 'acp' | 'faux';

export class HarnessError extends Error {
  override readonly name = 'HarnessError';
  constructor(
    readonly code: StageErrorCode,
    message: string,
    readonly provider: HarnessErrorProvider,
    readonly opts: {
      /** Honoured over the computed backoff. */
      retryAfterMs?: number;
      /** The provider's own code, for the attempt's error details. */
      providerCode?: string;
      unclassified?: true;
      cause?: unknown;
    } = {},
  ) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
  }

  get retryAfterMs(): number | undefined {
    return this.opts.retryAfterMs;
  }

  get providerCode(): string | undefined {
    return this.opts.providerCode;
  }

  get unclassified(): boolean {
    return this.opts.unclassified === true;
  }
}

// ── Claude Agent SDK ─────────────────────────────────────────────

/** `SDKAssistantMessageError` (the assistant message's `error` field). */
const CLAUDE_ASSISTANT_ERRORS: Readonly<Record<string, StageErrorCode>> = {
  authentication_failed: 'auth',
  oauth_org_not_allowed: 'auth',
  billing_error: 'quota_exhausted',
  rate_limit: 'rate_limited',
  overloaded: 'overloaded',
  invalid_request: 'config_invalid',
  model_not_found: 'model_not_found',
  server_error: 'provider_5xx',
  // The reply was cut at the output cap: the turn produced a partial answer.
  // Retrying the same turn in the same session hits the same cap.
  max_output_tokens: 'context_overflow',
};

/** `SDKResultMessage` error subtypes. */
const CLAUDE_RESULT_SUBTYPES: Readonly<Record<string, StageErrorCode>> = {
  error_max_turns: 'max_turns',
  error_max_budget_usd: 'budget_exceeded',
  error_max_structured_output_retries: 'output_schema',
  error_during_execution: 'provider_crashed',
};

/** Anthropic API error `type`s that appear inside "API Error: <status> {json}" messages. */
const ANTHROPIC_API_TYPES: Readonly<Record<string, StageErrorCode>> = {
  overloaded_error: 'overloaded',
  rate_limit_error: 'rate_limited',
  api_error: 'provider_5xx',
  authentication_error: 'auth',
  permission_error: 'auth',
  not_found_error: 'model_not_found',
  invalid_request_error: 'config_invalid',
  request_too_large: 'context_overflow',
};

// ── Codex app-server ─────────────────────────────────────────────

/** `V2CodexErrorInfo` tags (bare strings or the key of a single-key object). */
const CODEX_ERROR_INFO: Readonly<Record<string, StageErrorCode>> = {
  contextWindowExceeded: 'context_overflow',
  sessionBudgetExceeded: 'budget_exceeded',
  // A plan's usage window resets after hours: waiting a minute never helps.
  usageLimitExceeded: 'quota_exhausted',
  rateLimitExceeded: 'rate_limited',
  serverOverloaded: 'overloaded',
  cyberPolicy: 'config_invalid',
  misalignmentPolicyViolation: 'config_invalid',
  internalServerError: 'provider_5xx',
  unauthorized: 'auth',
  badRequest: 'config_invalid',
  threadRollbackFailed: 'provider_crashed',
  sandboxError: 'config_invalid',
  httpConnectionFailed: 'transport',
  responseStreamConnectionFailed: 'transport',
  responseStreamDisconnected: 'transport',
  responseTooManyFailedAttempts: 'provider_5xx',
};

// ── Shared fallbacks ─────────────────────────────────────────────

function httpStatusCode(status: number): StageErrorCode | undefined {
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

const TRANSPORT_ERRNO = new Set(['ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH']);

/** JSON-RPC 2.0 error codes (ACP, opencode's and Codex's transports). */
function jsonRpcCode(code: number, message: string): StageErrorCode | undefined {
  if (code === -32000 && /auth/i.test(message)) return 'auth';
  if (code === -32602 || code === -32600 || code === -32601) return 'config_invalid';
  if (code === -32603) return 'provider_5xx';
  return undefined;
}

const MESSAGE_PATTERNS: ReadonlyArray<[RegExp, StageErrorCode]> = [
  [/\boverloaded(_error)?\b|\b529\b/i, 'overloaded'],
  [/\brate[ _-]?limit|\btoo many requests\b|\b429\b/i, 'rate_limited'],
  [/\b(usage|quota) (limit|exceeded)|insufficient[_ ]quota|\bbilling\b|credit balance/i, 'quota_exhausted'],
  [/context (window|length)|prompt is too long|maximum context|too many tokens/i, 'context_overflow'],
  [/\b(unauthori[sz]ed|authentication|invalid api key|not logged in|forbidden)\b|\b401\b|\b403\b/i, 'auth'],
  [/model[^.]{0,40}\b(not found|does not exist|not available|unknown)\b|unknown model/i, 'model_not_found'],
  [/\b(internal server error|bad gateway|service unavailable|gateway timeout)\b|\b50[0-4]\b/i, 'provider_5xx'],
  [/\b(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|socket hang up|network error|fetch failed|stream (closed|disconnected))\b/i, 'transport'],
  [/process exited|exited with code|terminated by signal|\bcrashed\b|spawn .* E[A-Z]+/i, 'provider_crashed'],
];

function messageOf(raw: unknown): string {
  if (raw instanceof Error) return raw.message;
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object') {
    const m = (raw as { message?: unknown }).message;
    if (typeof m === 'string') return m;
    try {
      return JSON.stringify(raw);
    } catch {
      return String(raw);
    }
  }
  return String(raw);
}

function get(raw: unknown, key: string): unknown {
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>)[key] : undefined;
}

/** Retry-After from a header map, a number of seconds, or the message text. */
function retryAfterMs(raw: unknown, message: string): number | undefined {
  const direct = get(raw, 'retryAfterMs');
  if (typeof direct === 'number' && direct >= 0) return direct;
  const headers = get(raw, 'headers') as Record<string, unknown> | undefined;
  const header = headers?.['retry-after'] ?? headers?.['Retry-After'];
  const secs = typeof header === 'number' ? header : typeof header === 'string' ? Number(header) : NaN;
  if (Number.isFinite(secs) && secs >= 0) return Math.round(secs * 1000);
  const m = /retry[- ]after[:= ]\s*(\d+(?:\.\d+)?)\s*(ms|s)?/i.exec(message);
  if (m) return Math.round(Number(m[1]) * (m[2]?.toLowerCase() === 'ms' ? 1 : 1000));
  return undefined;
}

function tagOf(info: unknown): string | undefined {
  if (typeof info === 'string') return info;
  if (info && typeof info === 'object') return Object.keys(info)[0];
  return undefined;
}

function nestedHttpStatus(info: unknown): number | undefined {
  if (!info || typeof info !== 'object') return undefined;
  const inner = Object.values(info)[0];
  const status = get(inner, 'httpStatusCode');
  return typeof status === 'number' ? status : undefined;
}

/** Status, errno, JSON-RPC code, then message patterns — common to every provider. */
function genericCode(raw: unknown, message: string): { code: StageErrorCode; providerCode?: string } | undefined {
  const status = get(raw, 'status') ?? get(raw, 'statusCode');
  if (typeof status === 'number') {
    const code = httpStatusCode(status);
    if (code) return { code, providerCode: `http_${status}` };
  }
  const errno = get(raw, 'code');
  if (typeof errno === 'string' && TRANSPORT_ERRNO.has(errno)) return { code: 'transport', providerCode: errno };
  if (errno === 'ENOENT' && /spawn/i.test(message)) return { code: 'config_invalid', providerCode: 'ENOENT' };
  if (typeof errno === 'number') {
    const code = jsonRpcCode(errno, message);
    if (code) return { code, providerCode: `jsonrpc_${errno}` };
  }
  const apiType = /"type"\s*:\s*"error"\s*,\s*"error"\s*:\s*\{\s*"type"\s*:\s*"([a-z_]+)"/.exec(message)?.[1];
  if (apiType && ANTHROPIC_API_TYPES[apiType]) {
    // The API reports an over-long prompt as a plain invalid request.
    const overflow = apiType === 'invalid_request_error' && /prompt is too long|context (window|length)/i.test(message);
    return { code: overflow ? 'context_overflow' : ANTHROPIC_API_TYPES[apiType], providerCode: apiType };
  }
  for (const [pattern, code] of MESSAGE_PATTERNS) if (pattern.test(message)) return { code };
  return undefined;
}

function providerSpecific(provider: HarnessErrorProvider, raw: unknown): { code: StageErrorCode; providerCode?: string } | undefined {
  if (provider === 'claude-agent') {
    // A bare enum value (the assistant message's `error`), or a result message.
    if (typeof raw === 'string' && CLAUDE_ASSISTANT_ERRORS[raw]) return { code: CLAUDE_ASSISTANT_ERRORS[raw], providerCode: raw };
    const assistantError = get(raw, 'error');
    if (typeof assistantError === 'string' && CLAUDE_ASSISTANT_ERRORS[assistantError]) {
      return { code: CLAUDE_ASSISTANT_ERRORS[assistantError], providerCode: assistantError };
    }
    const subtype = get(raw, 'subtype');
    if (typeof subtype === 'string' && CLAUDE_RESULT_SUBTYPES[subtype]) return { code: CLAUDE_RESULT_SUBTYPES[subtype], providerCode: subtype };
    return undefined;
  }
  if (provider === 'codex') {
    // A `TurnError`, a `CodexRateLimitedError` (`info`), or a bare tag.
    const info = get(raw, 'codexErrorInfo') ?? get(raw, 'info') ?? get(get(raw, 'error'), 'codexErrorInfo') ?? (typeof raw === 'string' ? raw : undefined);
    const tag = tagOf(info);
    if (tag && CODEX_ERROR_INFO[tag]) {
      const status = nestedHttpStatus(info);
      const byStatus = status !== undefined ? httpStatusCode(status) : undefined;
      // A connection failure that carries an upstream status is that status.
      const code = CODEX_ERROR_INFO[tag] === 'transport' && byStatus ? byStatus : CODEX_ERROR_INFO[tag];
      return { code, providerCode: tag };
    }
    return undefined;
  }
  return undefined;
}

/** Map a provider failure onto the stage error vocabulary. Never throws. */
export function toHarnessError(provider: HarnessErrorProvider, raw: unknown): HarnessError {
  if (raw instanceof HarnessError) return raw;
  const message = messageOf(raw);
  const hit = providerSpecific(provider, raw) ?? genericCode(raw, message);
  const retryAfter = retryAfterMs(raw, message);
  const opts = {
    ...(retryAfter !== undefined ? { retryAfterMs: retryAfter } : {}),
    ...(hit?.providerCode ? { providerCode: hit.providerCode } : {}),
    ...(hit ? {} : { unclassified: true as const }),
    cause: raw,
  };
  return new HarnessError(hit?.code ?? 'transport', message, provider, opts);
}


const HARNESS_ERROR_PROVIDERS: ReadonlySet<string> = new Set<HarnessErrorProvider>(['claude-agent', 'codex', 'copilot', 'opencode', 'acp', 'faux']);

/**
 * The engine's harness boundary (`CoreServicesInputs.toHarnessError`): a
 * provider id the engine read from a session (possibly unknown or absent)
 * maps to its classifier; anything else is classified generically.
 */
export function harnessErrorOf(provider: string | undefined, raw: unknown): HarnessError {
  return toHarnessError((provider && HARNESS_ERROR_PROVIDERS.has(provider) ? provider : 'faux') as HarnessErrorProvider, raw);
}
