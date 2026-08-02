// ────────────────────────────────────────────────────────────────
// Unified /api/stream endpoint — STR-03
//
// Query params:
//   - scope  : 'session' | 'run' | 'chat' | 'global' (required)
//   - id     : string (required for non-global scopes)
//   - filter : comma-separated kind prefixes, max 10 (STR-06)
//
// Headers:
//   - Last-Event-ID : <seq> — resume from this seq (STR-08)
//
// Companion REST replay endpoint (`GET /api/stream/replay`) for late
// reconnects that fall outside the durable retention window.
//
// Backpressure (STR-05): per-connection write queue bounded at
// BACKPRESSURE_MAX. Slow consumers past the high-water mark receive a
// final `slow_consumer_dropped` frame and get disconnected so a single
// wedged client cannot OOM the server.
//
// STR-04 web sseManager rewrite is done; legacy per-scope routes
// (`/api/workflow-runs/:id/stream` etc.) still exist for backward compat
// but the web SPA now uses this unified endpoint exclusively.
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import type { Response } from 'express';
import type { Container } from '../composition-root.js';
import type { StreamEventRow, StreamScope } from '@generatorai/core';
import { canMintDerivedCredentials, type Scope } from '@generatorai/auth';
import { acquireSseSlot } from '../composition/sseConnectionCap.js';

const VALID_SCOPES = new Set<StreamScope>(['session', 'run', 'chat', 'global', 'automation']);

/** Ticket scopes redeemable by a WebSocket upgrade rather than SSE. */
const SOCKET_TICKET_SCOPES = new Set<string>(['terminal', 'browser', 'stt']);

/** The API scope a caller must already hold to mint each socket ticket. */
const SOCKET_TICKET_SCOPE_REQUIREMENTS: Record<string, Scope | undefined> = {
  terminal: 'exec:terminal',
  browser: 'exec:browser',
  stt: 'write:chats',
};

/** Max kind prefixes accepted in `?filter=` (STR-06). */
const MAX_FILTER_PREFIXES = 10;

/** Max rows returned by `/api/stream/replay?limit=`. */
const MAX_REPLAY_LIMIT = 500;

/**
 * STR-05 — per-connection outbound queue. `res.write` returns false when the
 * kernel send buffer is full; we pause publishes until `drain` fires. If
 * the queue grows past HIGH_WATER while waiting, the consumer is too slow
 * and we disconnect with a final `slow_consumer_dropped` event so the
 * client can distinguish this from a network error.
 */
const BACKPRESSURE_HIGH_WATER = 256;

/** Parse `?filter=a,b,c` with defensive caps. */
function parseFilter(raw: unknown): readonly string[] | undefined {
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  const parts = raw
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && p.length <= 64);
  if (parts.length === 0) return undefined;
  if (parts.length > MAX_FILTER_PREFIXES) {
    throw new StreamParamError(
      `filter accepts at most ${MAX_FILTER_PREFIXES} prefixes (got ${parts.length})`,
    );
  }
  return parts;
}

class StreamParamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StreamParamError';
  }
}

/**
 * Write an SSE frame with backpressure accounting.
 *
 * STR-04 — we deliberately do NOT emit an `event:` field. All frames fire
 * the client's `onmessage` handler; the `kind` is carried inside the
 * JSON payload instead. This avoids the EventSource limitation where
 * different `event:` types need separate `addEventListener` calls — our
 * web client handles ~60 kinds through a single switch and a wildcard
 * `addEventListener` does not exist in the browser API.
 */
function writeFrame(
  res: Response,
  state: { queued: number; dropped: boolean; drainWaiters: Array<() => void> },
  id: number,
  data: string,
): boolean {
  if (state.dropped || res.writableEnded) return false;

  const payload = `id: ${id}\ndata: ${data}\n\n`;
  const flushed = res.write(payload);
  if (flushed) return true;

  // STR-05 — the kernel buffer is full. Count the outstanding write so we
  // can detect runaway backpressure; register a one-shot 'drain' listener
  // that wakes any publish waiting for room.
  state.queued += 1;
  if (state.queued > BACKPRESSURE_HIGH_WATER) {
    state.dropped = true;
    const finalFrame = `event: slow_consumer_dropped\ndata: {"reason":"queue-exceeded","highWater":${BACKPRESSURE_HIGH_WATER}}\n\n`;
    try { res.write(finalFrame); } catch { /* best effort */ }
    try { res.end(); } catch { /* best effort */ }
    return false;
  }

  return true;
}

export function createUnifiedStreamRoutes(container: Container): Router {
  const router = Router();
  const { streamBroker, logger, config } = container;
  const heartbeatMs = config.streaming.heartbeatIntervalMs;

  /**
   * POST /api/stream/tickets
   *
   * Mints a 30-second, single-use, scope-bound ticket for `EventSource`.
   *
   * This is the replacement for the old `?apiKey=<long-lived-key>` query
   * fallback: browsers cannot attach headers to an `EventSource`, and a
   * reusable credential in a URL leaks through access logs, referrers,
   * browser history and traces. A ticket that dies in 30 seconds and can only
   * be redeemed once has almost no value if it leaks.
   *
   * Requires a real (DPoP or service-account) credential — the ticket
   * inherits the caller's scopes and cannot widen them.
   */
  router.post('/tickets', (req, res) => {
    void (async () => {
      const principal = req.principal;
      if (!principal) {
        res.status(401).json({
          error: { code: 'MISSING_CREDENTIAL', message: 'Authentication is required.' },
        });
        return;
      }
      // A ticket must not be mintable *by* a ticket, otherwise a leaked ticket
      // could be laundered into an endless chain of fresh ones.
      if (!canMintDerivedCredentials(principal)) {
        res.status(403).json({
          error: {
            code: 'TICKET_CHAINING_FORBIDDEN',
            message: 'A stream ticket or signed link cannot be used to mint another ticket.',
          },
        });
        return;
      }

      // WebSocket streams (terminal / browser / stt) redeem tickets through
      // the same table, so they are valid ticket scopes even though they are
      // not SSE `StreamScope`s.
      const scope = String(req.body?.scope ?? req.query['scope'] ?? '');
      const isSseScope = VALID_SCOPES.has(scope as StreamScope);
      const isSocketScope = SOCKET_TICKET_SCOPES.has(scope);
      if (!isSseScope && !isSocketScope) {
        res.status(400).json({
          error: {
            code: 'INVALID_SCOPE',
            message: `scope must be one of ${[...VALID_SCOPES, ...SOCKET_TICKET_SCOPES].join(', ')}`,
          },
        });
        return;
      }
      const rawId = req.body?.id ?? req.query['id'];
      const providedId = typeof rawId === 'string' && rawId.length > 0 ? rawId : null;
      const scopeId =
        scope === 'global' ? 'all' : scope === 'stt' ? null : providedId;
      if (scope !== 'global' && scope !== 'stt' && !scopeId) {
        res.status(400).json({
          error: { code: 'MISSING_ID', message: '`id` is required for this scope' },
        });
        return;
      }

      // A terminal/browser ticket must not be obtainable by a principal that
      // lacks the execution scope the socket itself will demand — otherwise
      // the ticket becomes a scope-laundering primitive.
      const requiredScope = SOCKET_TICKET_SCOPE_REQUIREMENTS[scope];
      if (requiredScope && !principal.scopes.includes(requiredScope)) {
        res.status(403).json({
          error: {
            code: 'INSUFFICIENT_SCOPE',
            message: `Minting a "${scope}" ticket requires the ${requiredScope} scope.`,
            requiredScopes: [requiredScope],
          },
        });
        return;
      }

      const { ticket, expiresAt } = await container.security.auth.issueStreamTicket({
        principal,
        scope,
        scopeId,
      });
      // `Cache-Control: no-store` so the ticket never lands in a shared cache.
      res.set('Cache-Control', 'no-store').status(201).json({ ticket, expiresAt });
    })();
  });

  /**
   * GET /api/stream
   * The new unified SSE endpoint. STR-03 / STR-05 / STR-06 / STR-08.
   */
  router.get('/', async (req, res) => {
    // ── 1. Validate query params ──
    const scope = String(req.query['scope'] ?? '') as StreamScope;
    if (!VALID_SCOPES.has(scope)) {
      res.status(400).json({
        error: {
          code: 'INVALID_SCOPE',
          message: `scope must be one of ${[...VALID_SCOPES].join(', ')}`,
        },
      });
      return;
    }

    const scopeId = scope === 'global'
      ? 'all'
      : (typeof req.query['id'] === 'string' ? String(req.query['id']) : '');
    if (!scopeId) {
      res.status(400).json({
        error: { code: 'MISSING_ID', message: 'query param `id` is required for non-global scopes' },
      });
      return;
    }

    let kindPrefixes: readonly string[] | undefined;
    try {
      kindPrefixes = parseFilter(req.query['filter']);
    } catch (err) {
      if (err instanceof StreamParamError) {
        res.status(400).json({ error: { code: 'INVALID_FILTER', message: err.message } });
        return;
      }
      throw err;
    }

    // STR-08 — Last-Event-ID resume semantics. Accepts either the header
    // (set automatically by the browser's EventSource on reconnect) OR an
    // explicit `?afterSeq=` query param for callers that can't set headers.
    const lastEventIdHeader = req.headers['last-event-id'];
    const afterSeqRaw =
      typeof lastEventIdHeader === 'string' && lastEventIdHeader.length > 0
        ? lastEventIdHeader
        : typeof req.query['afterSeq'] === 'string'
          ? String(req.query['afterSeq'])
          : undefined;
    let afterSeq: number | undefined;
    if (afterSeqRaw !== undefined) {
      const parsed = parseInt(afterSeqRaw, 10);
      if (!Number.isFinite(parsed) || parsed < 0) {
        res.status(400).json({
          error: { code: 'INVALID_RESUME', message: 'afterSeq / Last-Event-ID must be a non-negative integer' },
        });
        return;
      }
      afterSeq = parsed;
    }

    // ── 2. Enforce per-(scope, id) connection cap (SEC-04) ──
    const slot = acquireSseSlot(scope, scopeId);
    if (!slot.ok) {
      res.status(503)
        .setHeader('Retry-After', '30')
        .json({
          error: {
            code: 'SSE_CAP_EXCEEDED',
            message: `Max ${slot.cap} concurrent SSE connections for ${scope}:${scopeId}; currently ${slot.current} open.`,
          },
        });
      return;
    }

    // ── 3. Open the SSE connection ──
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const bpState = { queued: 0, dropped: false, drainWaiters: [] as Array<() => void> };

    const onDrain = (): void => {
      bpState.queued = 0;
      const waiters = bpState.drainWaiters.splice(0, bpState.drainWaiters.length);
      for (const w of waiters) w();
    };
    res.on('drain', onDrain);

    // Initial comment flush — bypasses some proxies that buffer until first write.
    try { res.write(`: connected scope=${scope} id=${scopeId}\n\n`); } catch { /* ignore */ }

    logger.info('[UnifiedStream] client connected', {
      requestId: req.requestId,
      scope,
      scopeId,
      afterSeq,
      filter: kindPrefixes,
    });

    // ── 4. Subscribe to broker with replay + real-time ──
    // Frame data carries `{kind, payload}` so the client can route via a
    // single `onmessage` handler — see writeFrame() for rationale.
    const deliver = (row: StreamEventRow): void => {
      const frame = JSON.stringify({ kind: row.kind, payload: row.payload ?? null });
      writeFrame(res, bpState, row.seq, frame);
    };

    let unsubscribe: (() => void) | null = null;
    try {
      unsubscribe = await streamBroker.subscribe(scope, scopeId, deliver, {
        afterSeq,
        syncReplayLimit: 200, // STR-06: within broker's hard ceiling
        kindPrefixes,
      });
    } catch (err) {
      logger.error?.(
        `[UnifiedStream] subscribe failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      try { res.end(); } catch { /* ignore */ }
      slot.release();
      return;
    }

    // ── 5. Heartbeat — prevents upstream proxies from treating silent
    //     streams as dead. Uses the SSE comment syntax (`: ...`) so clients
    //     don't receive spurious event messages.
    const heartbeat = setInterval(() => {
      if (bpState.dropped || res.writableEnded) {
        clearInterval(heartbeat);
        return;
      }
      try {
        res.write(`: heartbeat ${Date.now()}\n\n`);
      } catch {
        clearInterval(heartbeat);
      }
    }, heartbeatMs);
    if (typeof heartbeat.unref === 'function') heartbeat.unref();

    // ── 6. Cleanup on disconnect ──
    res.on('close', () => {
      clearInterval(heartbeat);
      res.off('drain', onDrain);
      bpState.drainWaiters.length = 0;
      unsubscribe?.();
      slot.release();
    });
  });

  /**
   * GET /api/stream/replay?scope=<s>&id=<id>&afterSeq=<n>&limit=<n>
   * REST pagination companion. Use when replay exceeds the SSE sync cap
   * (STR-06) — client calls this with the last seq it saw and continues
   * paginating until `rows.length < limit`.
   */
  router.get('/replay', async (req, res, next) => {
    try {
      const scope = String(req.query['scope'] ?? '') as StreamScope;
      if (!VALID_SCOPES.has(scope)) {
        res.status(400).json({ error: { code: 'INVALID_SCOPE', message: 'scope required' } });
        return;
      }
      const scopeId = scope === 'global'
        ? 'all'
        : (typeof req.query['id'] === 'string' ? String(req.query['id']) : '');
      if (!scopeId) {
        res.status(400).json({ error: { code: 'MISSING_ID', message: 'id required' } });
        return;
      }
      const afterSeq = parseInt(String(req.query['afterSeq'] ?? '0'), 10);
      if (!Number.isFinite(afterSeq) || afterSeq < 0) {
        res.status(400).json({ error: { code: 'INVALID_AFTER_SEQ', message: 'afterSeq must be non-negative' } });
        return;
      }
      const limit = Math.max(
        1,
        Math.min(parseInt(String(req.query['limit'] ?? '100'), 10) || 100, MAX_REPLAY_LIMIT),
      );
      const rows = await streamBroker.replay(scope, scopeId, afterSeq, limit);
      res.json({ rows, nextAfterSeq: rows.length > 0 ? rows[rows.length - 1]!.seq : afterSeq });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
