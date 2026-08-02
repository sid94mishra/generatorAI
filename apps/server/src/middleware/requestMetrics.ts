// ────────────────────────────────────────────────────────────────
// Request Metrics Middleware — OTel HTTP metrics + request-id on span
// ────────────────────────────────────────────────────────────────

import type { Request, Response, NextFunction } from 'express';
import { trace } from '@opentelemetry/api';
import { getMeter } from '@generatorai/shared';

const meter = getMeter('generatorai-server');

const httpRequestDuration = meter.createHistogram('http.server.request.duration', {
  description: 'Duration of HTTP server requests',
  unit: 'ms',
});

const httpRequestTotal = meter.createCounter('http.server.request.total', {
  description: 'Total number of HTTP server requests',
});

const httpActiveRequests = meter.createUpDownCounter('http.server.active_requests', {
  description: 'Number of in-flight HTTP requests',
});

/**
 * Express middleware that records HTTP request metrics via OTel
 * and attaches the request-id to the active span.
 * Place BEFORE routes in the middleware chain.
 */
export function requestMetricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = performance.now();
  httpActiveRequests.add(1);

  // Attach request-id to the active OTel span (created by HttpInstrumentation)
  const span = trace.getActiveSpan();
  if (span && req.requestId) {
    span.setAttribute('http.request_id', req.requestId);
  }

  res.on('finish', () => {
    const duration = performance.now() - start;
    const route = req.route?.path ?? req.path;
    const attrs = {
      'http.method': req.method,
      'http.route': route,
      'http.status_code': res.statusCode,
    };

    httpRequestDuration.record(duration, attrs);
    httpRequestTotal.add(1, attrs);
    httpActiveRequests.add(-1);
  });

  next();
}
