// ────────────────────────────────────────────────────────────────
// Error Handling Middleware — normalizes errors to HTTP responses
// ────────────────────────────────────────────────────────────────

import type { Request, Response, NextFunction } from 'express';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import type { ILogger } from '@generatorai/shared';
import {
  GeneratorAIError,
  UnknownError,
  ERROR_STATUS_MAP,
  DAGValidationError,
  SessionAllocationError,
} from '@generatorai/shared';

/**
 * Express error-handling middleware.
 * Normalizes any thrown error to a GeneratorAIError, maps its category
 * to an HTTP status code, and returns a structured JSON error response.
 *
 * v2 error handling:
 * - DAGValidationError → 422 (Unprocessable Entity)
 * - SessionAllocationError → 503 (Service Unavailable)
 */
export function createErrorMiddleware(logger: ILogger) {
  return (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    const normalized = normalizeError(err);

    // v2: Override status codes for specific error types
    let status: number;
    if (normalized instanceof DAGValidationError) {
      status = 422;
    } else if (normalized instanceof SessionAllocationError) {
      status = 503;
    } else if ('httpStatus' in normalized && typeof normalized.httpStatus === 'number') {
      // Preserve HTTP status from Express built-in errors (e.g. body-parser 413)
      status = normalized.httpStatus;
    } else {
      status = ERROR_STATUS_MAP[normalized.category] ?? 500;
    }

    const isDev = process.env['NODE_ENV'] === 'development';

    // Always log the full stack server-side so ops can correlate by requestId
    // even when the client response omits it (production).
    logger.error(`[ErrorHandler] ${normalized.code}: ${normalized.message}`, {
      requestId: req.requestId,
      status,
      category: normalized.category,
      code: normalized.code,
      path: req.path,
      method: req.method,
      stack: normalized.stack,
    });

    // Record the error on the active OTel span so it surfaces in trace views
    const span = trace.getActiveSpan();
    if (span) {
      span.recordException(normalized);
      span.setStatus({ code: SpanStatusCode.ERROR, message: normalized.message });
      span.setAttribute('error.type', normalized.constructor.name);
      span.setAttribute('error.code', normalized.code);
      span.setAttribute('error.category', normalized.category);
    }

    // Always include requestId so clients can cite it when reporting issues.
    // Only include stack in dev — avoid leaking internal paths in prod.
    const response: Record<string, unknown> = {
      error: {
        code: normalized.code,
        category: normalized.category,
        message: normalized.message,
        recoverable: normalized.recoverable,
        requestId: req.requestId,
      },
    };

    if (isDev && normalized.stack) {
      (response['error'] as Record<string, unknown>)['stack'] = normalized.stack;
    }

    res.status(status).json(response);
  };
}

/**
 * Normalize any thrown value to a GeneratorAIError.
 * Preserves HTTP status codes from Express built-in errors (e.g. body-parser 413).
 */
function normalizeError(err: unknown): GeneratorAIError & { httpStatus?: number } {
  if (err instanceof GeneratorAIError) {
    return err;
  }
  if (err instanceof Error) {
    const normalized = new UnknownError(err.message, err);
    // Express body-parser and similar middleware set a numeric `status` on the error
    // (e.g. 413 Payload Too Large, 400 Bad Request). Preserve it so the error handler
    // returns the correct HTTP status instead of the fallback 500/502.
    const maybeStatus = (err as unknown as Record<string, unknown>)['status'];
    if (typeof maybeStatus === 'number' && maybeStatus >= 400 && maybeStatus < 600) {
      (normalized as GeneratorAIError & { httpStatus?: number }).httpStatus = maybeStatus;
    }
    return normalized;
  }
  return new UnknownError(String(err));
}
