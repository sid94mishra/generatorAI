// ────────────────────────────────────────────────────────────────
// Request ID Middleware — assigns or propagates x-request-id
// ────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

/**
 * Reads `x-request-id` from incoming headers or generates a `randomUUID`.
 * Attaches it to `req.requestId` and sets `x-request-id` response header.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  const requestId = typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  next();
}
