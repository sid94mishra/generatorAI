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
// Backpressure (W05/W06, was STR-05): see `streaming/sseConnection.ts`. The
// event's class decides — deltas are dropped while the socket is congested and
// the loss is announced in a `gap` frame; items are queued and never dropped,
// and a consumer that cannot drain even those is disconnected with a reason.
//
// STR-04 web sseManager rewrite is done; legacy per-scope routes
// (`/api/workflow-runs/:id/stream` etc.) still exist for backward compat
// but the web SPA now uses this unified endpoint exclusively.
// ──────────────────────────────────────────────────────────

import { Router, type Request, type Response } from 'express';
import type { Container } from '../composition-root.js';
import type { StreamEventRow, StreamScope } from '@generatorai/core';
import { canMintDerivedCredentials, type Principal, type Scope } from '@generatorai/auth';
import { acquireSseSlot } from '../composition/sseConnectionCap.js';
import { SseConnection, parseCursor } from '../streaming/sseConnection.js';
import { MuxSseConnection } from '../streaming/muxConnection.js';
import {
  EPHEMERAL_SCOPES,
  hasEphemeralProducer,
  isEphemeralScope,
  subscribeEphemeral,
} from '../streaming/ephemeralScopes.js';
import {
  MAX_SUBS_PER_CONNECTION,
  attachConnection,
  createConnection,
  destroyConnection,
  getConnection,
  scopeKeyOf,
  type MuxSub,
} from '../streaming/streamConnectionRegistry.js';

const VALID_SCOPES = new Set<StreamScope>(['session', 'run', 'chat', 'global', 'automation', 'workspace']);

/**
 * Ticket scope for a multiplexed connection (N-12).
 *
 * The ticket authorises the CONNECTION, not a subscription — every sub is
 * authorised individually when it is added, so a connection can never be used
 * to widen access.
 */
const CONNECTION_TICKET_SCOPE = 'connection';

/** Identity a connection cap is counted against. */
function principalKeyOf(principal: Principal): string {
  return `${principal.type}:${principal.id}`;
}

/**
 * Parse and validate one `{scope, id}` pair from a request body.
 *
 * Accepts the ephemeral scopes too — only the multiplexed endpoint calls this,
 * and a live-only feed on the shared connection is the whole reason the
 * computer preview no longer needs a socket of its own (P1-11, D-7).
 */
function parseSub(raw: unknown): MuxSub | { error: string } {
  if (typeof raw !== 'object' || raw === null) return { error: 'subscription must be an object' };
  const rec = raw as Record<string, unknown>;
  const scope = String(rec['scope'] ?? '');
  const durable = VALID_SCOPES.has(scope as StreamScope);
  if (!durable && !isEphemeralScope(scope)) {
    return {
      error: `scope must be one of ${[...VALID_SCOPES, ...EPHEMERAL_SCOPES].join(', ')}`,
    };
  }
  const id = scope === 'global' ? 'all' : String(rec['id'] ?? '');
  if (!id || id.length > 200) return { error: '`id` is required and must be at most 200 chars' };

  let filter: readonly string[] | undefined;
  if (rec['filter'] !== undefined) {
    if (!Array.isArray(rec['filter'])) return { error: '`filter` must be an array of prefixes' };
    const parts = (rec['filter'] as unknown[])
      .map((p) => String(p).trim())
      .filter((p) => p.length > 0 && p.length <= 64);
    if (parts.length > MAX_FILTER_PREFIXES) {
      return { error: `filter accepts at most ${MAX_FILTER_PREFIXES} prefixes` };
    }
    if (parts.length > 0) filter = parts;
  }

  return { scope: scope as MuxSub['scope'], id, ...(filter ? { filter } : {}) };
}

/** Ticket scopes redeemable by a WebSocket upgrade rather than SSE. */
const SOCKET_TICKET_SCOPES = new Set<string>(['terminal', 'browser', 'stt', 'tts']);

/** The API scope a caller must already hold to mint each socket ticket. */
const SOCKET_TICKET_SCOPE_REQUIREMENTS: Record<string, Scope | undefined> = {
  terminal: 'exec:terminal',
  browser: 'exec:browser',
  stt: 'write:chats',
  // Reading a message aloud carries the same authority as reading that
  // chat — the mirror image of stt's write:chats (speech input becomes a
  // chat message).
  tts: 'read:chats',
};

/** Max kind prefixes accepted in `?filter=` (STR-06). */
const MAX_FILTER_PREFIXES = 10;

/** Max rows returned by `/api/stream/replay?limit=`. */
const MAX_REPLAY_LIMIT = 500;

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
        scope === 'global' ? 'all' : scope === 'stt' || scope === 'tts' ? null : providedId;
      if (scope !== 'global' && scope !== 'stt' && scope !== 'tts' && !scopeId) {
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
   * POST /api/stream/connections
   *
   * Opens a multiplexed connection (W09-a, §5.9). Returns a connection id and
   * a CONNECTION-bound ticket; the client then does
   * `GET /api/stream?c=<id>&ticket=<t>`.
   *
   * The two-call shape exists because SSE is a bodyless GET and the resume
   * vector is a **map**, not the single integer `Last-Event-ID` can carry
   * (N-9). Sending it as a body is the only way to resume many scopes at once.
   */
  router.post('/connections', (req, res) => {
    void (async () => {
      const principal = req.principal;
      if (!principal) {
        res.status(401).json({
          error: { code: 'MISSING_CREDENTIAL', message: 'Authentication is required.' },
        });
        return;
      }
      if (!canMintDerivedCredentials(principal)) {
        res.status(403).json({
          error: {
            code: 'TICKET_CHAINING_FORBIDDEN',
            message: 'A stream ticket or signed link cannot be used to mint another ticket.',
          },
        });
        return;
      }

      const rawSubs = req.body?.subs;
      if (!Array.isArray(rawSubs) || rawSubs.length === 0) {
        res.status(400).json({
          error: { code: 'MISSING_SUBS', message: '`subs` must be a non-empty array' },
        });
        return;
      }
      const subs: MuxSub[] = [];
      for (const raw of rawSubs) {
        const parsed = parseSub(raw);
        if ('error' in parsed) {
          res.status(400).json({ error: { code: 'INVALID_SUB', message: parsed.error } });
          return;
        }
        subs.push(parsed);
      }

      const cursors = new Map<string, number>();
      const rawCursors = req.body?.cursors;
      if (rawCursors && typeof rawCursors === 'object') {
        for (const [key, value] of Object.entries(rawCursors as Record<string, unknown>)) {
          const seq = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
          if (!Number.isSafeInteger(seq) || seq < 0) {
            res.status(400).json({
              error: {
                code: 'INVALID_RESUME',
                message: `cursor for ${key} must be a non-negative integer`,
              },
            });
            return;
          }
          cursors.set(key, seq);
        }
      }

      const created = createConnection(principalKeyOf(principal), subs, cursors);
      if (!created.ok) {
        res.status(created.code === 'CONNECTION_CAP_EXCEEDED' ? 429 : 400)
          .setHeader('Retry-After', '5')
          .json({
            error: {
              code: created.code,
              message:
                created.code === 'CONNECTION_CAP_EXCEEDED'
                  ? `Max ${created.cap} multiplexed stream connections per principal; ${created.current} open.`
                  : `Max ${created.cap} subscriptions per connection (got ${created.current}).`,
            },
          });
        return;
      }

      const { ticket, expiresAt } = await container.security.auth.issueStreamTicket({
        principal,
        scope: CONNECTION_TICKET_SCOPE,
        scopeId: created.record.id,
      });
      res.set('Cache-Control', 'no-store').status(201).json({
        connectionId: created.record.id,
        ticket,
        expiresAt,
        maxSubscriptions: MAX_SUBS_PER_CONNECTION,
      });
    })();
  });

  /**
   * POST /api/stream/connections/:id/subs
   *
   * Add or remove subscriptions **without reconnecting** (§5.9.2 ④). Opening
   * a second chat must not cost the connection its position in every other
   * scope. Answers 202; the authoritative result arrives as a `subs` frame on
   * the stream itself, so the client's view of its own subscriptions is
   * server-confirmed rather than assumed.
   */
  router.post('/connections/:id/subs', (req, res) => {
    const principal = req.principal;
    if (!principal) {
      res.status(401).json({
        error: { code: 'MISSING_CREDENTIAL', message: 'Authentication is required.' },
      });
      return;
    }
    const record = getConnection(String(req.params['id'] ?? ''));
    // Same answer for "not found" and "not yours": otherwise this is an
    // oracle for which connection ids exist.
    if (!record || record.principalKey !== principalKeyOf(principal)) {
      res.status(404).json({
        error: { code: 'CONNECTION_NOT_FOUND', message: 'No such stream connection.' },
      });
      return;
    }

    const add: MuxSub[] = [];
    for (const raw of Array.isArray(req.body?.add) ? req.body.add : []) {
      const parsed = parseSub(raw);
      if ('error' in parsed) {
        res.status(400).json({ error: { code: 'INVALID_SUB', message: parsed.error } });
        return;
      }
      add.push(parsed);
    }
    const remove: string[] = (Array.isArray(req.body?.remove) ? req.body.remove : [])
      .map((k: unknown) => String(k))
      .filter((k: string) => k.length > 0);

    if (!record.onMutate) {
      res.status(409).json({
        error: {
          code: 'CONNECTION_NOT_ATTACHED',
          message: 'Open GET /api/stream?c=<id> before mutating subscriptions.',
        },
      });
      return;
    }
    // 202 now, `subs` frame later — the mutation involves replay and must not
    // hold the control-plane request open behind it (§5.9.2 ③).
    void record.onMutate(add, remove);
    res.status(202).json({ accepted: true });
  });

  /**
   * GET /api/stream
   * The new unified SSE endpoint. STR-03 / STR-05 / STR-06 / STR-08.
   */
  router.get('/', async (req, res) => {
    // W09-a — `?c=` selects the multiplexed connection created by
    // `POST /connections`. Everything below it is the single-scope endpoint,
    // which stays for the CLI, `curl` and any client that has not moved.
    const connectionId = typeof req.query['c'] === 'string' ? req.query['c'] : '';
    if (connectionId) {
      await handleMultiplexed(req, res, connectionId);
      return;
    }

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

    // STR-08 / W08 — resume semantics. Accepts the `Last-Event-ID` header
    // (set automatically by the browser's EventSource on reconnect) or an
    // explicit `?afterSeq=` for callers that cannot set headers.
    //
    // The header carries `<spaceId>:<seq>`, where the space id identifies THIS
    // DATABASE's sequence space. `stream_sequences` persists across restarts
    // and is never reset, so a cursor from before a restart is still valid; a
    // mismatch means the numbers genuinely changed underneath the client (a
    // restored backup, a wiped dev database) and it must re-snapshot.
    const lastEventIdHeader = req.headers['last-event-id'];
    const cursorRaw =
      typeof lastEventIdHeader === 'string' && lastEventIdHeader.length > 0
        ? lastEventIdHeader
        : typeof req.query['afterSeq'] === 'string'
          ? String(req.query['afterSeq'])
          : undefined;

    const spaceId = await streamBroker.streamSpaceId();
    const cursor = parseCursor(cursorRaw, spaceId);
    if (cursor.invalid) {
      res.status(400).json({
        error: {
          code: 'INVALID_RESUME',
          message: 'afterSeq / Last-Event-ID must be a non-negative integer, optionally prefixed with a stream space id',
        },
      });
      return;
    }
    const afterSeq = cursor.afterSeq;

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

    const conn = new SseConnection(res, spaceId, (reason) => {
      logger.warn?.('[UnifiedStream] shed a client that could not keep up', {
        requestId: req.requestId,
        scope,
        scopeId,
        reason,
      });
    });

    // ── 4. Cleanup, registered BEFORE the first await ──
    //
    // `subscribe` below awaits an `oldestSeq` query, a 200-row replay, and the
    // handler for every replayed row. A client that aborts inside that window
    // — navigation, React StrictMode's double effect, a flaky mobile link —
    // fires 'close' once and Node does not replay it. Registering afterwards
    // meant the slot and the broker subscription were held for the process's
    // lifetime, and six such aborts answered that chat with 503 forever.
    let unsubscribe: (() => void) | null = null;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let released = false;
    const cleanup = (): void => {
      if (released) return;
      released = true;
      if (heartbeat) clearInterval(heartbeat);
      const { droppedDeltas, shed } = conn.stats;
      conn.close();
      // Guarded: `subscribe` may not have resolved yet, in which case the
      // `catch` below owns the teardown.
      unsubscribe?.();
      slot.release();
      if (droppedDeltas > 0) {
        logger.info('[UnifiedStream] client disconnected after dropped deltas', {
          requestId: req.requestId,
          scope,
          scopeId,
          droppedDeltas,
          shed,
        });
      }
    };
    res.on('close', cleanup);

    // Initial comment flush — bypasses some proxies that buffer until first write.
    conn.writeComment(`connected scope=${scope} id=${scopeId}`);

    logger.info('[UnifiedStream] client connected', {
      requestId: req.requestId,
      scope,
      scopeId,
      afterSeq,
      filter: kindPrefixes,
    });

    // ── 5. Subscribe to broker with replay + real-time ──
    // Frame data carries `{kind, payload}` so the client can route via a
    // single `onmessage` handler. The encoding is memoised per event, so K
    // subscribers on one scope cost one `JSON.stringify`, not K (P1-10).
    // W06 — propagate `deliver()`'s return value. It is a pending promise only
    // when an item had to be queued; the broker awaits it, which is how a
    // congested connection actually slows its session's producer rather than
    // only bounding memory.
    const deliver = (row: StreamEventRow): void | Promise<void> => conn.deliver(row);

    try {
      const handle = await streamBroker.subscribe(scope, scopeId, deliver, {
        afterSeq,
        syncReplayLimit: 200, // STR-06: within broker's hard ceiling
        kindPrefixes,
        // `hello` goes out BEFORE any replayed event. A client that learns its
        // resume failed only afterwards has already rendered those events into
        // a hole it does not know about.
        onResume: (status) => {
          conn.writeControl('hello', {
            spaceId,
            scope,
            scopeId,
            resumed: status.resumed && !cursor.foreign,
            ...(cursor.foreign
              ? { reason: 'space_changed' }
              : status.reason
                ? { reason: status.reason }
                : {}),
            oldestSeq: status.oldestSeq,
            deliveredUpTo: status.deliveredUpTo,
          });
        },
      });
      // The client may already have gone while we were replaying. `cleanup`
      // has then run with `unsubscribe` still null, so detach here instead.
      if (released) {
        handle();
        return;
      }
      unsubscribe = handle;
    } catch (err) {
      logger.error?.(
        `[UnifiedStream] subscribe failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      try { res.end(); } catch { /* ignore */ }
      cleanup();
      return;
    }

    // ── 6. Heartbeat — prevents upstream proxies from treating silent
    //     streams as dead. Uses the SSE comment syntax (`: ...`) so clients
    //     don't receive spurious event messages.
    heartbeat = setInterval(() => {
      if (conn.isClosed) {
        clearInterval(heartbeat);
        return;
      }
      conn.writeComment(`heartbeat ${Date.now()}`);
    }, heartbeatMs);
    if (typeof heartbeat.unref === 'function') heartbeat.unref();
  });

  /**
   * The multiplexed stream (W09-a, §5.9).
   *
   * One socket, many scopes. Three things make that safe, and all three are
   * here rather than in `MuxSseConnection`, because they are protocol rather
   * than transport:
   *
   *  - **Resume is a map.** Every frame carries its own `q`, and the client
   *    POSTs the whole cursor map on reconnect. `hello.resumed` answers
   *    **per scope**, so a scope whose cursor fell outside retention
   *    re-snapshots *alone* (N-9).
   *  - **A rejected subscription never fails the connection** (Law L7). It
   *    comes back in `hello.rejected` / `subs.rejected` with a reason.
   *  - **`hello` precedes every replayed event.** Each sub replays inside its
   *    own `subscribe()`, so delivery is held until the whole set is known —
   *    otherwise the first scope's history would arrive before the client
   *    learned the last scope's resume had failed.
   */
  async function handleMultiplexed(
    req: Request,
    res: Response,
    connectionId: string,
  ): Promise<void> {
    const principal = req.principal;
    if (!principal) {
      res.status(401).json({
        error: { code: 'MISSING_CREDENTIAL', message: 'Authentication is required.' },
      });
      return;
    }

    // Ownership is checked BEFORE the record is claimed. Claiming first would
    // let anyone who guessed an id burn the owner's single attach.
    const existing = getConnection(connectionId);
    if (!existing || existing.principalKey !== principalKeyOf(principal)) {
      res.status(404).json({
        error: { code: 'CONNECTION_NOT_FOUND', message: 'No such stream connection.' },
      });
      return;
    }
    const record = attachConnection(connectionId);
    if (!record) {
      res.status(409).json({
        error: {
          code: 'CONNECTION_ALREADY_ATTACHED',
          message: 'This connection already has a stream attached.',
        },
      });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const conn = new MuxSseConnection(res, (reason) => {
      logger.warn?.('[MuxStream] shed a client that could not keep up', {
        requestId: req.requestId,
        connectionId,
        reason,
      });
    });

    /** scopeKey → teardown (broker unsubscribe + per-(scope,id) slot). */
    const active = new Map<string, () => void>();
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let released = false;
    const cleanup = (): void => {
      if (released) return;
      released = true;
      if (heartbeat) clearInterval(heartbeat);
      conn.close();
      for (const detach of active.values()) detach();
      active.clear();
      record.onMutate = null;
      destroyConnection(connectionId);
    };
    // Registered before the first await: `subscribe` replays, and a client
    // that aborts inside that window fires 'close' exactly once.
    res.on('close', cleanup);

    conn.writeComment(`connected c=${connectionId}`);

    let helloSent = false;
    const pending: Array<{ scopeKey: string; row: StreamEventRow; cls?: 'delta' | 'item' }> = [];
    const deliverTo =
      (scopeKey: string) =>
      (row: StreamEventRow, cls?: 'delta' | 'item'): void | Promise<void> => {
        if (helloSent) {
          // W06 — propagated so the broker's fan-out can await real queue
          // capacity instead of only ever seeing a bounded-but-unbacked-off
          // in-memory queue. See `routes/stream.ts`'s single-scope `deliver`.
          return conn.deliver(scopeKey, row, cls);
        }
        pending.push({ scopeKey, row, ...(cls ? { cls } : {}) });
        return undefined;
      };

    type Rejection = { s: string; reason: string };

    /**
     * Attach a live-only scope (§ `ephemeralScopes.ts`).
     *
     * `seq` and `id` are 0 by deliberate construction, and the client's own
     * code is what makes that meaningful: it skips dedup when `e` is 0 and
     * records no cursor when `q` is 0. Both are correct here — an ephemeral
     * scope fans out to nobody, so there is nothing to deduplicate, and it
     * persists nothing, so there is nothing to resume.
     */
    const addEphemeralSub = (sub: MuxSub, rejected: Rejection[]): boolean => {
      const scopeKey = scopeKeyOf(sub.scope, sub.id);
      if (!hasEphemeralProducer(sub.scope)) {
        rejected.push({ s: scopeKey, reason: 'scope_unavailable' });
        return false;
      }
      const slot = acquireSseSlot(sub.scope, sub.id);
      if (!slot.ok) {
        rejected.push({ s: scopeKey, reason: 'scope_cap_exceeded' });
        return false;
      }
      const deliver = deliverTo(scopeKey);
      try {
        const detach = subscribeEphemeral(
          sub.scope as 'computer',
          sub.id,
          (event) => {
            deliver(
              {
                scope: sub.scope as StreamScope,
                scopeId: sub.id,
                kind: event.kind,
                payload: event.payload,
                seq: 0,
                id: 0,
                ts: Date.now(),
              } as StreamEventRow,
              event.cls,
            );
          },
          logger,
        );
        active.set(scopeKey, () => {
          detach();
          slot.release();
        });
        record.subs.set(scopeKey, sub);
        return true;
      } catch (err) {
        slot.release();
        rejected.push({ s: scopeKey, reason: 'subscribe_failed' });
        logger.error?.(
          `[MuxStream] ephemeral subscribe failed for ${scopeKey}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return false;
      }
    };

    const addSub = async (
      sub: MuxSub,
      resumed: Record<string, boolean>,
      rejected: Rejection[],
    ): Promise<void> => {
      const scopeKey = scopeKeyOf(sub.scope, sub.id);
      if (active.has(scopeKey)) return;
      if (active.size >= MAX_SUBS_PER_CONNECTION) {
        rejected.push({ s: scopeKey, reason: 'subscription_cap_exceeded' });
        return;
      }
      if (isEphemeralScope(sub.scope)) {
        addEphemeralSub(sub, rejected);
        return;
      }
      // The per-(scope, id) fan-out guard still applies — N-11 adds a
      // per-principal cap, it does not replace this one.
      const slot = acquireSseSlot(sub.scope, sub.id);
      if (!slot.ok) {
        rejected.push({ s: scopeKey, reason: 'scope_cap_exceeded' });
        return;
      }
      const cursor = record.cursors.get(scopeKey);
      try {
        const unsubscribe = await streamBroker.subscribe(
          sub.scope,
          sub.id,
          deliverTo(scopeKey),
          {
            ...(cursor === undefined ? {} : { afterSeq: cursor }),
            ...(sub.filter ? { kindPrefixes: sub.filter } : {}),
            syncReplayLimit: 200,
            onResume: (status) => {
              resumed[scopeKey] = status.resumed;
            },
          },
        );
        if (released) {
          unsubscribe();
          slot.release();
          return;
        }
        active.set(scopeKey, () => {
          unsubscribe();
          slot.release();
        });
        record.subs.set(scopeKey, sub);
      } catch (err) {
        slot.release();
        rejected.push({ s: scopeKey, reason: 'subscribe_failed' });
        logger.error?.(
          `[MuxStream] subscribe failed for ${scopeKey}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    };

    const initialResumed: Record<string, boolean> = {};
    const initialRejected: Rejection[] = [];
    for (const sub of [...record.subs.values()]) {
      if (released) return;
      await addSub(sub, initialResumed, initialRejected);
    }
    if (released) return;

    logger.info('[MuxStream] client connected', {
      requestId: req.requestId,
      connectionId,
      subs: active.size,
      rejected: initialRejected.length,
    });

    conn.writeControl('hello', {
      connectionId,
      active: [...active.keys()],
      resumed: initialResumed,
      ...(initialRejected.length > 0 ? { rejected: initialRejected } : {}),
    });
    helloSent = true;
    for (const held of pending.splice(0)) conn.deliver(held.scopeKey, held.row, held.cls);

    // Mutations are serialised: two overlapping POSTs would otherwise
    // interleave their subscribes and emit two `subs` frames that each
    // describe a set that never existed.
    let mutations: Promise<void> = Promise.resolve();
    record.onMutate = (add, remove) => {
      mutations = mutations.then(async () => {
        if (released) return;
        const resumed: Record<string, boolean> = {};
        const rejected: Rejection[] = [];
        for (const scopeKey of remove) {
          const detach = active.get(scopeKey);
          if (!detach) continue;
          detach();
          active.delete(scopeKey);
          record.subs.delete(scopeKey);
          record.cursors.delete(scopeKey);
          conn.forgetScope(scopeKey);
        }
        for (const sub of add) {
          if (released) return;
          await addSub(sub, resumed, rejected);
        }
        if (released) return;
        conn.writeControl('subs', {
          active: [...active.keys()],
          resumed,
          rejected,
        });
      });
      return mutations;
    };

    heartbeat = setInterval(() => {
      if (conn.isClosed) {
        clearInterval(heartbeat);
        return;
      }
      conn.writeComment(`heartbeat ${Date.now()}`);
    }, heartbeatMs);
    if (typeof heartbeat.unref === 'function') heartbeat.unref();
  }

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
