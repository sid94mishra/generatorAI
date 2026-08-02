// ────────────────────────────────────────────────────────────────
// Tests — shared telemetry tracing utilities
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { getTracer, withSpan, recordException } from '../src/telemetry/tracing.js';

describe('getTracer', () => {
  it('returns a tracer from the global provider', () => {
    const tracer = getTracer('test-tracer');
    expect(tracer).toBeDefined();
    // No-op tracer when SDK is not initialized — still has startActiveSpan
    expect(typeof tracer.startActiveSpan).toBe('function');
  });
});

describe('withSpan', () => {
  it('executes the callback and returns the result', async () => {
    const result = await withSpan('test', 'test-span', () => 42);
    expect(result).toBe(42);
  });

  it('propagates errors from the callback', async () => {
    const err = new Error('boom');
    await expect(
      withSpan('test', 'error-span', () => { throw err; }),
    ).rejects.toThrow('boom');
  });

  it('passes attributes to the span', async () => {
    const result = await withSpan(
      'test',
      'attr-span',
      (span) => {
        // Span should have been created — with no-op provider it's a no-op span
        expect(span).toBeDefined();
        return 'ok';
      },
      { 'test.attr': 'value' },
    );
    expect(result).toBe('ok');
  });

  it('resolves async callbacks', async () => {
    const result = await withSpan('test', 'async-span', async () => {
      return Promise.resolve('async-result');
    });
    expect(result).toBe('async-result');
  });
});

describe('recordException', () => {
  it('records an Error instance on the span', () => {
    const span = {
      recordException: vi.fn(),
      setStatus: vi.fn(),
    } as unknown as import('@opentelemetry/api').Span;

    const err = new Error('test error');
    recordException(span, err);

    expect(span.recordException).toHaveBeenCalledWith(err);
    expect(span.setStatus).toHaveBeenCalledWith({
      code: SpanStatusCode.ERROR,
      message: 'test error',
    });
  });

  it('records a non-Error value on the span', () => {
    const span = {
      recordException: vi.fn(),
      setStatus: vi.fn(),
    } as unknown as import('@opentelemetry/api').Span;

    recordException(span, 'string error');

    expect(span.setStatus).toHaveBeenCalledWith({
      code: SpanStatusCode.ERROR,
      message: 'string error',
    });
  });
});
