// ────────────────────────────────────────────────────────────────
// Recorded provider failures (P03 WP-3.4). Each `raw` is the value a
// provider hands its adapter — shapes from the Claude Agent SDK
// (`SDKAssistantMessageError`, `SDKResultMessage`), the Codex app-server
// protocol (`TurnError.codexErrorInfo`), and the HTTP / JSON-RPC / Node
// errors the Copilot, opencode and ACP transports surface — with the
// stage error code it must map to.
// ────────────────────────────────────────────────────────────────

import type { StageErrorCode } from '@generatorai/core';
import type { HarnessErrorProvider } from '../../errors.js';

export interface HarnessErrorFixture {
  provider: HarnessErrorProvider;
  name: string;
  raw: unknown;
  code: StageErrorCode;
  retryAfterMs?: number;
  unclassified?: boolean;
}

export const HARNESS_ERROR_FIXTURES: HarnessErrorFixture[] = [
  // ── claude-agent ──
  { provider: 'claude-agent', name: 'assistant error rate_limit', raw: { type: 'assistant', error: 'rate_limit', message: { content: [] } }, code: 'rate_limited' },
  { provider: 'claude-agent', name: 'assistant error overloaded', raw: 'overloaded', code: 'overloaded' },
  { provider: 'claude-agent', name: 'assistant error authentication_failed', raw: 'authentication_failed', code: 'auth' },
  { provider: 'claude-agent', name: 'assistant error billing_error', raw: 'billing_error', code: 'quota_exhausted' },
  { provider: 'claude-agent', name: 'assistant error model_not_found', raw: 'model_not_found', code: 'model_not_found' },
  { provider: 'claude-agent', name: 'assistant error server_error', raw: 'server_error', code: 'provider_5xx' },
  { provider: 'claude-agent', name: 'assistant error max_output_tokens', raw: 'max_output_tokens', code: 'context_overflow' },
  { provider: 'claude-agent', name: 'result error_max_turns', raw: { type: 'result', subtype: 'error_max_turns', is_error: true, num_turns: 12 }, code: 'max_turns' },
  { provider: 'claude-agent', name: 'result error_max_budget_usd', raw: { type: 'result', subtype: 'error_max_budget_usd', is_error: true }, code: 'budget_exceeded' },
  {
    provider: 'claude-agent',
    name: 'result error_max_structured_output_retries',
    raw: { type: 'result', subtype: 'error_max_structured_output_retries', is_error: true },
    code: 'output_schema',
  },
  { provider: 'claude-agent', name: 'result error_during_execution', raw: { type: 'result', subtype: 'error_during_execution', is_error: true }, code: 'provider_crashed' },
  {
    provider: 'claude-agent',
    name: 'API Error 529 text',
    raw: new Error('API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}'),
    code: 'overloaded',
  },
  {
    provider: 'claude-agent',
    name: 'API Error 400 prompt too long',
    raw: new Error('API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 212000 tokens > 200000 maximum"}}'),
    code: 'context_overflow',
  },
  {
    provider: 'claude-agent',
    name: 'API Error 400 invalid model parameter',
    raw: new Error('API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"max_tokens: must be positive"}}'),
    code: 'config_invalid',
  },
  { provider: 'claude-agent', name: 'CLI process exit', raw: new Error('Claude Code process exited with code 1'), code: 'provider_crashed' },

  // ── codex ──
  { provider: 'codex', name: 'turn error rateLimitExceeded', raw: { message: 'Rate limit reached', codexErrorInfo: 'rateLimitExceeded' }, code: 'rate_limited' },
  { provider: 'codex', name: 'turn error usageLimitExceeded', raw: { message: 'You have hit your usage limit', codexErrorInfo: 'usageLimitExceeded' }, code: 'quota_exhausted' },
  { provider: 'codex', name: 'turn error serverOverloaded', raw: { message: 'overloaded', codexErrorInfo: 'serverOverloaded' }, code: 'overloaded' },
  { provider: 'codex', name: 'turn error contextWindowExceeded', raw: { message: 'context window', codexErrorInfo: 'contextWindowExceeded' }, code: 'context_overflow' },
  { provider: 'codex', name: 'turn error unauthorized', raw: { message: 'unauthorized', codexErrorInfo: 'unauthorized' }, code: 'auth' },
  { provider: 'codex', name: 'turn error sessionBudgetExceeded', raw: { message: 'budget', codexErrorInfo: 'sessionBudgetExceeded' }, code: 'budget_exceeded' },
  {
    provider: 'codex',
    name: 'stream disconnected without status',
    raw: { message: 'stream disconnected before completion', codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: null } } },
    code: 'transport',
  },
  {
    provider: 'codex',
    name: 'connection failed with a 503',
    raw: { message: 'http connection failed', codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 503 } } },
    code: 'provider_5xx',
  },
  {
    provider: 'codex',
    name: 'CodexRateLimitedError (info)',
    raw: Object.assign(new Error('Rate limit reached for gpt-5 in organization org-x'), { name: 'CodexRateLimitedError', info: 'rateLimitExceeded' }),
    code: 'rate_limited',
  },
  { provider: 'codex', name: 'notification error wrapper', raw: { error: { message: 'Internal error', codexErrorInfo: 'internalServerError' } }, code: 'provider_5xx' },

  // ── copilot ──
  {
    provider: 'copilot',
    name: 'HTTP 429 with Retry-After',
    raw: Object.assign(new Error('Request failed with status 429'), { status: 429, headers: { 'retry-after': '7' } }),
    code: 'rate_limited',
    retryAfterMs: 7000,
  },
  { provider: 'copilot', name: 'HTTP 401', raw: Object.assign(new Error('Unauthorized'), { status: 401 }), code: 'auth' },
  { provider: 'copilot', name: 'socket reset', raw: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }), code: 'transport' },
  { provider: 'copilot', name: 'CLI not installed', raw: Object.assign(new Error('spawn copilot ENOENT'), { code: 'ENOENT' }), code: 'config_invalid' },

  // ── opencode ──
  { provider: 'opencode', name: 'HTTP 502 from the server', raw: Object.assign(new Error('Bad Gateway'), { statusCode: 502 }), code: 'provider_5xx' },
  { provider: 'opencode', name: 'model missing', raw: new Error('Model anthropic/claude-x not found'), code: 'model_not_found' },

  // ── acp ──
  { provider: 'acp', name: 'JSON-RPC auth required', raw: { code: -32000, message: 'Authentication required' }, code: 'auth' },
  { provider: 'acp', name: 'JSON-RPC internal error', raw: { code: -32603, message: 'Internal error' }, code: 'provider_5xx' },
  { provider: 'acp', name: 'JSON-RPC invalid params', raw: { code: -32602, message: 'Invalid params' }, code: 'config_invalid' },

  // ── unrecognised ──
  { provider: 'faux', name: 'unknown failure', raw: new Error('something odd happened'), code: 'transport', unclassified: true },
];
