// P03 WP-3.4 — classifyStageError (G5 §3.1): every source of an attempt
// failure, including those raised before the attempt body, gets a code and
// the class the spec table gives that code.

import { STAGE_ERROR_CODE_CLASS } from '@generatorai/workflow-spec';
import { describe, expect, it } from 'vitest';

import { ComposeError } from '../../src/services/session/types.js';
import { StageError, classifyStageError, classified, errorClassOf } from '../../src/domain/errors/StageError.js';

const harness = (code: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(`harness ${code}`), { name: 'HarnessError', code, ...extra });

describe('classifyStageError', () => {
  it.each<[string, unknown, string, string]>([
    // engine-raised
    ['StageError pre_run abort', new StageError('pre_run_hook_abort', 'hook said no'), 'pre_run_hook_abort', 'deterministic'],
    ['StageError output_schema', new StageError('output_schema', 'bad json'), 'output_schema', 'repairable'],
    ['StageError idle watchdog', new StageError('idle_timeout', 'no events'), 'idle_timeout', 'transient'],
    ['StageError lease', new StageError('lease_expired', 'lease'), 'lease_expired', 'interrupted'],
    // before the attempt body
    ['ComposeError agent_not_found', new ComposeError('agent_not_found', 'no agent'), 'agent_not_found', 'deterministic'],
    ['ComposeError agent_disabled', new ComposeError('agent_disabled', 'off'), 'agent_disabled', 'deterministic'],
    ['ComposeError secret_unresolved', new ComposeError('secret_unresolved', 'no secret'), 'config_invalid', 'deterministic'],
    ['human rejection', Object.assign(new Error('rejected'), { rejected: true }), 'rejected_by_human', 'deterministic'],
    // providers (HarnessError, duck-typed)
    ['HarnessError overloaded', harness('overloaded'), 'overloaded', 'transient'],
    ['HarnessError quota', harness('quota_exhausted'), 'quota_exhausted', 'deterministic'],
    // HTTP, errno, messages
    ['HTTP 429', Object.assign(new Error('too many'), { status: 429 }), 'rate_limited', 'transient'],
    ['HTTP 503', Object.assign(new Error('unavailable'), { statusCode: 503 }), 'provider_5xx', 'transient'],
    ['HTTP 401', Object.assign(new Error('no'), { status: 401 }), 'auth', 'deterministic'],
    ['errno', Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }), 'transport', 'transient'],
    ['message overloaded', new Error('upstream overloaded, try later'), 'overloaded', 'transient'],
    ['message context', new Error('prompt is too long'), 'context_overflow', 'deterministic'],
    ['message max turns', new Error('Reached max turns (12)'), 'max_turns', 'deterministic'],
    ['string', 'socket hang up', 'transport', 'transient'],
  ])('%s', (_label, input, code, cls) => {
    const c = classifyStageError(input);
    expect(c.code).toBe(code);
    expect(c.class).toBe(cls);
    expect(c.class).toBe(STAGE_ERROR_CODE_CLASS[c.code]);
    expect(c.unclassified).toBeUndefined();
  });

  it('an unknown error is transient transport, flagged unclassified (retried at most once)', () => {
    const c = classifyStageError(new Error('something odd'));
    expect(c).toMatchObject({ class: 'transient', code: 'transport', unclassified: true, message: 'something odd' });
    expect(classifyStageError(undefined)).toMatchObject({ code: 'transport', unclassified: true });
  });

  it('honours Retry-After from the error, its headers or its message', () => {
    expect(classifyStageError(harness('rate_limited', { retryAfterMs: 1500 })).retryAfterMs).toBe(1500);
    expect(classifyStageError(Object.assign(new Error('x'), { status: 429, headers: { 'retry-after': '3' } })).retryAfterMs).toBe(3000);
    expect(classifyStageError(new Error('rate limited, retry-after: 250ms')).retryAfterMs).toBe(250);
  });

  it('returns an already-classified value unchanged', () => {
    const c = classified('validation_rule', 'rule r1 failed', { details: { rules: ['r1'] } });
    expect(classifyStageError(c)).toBe(c);
    expect(errorClassOf('validation_rule')).toBe('repairable');
  });

  it('never throws', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(() => classifyStageError(cyclic)).not.toThrow();
    expect(() => classifyStageError(Symbol('x'))).not.toThrow();
  });
});
