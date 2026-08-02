// ────────────────────────────────────────────────────────────────
// rateLimit — SEC-07
//
// Per-API-key + global request budgets. We deliberately avoid an external
// dependency (`express-rate-limit` + a SQLite store adapter) and implement
// a minimal fixed-window counter in-memory. Trade-offs:
//   - Pro: zero new deps, easy to reason about, drops state on restart
//     (which is fine — protection is best-effort, not a billing system).
//   - Pro: per-replica limits. In a multi-replica deployment, the global
//     cap becomes per-replica. If cross-replica budgeting is needed later,
//     swap the Map for a Redis / SQLite backend without changing callers.
//   - Con: fixed windows (no sliding / token-bucket) so burst at window
//     boundaries is possible. Acceptable for a DoS-prevention layer —
//     upstream abuse is blocked long before any specific burst matters.
//
// Exempt paths (`/api/health`, `/webhooks/*`) are bypassed at `createAuthMiddleware`
// boundary; rate limit is mounted AFTER auth so unauthenticated traffic is
// already a 401 before it reaches here. This makes per-API-key the obvious
// bucket key: authenticated users with different keys are isolated.
// ────────────────────────────────────────────────────────────────

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { ILogger } from '@generatorai/shared';
import * as crypto from 'node:crypto';

export interface RateLimitOptions {
  /** Per-API-key budget: requests per window. Default 60. */
  perKeyLimit?: number;
  /** Global (all keys combined) budget per window. Default 600. */
  globalLimit?: number;
  /** Window size in milliseconds. Default 60_000 (1 minute). */
  windowMs?: number;
  /** Logger for rejection events. Optional. */
  logger?: ILogger;
}

interface Bucket {
  count: number;
  windowStart: number;
}

/** Hash an API key for log/metric identifiers (don't log the raw key). */
function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 12);
}

/**
 * Extract the rate-limit bucket key from the request. Preference order:
 *   1. `req.principal` — the resolved device / service account. This is the
 *      real identity, and unlike a raw token it is stable across the short
 *      access-token rotations a DPoP client performs.
 *   2. `Authorization: <scheme> <token>` — pre-auth fallback (the limiter also
 *      runs in front of routes that fail authentication).
 *   3. `req.ip`.
 *
 * Raw credentials are only ever hashed, never used verbatim as a key.
 */
function extractKey(req: Request): string {
  const principal = req.principal;
  if (principal) {
    return principal.deviceId ? `dev:${principal.deviceId}` : `pri:${principal.type}:${principal.id}`;
  }
  const auth = req.headers['authorization'];
  if (typeof auth === 'string') {
    const space = auth.indexOf(' ');
    if (space > 0) return hashKey(auth.slice(space + 1));
  }
  return `ip:${req.ip ?? 'unknown'}`;
}

export function createRateLimitMiddleware(opts: RateLimitOptions = {}): RequestHandler {
  const perKeyLimit = opts.perKeyLimit ?? 60;
  const globalLimit = opts.globalLimit ?? 600;
  const windowMs = opts.windowMs ?? 60_000;
  const logger = opts.logger;

  const perKeyBuckets = new Map<string, Bucket>();
  const globalBucket: Bucket = { count: 0, windowStart: Date.now() };

  function advanceWindow(b: Bucket, now: number): void {
    if (now - b.windowStart >= windowMs) {
      b.count = 0;
      b.windowStart = now;
    }
  }

  function remainingMs(b: Bucket, now: number): number {
    return Math.max(0, windowMs - (now - b.windowStart));
  }

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();

    // Global bucket
    advanceWindow(globalBucket, now);
    if (globalBucket.count >= globalLimit) {
      const retryAfter = Math.ceil(remainingMs(globalBucket, now) / 1000);
      res.status(429)
        .setHeader('Retry-After', String(retryAfter))
        .json({
          error: {
            code: 'RATE_LIMIT_GLOBAL',
            message: `Global request budget (${globalLimit}/min) exceeded`,
            retryAfterSeconds: retryAfter,
          },
        });
      logger?.warn?.('[RateLimit] global budget exceeded', { current: globalBucket.count });
      return;
    }

    // Per-key bucket
    const key = extractKey(req);
    let bucket = perKeyBuckets.get(key);
    if (!bucket) {
      bucket = { count: 0, windowStart: now };
      perKeyBuckets.set(key, bucket);
    }
    advanceWindow(bucket, now);
    if (bucket.count >= perKeyLimit) {
      const retryAfter = Math.ceil(remainingMs(bucket, now) / 1000);
      res.status(429)
        .setHeader('Retry-After', String(retryAfter))
        .json({
          error: {
            code: 'RATE_LIMIT_KEY',
            message: `Per-key request budget (${perKeyLimit}/min) exceeded`,
            retryAfterSeconds: retryAfter,
          },
        });
      logger?.warn?.('[RateLimit] per-key budget exceeded', { key, current: bucket.count });
      return;
    }

    bucket.count += 1;
    globalBucket.count += 1;

    // Rate-limit headers for well-behaved clients.
    res.setHeader('X-RateLimit-Limit', String(perKeyLimit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, perKeyLimit - bucket.count)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil((bucket.windowStart + windowMs) / 1000)));

    next();

    // Opportunistic GC of stale buckets — scan a few per request, bounded.
    if (perKeyBuckets.size > 1024) {
      let scanned = 0;
      for (const [k, b] of perKeyBuckets) {
        if (now - b.windowStart > windowMs * 2) perKeyBuckets.delete(k);
        if (++scanned > 32) break;
      }
    }
  };
}
