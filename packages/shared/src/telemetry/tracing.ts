// ────────────────────────────────────────────────────────────────
// Tracing Utilities — shared helpers for OpenTelemetry spans
// ────────────────────────────────────────────────────────────────

import { trace, SpanStatusCode, type Span, type Tracer } from '@opentelemetry/api';

const PKG_VERSION = '0.1.0';

/**
 * Acquire a tracer scoped to the given instrumentation name.
 * Safe to call even when OTel SDK is not initialised (returns no-op tracer).
 */
export function getTracer(name: string): Tracer {
  return trace.getTracer(name, PKG_VERSION);
}

/**
 * Run `fn` inside an active span. The span is automatically ended
 * when the callback resolves/rejects, and exceptions are recorded.
 */
export async function withSpan<T>(
  tracerName: string,
  spanName: string,
  fn: (span: Span) => T | Promise<T>,
  attributes?: Record<string, string | number | boolean>,
): Promise<T> {
  const tracer = getTracer(tracerName);
  return tracer.startActiveSpan(spanName, { attributes }, async (span: Span) => {
    try {
      const result = await fn(span);
      return result;
    } catch (err) {
      recordException(span, err);
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Record an exception on a span and set its status to ERROR.
 */
export function recordException(span: Span, err: unknown): void {
  if (err instanceof Error) {
    span.recordException(err);
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
  } else {
    span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
  }
}
