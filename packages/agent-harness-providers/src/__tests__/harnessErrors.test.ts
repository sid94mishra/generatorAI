// P03 WP-3.4 — every recorded provider failure maps to its stage error code,
// and the engine's classifier reads a HarnessError without knowing the provider.

import { classifyStageError } from '@generatorai/core';
import { describe, expect, it } from 'vitest';

import { HarnessError, harnessErrorClass, toHarnessError } from '../errors.js';
import { HARNESS_ERROR_FIXTURES } from './fixtures/harnessErrors.js';

describe('toHarnessError (recorded fixtures)', () => {
  it.each(HARNESS_ERROR_FIXTURES.map((f) => [`${f.provider}: ${f.name}`, f] as const))('%s', (_label, f) => {
    const err = toHarnessError(f.provider, f.raw);
    expect(err).toBeInstanceOf(HarnessError);
    expect(err.code).toBe(f.code);
    expect(err.provider).toBe(f.provider);
    expect(err.unclassified).toBe(f.unclassified === true);
    if (f.retryAfterMs !== undefined) expect(err.retryAfterMs).toBe(f.retryAfterMs);

    // The core classifier reads the same code and class, provider-blind.
    const c = classifyStageError(err);
    expect(c.code).toBe(f.code);
    expect(c.class).toBe(harnessErrorClass(err));
    expect(c.unclassified === true).toBe(f.unclassified === true);
    if (f.retryAfterMs !== undefined) expect(c.retryAfterMs).toBe(f.retryAfterMs);
  });

  it('passes an existing HarnessError through unchanged', () => {
    const err = new HarnessError('overloaded', 'busy', 'codex');
    expect(toHarnessError('claude-agent', err)).toBe(err);
  });

  it('keeps the provider code for the attempt details', () => {
    const c = classifyStageError(toHarnessError('codex', { message: 'x', codexErrorInfo: 'serverOverloaded' }));
    expect(c.details).toEqual({ providerCode: 'serverOverloaded' });
    expect(c.class).toBe('transient');
  });
});
