// ────────────────────────────────────────────────────────────────
// MuxStreamClient — one shared connection multiplexing every subscribed
// scope, instead of one HTTP/SSE connection per `scope:id` pair.
//
// This is a Node-native port of `apps/web/src/platform/muxStream.ts`'s
// design (§5.9 / W09-a) against the SAME real server protocol that file
// already talks to (`POST /api/stream/connections`, `POST
// /api/stream/connections/:id/subs`, `GET /api/stream?c=<connectionId>`) —
// confirmed live server-side in `apps/server/src/routes/stream.ts`. The CLI
// was never migrated to it; `stream.ts`'s own comment on the single-scope
// endpoint says so explicitly: "Everything below it is the single-scope
// endpoint, which stays for the CLI, curl and any client that has not
// moved." This is that move.
//
// Ported, not reinvented, because the browser version already solved four
// real defects the hard way (see its header comment) and this keeps every
// one of those fixes:
//   - resume: a client-owned cursor MAP (not a single Last-Event-ID —
//     sequence spaces are per scope on a shared socket), POSTed on connect.
//   - duplicates: one event can fan out to more than one scope (a chat
//     event also publishes to its session), so dedup keys on the server's
//     global per-event row id, not on (scope, sequence).
//   - reconciliation, not sequencing: `hello`/`subs` report the server's
//     authoritative active set; a mutation lost to a reconnect self-heals
//     on the next frame instead of the two sides silently disagreeing.
//   - filter unions: the server holds one subscription (and one filter) per
//     scope per connection; two local subscribers with different filters on
//     the same scope both get the union from the server and re-narrow
//     locally on arrival.
//
// Deliberately NOT a module-level singleton like the browser version (whose
// header comment notes it needs its own `resetMuxStreamForTests()` escape
// hatch for exactly this reason) — a Node process can reasonably construct
// more than one client (multiple CLI sessions, or multiple TUI mounts in one
// test worker, which this repo has hit real MaxListenersExceededWarning
// issues from before). An instance per `createCliClient()` call is the
// correct unit of sharing here, not the module.
//
// Also does not use the ticket the POST returns: browsers need it because
// `EventSource` cannot send custom headers, but this client's `fetch` is the
// same authenticated one every other request uses (DPoP or legacy Bearer),
// and the server's `GET /api/stream?c=` handler accepts either a ticket OR
// the normal `req.principal` from that same auth (see `handleMultiplexed` in
// `apps/server/src/routes/stream.ts`) — so plain header auth just works.
// ────────────────────────────────────────────────────────────────

import { SseParser } from './sseParser.js';
import { Backoff } from '@generatorai/client-transport';

export interface MuxStreamEvent {
  kind: string;
  data: Record<string, unknown>;
  sequence?: number;
}

export interface MuxSubscribeOptions {
  /** Seeds this scope's resume cursor if the client has not already seen one for it (e.g. from a snapshot fetch's own last-sequence). Ignored once a live cursor exists. */
  afterSequence?: number;
  /** Kind-prefix allowlist. Unioned server-side across every local subscriber of the same scope; each handler re-filters on arrival. */
  filter?: string[];
  onConnected?: () => void;
  /** The shared connection itself is retrying — every active scope gets this, not just one. */
  onReconnecting?: (attempt: number) => void;
  /**
   * This scope stopped receiving updates. Two distinct causes are folded
   * into one callback (matching `StreamPort`'s existing shape, which has no
   * separate "needs a fresh snapshot" signal): a scope-local `gap` frame
   * (the server could not honour this scope's cursor — this client clears
   * it, so the NEXT subscribe starts cold; the caller should re-fetch a
   * snapshot) and a scope the server keeps rejecting outright, which stops
   * being retried at all. The reason string always starts with `gap:` for
   * the first case.
   */
  onDisconnected?: (reason?: string) => void;
}

export interface MuxStreamClientOptions {
  /**
   * Resolves a bare path like `/api/stream/connections` against the right
   * endpoint and attaches auth — the same authenticated `fetch` every other
   * CLI request already goes through (`runtime.fetch` in
   * `createCliClient.ts`), not a raw one. Every path passed to it here is
   * relative for exactly that reason.
   */
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
  /**
   * Opens the long-lived `GET /api/stream?c=…` attach, when the platform's
   * authenticated `fetch` cannot serve it.
   *
   * React Native is that platform: its global `fetch` is XHR-backed and gives
   * no `response.body`, so the read loop below has nothing to read. Only
   * `expo/fetch` streams — and `expo/fetch` is not the DPoP-signing fetch, so
   * the attach is authorised the way the browser authorises it instead: with
   * the single-use, connection-bound ticket the POST returned. The server's
   * `handleMultiplexed` accepts either that ticket or the ordinary principal
   * (`apps/server/src/routes/stream.ts`), which is what makes both shapes
   * work against one endpoint.
   *
   * Receives an ABSOLUTE url — the caller resolving it is what lets it come
   * from a platform whose fetch has no notion of a base endpoint.
   */
  streamFetch?: (url: string, init: RequestInit) => Promise<Response>;
  /**
   * Base origin for `streamFetch`'s absolute url. Required with `streamFetch`,
   * ignored without it.
   */
  endpoint?: string;
  /** Torn down when this fires — matches every other CLI subscription's lifetime. */
  signal?: AbortSignal;
}

interface ScopeEntry {
  scope: string;
  id: string;
  handlers: Map<
    (event: MuxStreamEvent) => void,
    { filter?: string[]; options: MuxSubscribeOptions }
  >;
}

/** A scope the server keeps refusing is not retried forever — matches the browser client's constant. */
const MAX_REJECTIONS_PER_SCOPE = 3;

/** One scope the server has refused, as reported by `rejectedScopes()`. */
export interface RejectedScope {
  scope: string;
  id: string;
  /** The `onDisconnected` reason the scope's handlers were given. */
  reason: string;
}

/**
 * The scope(s) a `403 INSUFFICIENT_SCOPE` body names, or `null` when it names
 * none this client can identify.
 *
 * The server answers `POST /api/stream/connections` and `/subs` with a 403
 * for the FIRST subscription the principal may not read, and refuses the
 * whole request — so a client that treats every non-OK status as a
 * connection failure retries the same payload into the same answer until it
 * gives up, and every OTHER scope on the connection (the ones it was allowed)
 * never connects either. This is how a paired phone without `admin:settings`
 * got no live events at all: its `global` sub sank the connection carrying
 * its chat feeds.
 *
 * Prefers the body's `sub: {scope, id}` (which the server now sends) and
 * falls back to the scope name quoted in the message, so an older server is
 * still handled.
 */
export function parseInsufficientScope(
  body: unknown,
): { scope: string; id?: string; requiredScope: string } | null {
  if (!body || typeof body !== 'object') return null;
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return null;
  const rec = error as Record<string, unknown>;
  if (rec['code'] !== 'INSUFFICIENT_SCOPE') return null;
  const required = Array.isArray(rec['requiredScopes'])
    ? (rec['requiredScopes'] as unknown[]).map(String).filter((s) => s.length > 0)
    : [];
  const requiredScope = required[0] ?? 'unknown';

  const sub = rec['sub'];
  if (sub && typeof sub === 'object') {
    const scope = String((sub as Record<string, unknown>)['scope'] ?? '');
    const rawId = (sub as Record<string, unknown>)['id'];
    if (scope) return { scope, ...(typeof rawId === 'string' && rawId ? { id: rawId } : {}), requiredScope };
  }
  const message = typeof rec['message'] === 'string' ? rec['message'] : '';
  const quoted = /"([^"]+)"\s+stream/.exec(message);
  if (quoted?.[1]) return { scope: quoted[1], requiredScope };
  return null;
}

/** Cross-scope dedup window. Items are rare, so this is generous relative to real traffic. */
const SEEN_HIGH_WATER = 4000;
const SEEN_RETAIN = 2000;

function scopeKey(scope: string, id: string): string {
  return `${scope}:${id}`;
}

function filterUnion(entry: ScopeEntry): string[] | undefined {
  const all: string[] = [];
  for (const { filter } of entry.handlers.values()) {
    if (filter === undefined || filter.length === 0) return undefined;
    all.push(...filter);
  }
  return all.length > 0 ? [...new Set(all)].sort() : undefined;
}

function sameFilter(a: string[] | undefined, b: string[] | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.length === b.length && a.every((p, i) => p === b[i]);
}

function matchesFilter(filter: string[] | undefined, kind: unknown): boolean {
  if (filter === undefined || filter.length === 0) return true;
  const k = typeof kind === 'string' ? kind : '';
  return filter.some((prefix) => k.startsWith(prefix));
}

export class MuxStreamClient {
  private readonly scopes = new Map<string, ScopeEntry>();
  private readonly cursors = new Map<string, number>();
  private readonly sentFilters = new Map<string, string[] | undefined>();
  private readonly seenEventIds = new Set<number>();
  private readonly rejections = new Map<string, number>();
  /** scopeKey → why it was given up on; populated the moment `rejections` hits the ceiling. */
  private readonly rejectionReasons = new Map<string, string>();
  private maxSeenEventId = 0;

  private connectionId: string | null = null;
  /**
   * The connection-bound ticket the POST returned, used only by the
   * `streamFetch` attach path. Header-authenticated attaches ignore it, and it
   * is single-use, so it is cleared with the connection it belongs to.
   */
  private connectionTicket: string | null = null;
  private activeScopes = new Set<string>();
  private connecting = false;
  private openScheduled = false;
  private reconciling = false;
  private reconcilePending = false;
  private closed = false;
  private readonly backoff = new Backoff({ baseMs: 1000, maxMs: 30_000, factor: 1.5 });
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Aborts the current GET /api/stream?c=... read loop, if one is open. */
  private connectionAbort: AbortController | null = null;

  constructor(private readonly options: MuxStreamClientOptions) {
    options.signal?.addEventListener('abort', () => this.disposeAll(), { once: true });
  }

  /**
   * Subscribe one scope to the shared connection. Structurally compatible
   * with `StreamPort['subscribe']` (`packages/cli-core/src/context/CliContext.ts`)
   * — cli-core assigns an instance of this class directly as its `stream`.
   */
  subscribe(
    scope: string,
    id: string,
    handler: (event: MuxStreamEvent) => void,
    options: MuxSubscribeOptions = {},
  ): () => void {
    if (this.closed) {
      // A late subscribe racing a concurrent `disposeAll()` (e.g. the
      // companion server tearing a connection down while `StreamReconciler`
      // is mid-`reconcile()`) is a real, reachable timing window — throwing
      // synchronously here would surface as an uncaught exception in a
      // caller that has no reason to wrap this call in try/catch. A no-op
      // disposer is the honest answer: there is nothing left to subscribe
      // to, but the caller asking is not itself a bug.
      console.error('[MuxStreamClient] subscribe() called after disposeAll() — ignoring.');
      return () => {};
    }
    const key = scopeKey(scope, id);
    let entry = this.scopes.get(key);
    if (!entry) {
      entry = { scope, id, handlers: new Map() };
      this.scopes.set(key, entry);
    }
    entry.handlers.set(handler, { filter: options.filter, options });

    if (options.afterSequence !== undefined && !this.cursors.has(key)) {
      this.cursors.set(key, options.afterSequence);
    }

    if (this.connectionId) {
      if (
        this.activeScopes.has(key) &&
        sameFilter(this.sentFilters.get(key), filterUnion(entry))
      ) {
        options.onConnected?.();
      } else {
        void this.reconcile();
      }
    } else {
      this.scheduleOpen();
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const current = this.scopes.get(key);
      if (!current) return;
      current.handlers.delete(handler);
      if (current.handlers.size > 0) {
        // Narrowing the union is not worth a resubscribe — survivors filter
        // locally anyway, and a round trip would cost them their cursor.
        return;
      }
      this.scopes.delete(key);
      this.cursors.delete(key);
      this.rejections.delete(key);
      this.rejectionReasons.delete(key);
      this.sentFilters.delete(key);
      if (this.scopes.size === 0) this.teardown();
      else void this.reconcile();
    };
  }

  /** Tears the whole connection down; every handler's `onDisconnected` fires once. */
  disposeAll(): void {
    if (this.closed) return;
    this.closed = true;
    for (const key of this.scopes.keys()) this.forEachHandler(key, (o) => o.onDisconnected?.('disposed'));
    this.scopes.clear();
    this.cursors.clear();
    this.sentFilters.clear();
    this.rejections.clear();
    this.rejectionReasons.clear();
    this.teardown();
  }

  /**
   * Scopes this client has stopped asking for, and why.
   *
   * A scope lands here either because the server refused it in a `hello` /
   * `subs` frame `MAX_REJECTIONS_PER_SCOPE` times, or because a 403 named it
   * as the subscription the principal may not read (reason
   * `rejected:insufficient_scope:<requiredScope>`). Still-subscribed only:
   * a scope whose last local subscriber left is forgotten entirely.
   */
  rejectedScopes(): RejectedScope[] {
    const out: RejectedScope[] = [];
    for (const [key, entry] of this.scopes) {
      if ((this.rejections.get(key) ?? 0) < MAX_REJECTIONS_PER_SCOPE) continue;
      out.push({ scope: entry.scope, id: entry.id, reason: this.rejectionReasons.get(key) ?? 'rejected' });
    }
    return out;
  }

  /**
   * Forget every rejection and ask for those scopes again.
   *
   * For after the device's grants change — a user who has just been granted
   * `read:activity` should not have to restart the app to get the global
   * feed its handlers are still waiting on. Reconciles onto the live
   * connection when there is one, else opens one.
   */
  resetRejections(): void {
    if (this.closed) return;
    const had = this.rejections.size > 0;
    this.rejections.clear();
    this.rejectionReasons.clear();
    if (!had) return;
    if (this.connectionId) void this.reconcile();
    else this.scheduleOpen();
  }

  /**
   * Mark the scope(s) a `403 INSUFFICIENT_SCOPE` body named as rejected, so
   * `wanted()` leaves them out of the very next request, and tell their
   * handlers ONCE. Returns how many scope entries were newly marked; zero
   * means the body named nothing this client is subscribed to, in which case
   * the caller falls back to treating the response as an ordinary failure.
   *
   * `global` is matched on scope alone: the server addresses it by the fixed
   * id `all` whatever the client sent.
   */
  private applyInsufficientScope(body: unknown): number {
    const refused = parseInsufficientScope(body);
    if (!refused) return 0;
    let marked = 0;
    for (const [key, entry] of this.scopes) {
      if (entry.scope !== refused.scope) continue;
      if (refused.id !== undefined && refused.scope !== 'global' && entry.id !== refused.id) continue;
      if ((this.rejections.get(key) ?? 0) >= MAX_REJECTIONS_PER_SCOPE) continue; // already told
      this.rejections.set(key, MAX_REJECTIONS_PER_SCOPE);
      const reason = `rejected:insufficient_scope:${refused.requiredScope}`;
      this.rejectionReasons.set(key, reason);
      this.forEachHandler(key, (o) => o.onDisconnected?.(reason));
      marked += 1;
    }
    return marked;
  }

  /** Read a JSON error body without letting a non-JSON one throw. */
  private static async errorBody(res: Response): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }

  // ── Internals — ported from apps/web/src/platform/muxStream.ts ──────────

  private forEachHandler(key: string, fn: (o: MuxSubscribeOptions) => void): void {
    const entry = this.scopes.get(key);
    if (!entry) return;
    for (const { options } of [...entry.handlers.values()]) {
      try {
        fn(options);
      } catch (error) {
        // Same isolation as `handleDataFrame` — a broken `onConnected`/
        // `onReconnecting`/`onDisconnected` callback must not stop every
        // OTHER scope's callbacks in the same loop, let alone crash the
        // connection's own control-frame handling.
        console.error('[MuxStreamClient] a subscriber callback threw; other subscribers are unaffected:', error);
      }
    }
  }

  /** Scopes we still want and are still allowed to ask for. */
  private wanted(): string[] {
    return [...this.scopes.keys()].filter((k) => (this.rejections.get(k) ?? 0) < MAX_REJECTIONS_PER_SCOPE);
  }

  private subPayload(entry: ScopeEntry): { scope: string; id: string; filter?: string[] } {
    const filter = filterUnion(entry);
    return { scope: entry.scope, id: entry.id, ...(filter ? { filter } : {}) };
  }

  private applyActiveSet(frame: Record<string, unknown>): void {
    const previous = this.activeScopes;
    this.activeScopes = new Set(
      Array.isArray(frame['active']) ? (frame['active'] as unknown[]).map(String) : [],
    );
    this.noteRejections(frame['rejected']);

    const resumed = (frame['resumed'] ?? {}) as Record<string, unknown>;
    for (const key of this.activeScopes) {
      if (!previous.has(key)) {
        this.rejections.delete(key);
        this.rejectionReasons.delete(key);
        this.forEachHandler(key, (o) => o.onConnected?.());
      }
      if (Object.prototype.hasOwnProperty.call(resumed, key) && resumed[key] !== true) {
        // The cursor named a position the server could not honour. Keeping
        // it would fail the same way on the next reconnect.
        this.cursors.delete(key);
        this.forEachHandler(key, (o) => o.onDisconnected?.('gap:not_resumed'));
      }
    }
  }

  private noteRejections(raw: unknown): void {
    if (!Array.isArray(raw)) return;
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const key = String((item as Record<string, unknown>)['s'] ?? '');
      if (!key) continue;
      const next = (this.rejections.get(key) ?? 0) + 1;
      this.rejections.set(key, next);
      if (next >= MAX_REJECTIONS_PER_SCOPE) {
        const reason = `rejected:${String((item as Record<string, unknown>)['reason'] ?? 'rejected')}`;
        this.rejectionReasons.set(key, reason);
        this.forEachHandler(key, (o) => o.onDisconnected?.(reason));
      }
    }
  }

  /**
   * Resume positions for scopes being added to the open connection: one a
   * subscriber seeded with `afterSequence`, or one re-added to change its
   * filter. Without them the server starts each at the live edge.
   */
  private cursorsFor(subs: ReadonlyArray<{ scope: string; id: string }>): Record<string, number> {
    const out: Record<string, number> = {};
    for (const sub of subs) {
      const key = scopeKey(sub.scope, sub.id);
      const seq = this.cursors.get(key);
      if (seq !== undefined) out[key] = seq;
    }
    return out;
  }

  private async reconcile(): Promise<void> {
    if (!this.connectionId) return;
    if (this.reconciling) {
      this.reconcilePending = true;
      return;
    }
    const want = new Set(this.wanted());

    // A scope whose filter union changed has to be dropped and re-added: the
    // server holds one subscription per scope with prefixes fixed at
    // subscribe time, so a widened union would otherwise never deliver the
    // kinds the new subscriber joined for.
    const refilter = [...want].filter(
      (k) =>
        this.activeScopes.has(k) &&
        !sameFilter(this.sentFilters.get(k), filterUnion(this.scopes.get(k) as ScopeEntry)),
    );

    const add = [...want]
      .filter((k) => !this.activeScopes.has(k) || refilter.includes(k))
      .map((k) => this.scopes.get(k))
      .filter((e): e is ScopeEntry => e !== undefined)
      .map((e) => this.subPayload(e));
    const remove = [...new Set([...this.activeScopes].filter((k) => !want.has(k)).concat(refilter))];
    if (add.length === 0 && remove.length === 0) return;

    this.reconciling = true;
    const target = this.connectionId;
    try {
      const res = await this.options.fetch(`/api/stream/connections/${target}/subs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ add, remove, cursors: this.cursorsFor(add) }),
      });
      if (res.status === 403) {
        // The server refuses the WHOLE mutation when one added sub is out of
        // scope, so nothing in `add` landed. Drop the refused scope and run
        // again for the rest — the connection itself is fine, and tearing it
        // down would cost every other scope its position for nothing.
        if (this.applyInsufficientScope(await MuxStreamClient.errorBody(res)) > 0) {
          this.reconcilePending = true;
          return;
        }
      }
      if (!res.ok) {
        // The connection is gone server-side (restart, reap, cap). Reopening
        // is the only way back, and it carries the cursor map so nothing is
        // lost.
        this.teardown();
        this.scheduleOpen();
        return;
      }
      for (const sub of add) this.sentFilters.set(scopeKey(sub.scope, sub.id), sub.filter);
    } catch {
      this.teardown();
      this.scheduleOpen();
    } finally {
      this.reconciling = false;
      if (this.reconcilePending) {
        this.reconcilePending = false;
        void this.reconcile();
      }
    }
  }

  private teardown(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.connectionAbort?.abort();
    this.connectionAbort = null;
    this.connectionId = null;
    // Single-use and bound to the connection that just died. Replaying it on
    // the next attach fails with an opaque 401.
    this.connectionTicket = null;
    this.activeScopes = new Set();
    this.sentFilters.clear();
  }

  /** A permanently unreachable server must eventually stop being retried — matches the single-scope implementation this replaced, which gave up after 20 attempts. Without this a process pointed at a dead endpoint retries forever at up to 30s intervals instead of ever reaching a terminal state a caller could act on. */
  private static readonly MAX_RECONNECT_ATTEMPTS = 20;

  private scheduleRetry(): void {
    if (this.retryTimer || this.scopes.size === 0 || this.closed) return;
    const attempt = this.backoff.attempts + 1;
    if (attempt > MuxStreamClient.MAX_RECONNECT_ATTEMPTS) {
      for (const key of this.scopes.keys()) {
        this.forEachHandler(key, (o) => o.onDisconnected?.(`giving up after ${MuxStreamClient.MAX_RECONNECT_ATTEMPTS} attempts`));
      }
      return;
    }
    for (const key of this.scopes.keys()) this.forEachHandler(key, (o) => o.onReconnecting?.(attempt));
    const delay = this.backoff.next();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, delay);
  }

  /**
   * Coalesce a burst of subscriptions into one connection — several panes
   * opening in the same tick must not each open (and immediately have to
   * mutate) their own connection.
   */
  private scheduleOpen(): void {
    if (this.openScheduled || this.connecting || this.connectionId || this.closed) return;
    this.openScheduled = true;
    queueMicrotask(() => {
      this.openScheduled = false;
      void this.connect();
    });
  }

  private async connect(): Promise<void> {
    if (this.connecting || this.connectionId || this.closed) return;
    const subs = this.wanted()
      .map((k) => this.scopes.get(k))
      .filter((e): e is ScopeEntry => e !== undefined)
      .map((e) => this.subPayload(e));
    if (subs.length === 0) return;

    // Set when a 403 named one scope: the rest deserve an immediate retry,
    // not a backoff step — the server was up and answered, the payload was
    // simply wrong. Acted on in `finally`, after `connecting` clears.
    let retryWithoutRejected = false;
    this.connecting = true;
    try {
      const cursorMap: Record<string, number> = {};
      for (const [key, seq] of this.cursors) {
        if (this.scopes.has(key)) cursorMap[key] = seq;
      }

      const res = await this.options.fetch(`/api/stream/connections`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subs, cursors: cursorMap }),
      });
      if (res.status === 403) {
        // One out-of-scope sub sinks the whole POST. Identify it, stop asking
        // for it, and go again with what is left — silently retrying the same
        // payload is how a phone missing one scope lost ALL its live events.
        if (this.applyInsufficientScope(await MuxStreamClient.errorBody(res)) > 0) {
          retryWithoutRejected = true;
          return;
        }
      }
      if (!res.ok) {
        for (const key of this.scopes.keys()) this.forEachHandler(key, (o) => o.onDisconnected?.(`http:${res.status}`));
        this.scheduleRetry();
        return;
      }
      const body = (await res.json()) as { connectionId?: string; ticket?: string };
      if (!body.connectionId) {
        this.scheduleRetry();
        return;
      }
      this.connectionTicket = body.ticket ?? null;
      if (this.scopes.size === 0 || this.closed) {
        // Everything unsubscribed while the POST was in flight — the server
        // already created a connection record for it that nothing will ever
        // attach to. Rather than leave that in an untested "created, never
        // attached" state (unknown server-side TTL/reaping for it), attach
        // and immediately abort — the server's ordinary "client attached,
        // then disappeared" disconnect path is one it already has to
        // handle correctly for every real reconnect and app-close case.
        //
        // The abort has to be triggered HERE, not left for `readLoop` to
        // resolve on its own — it never does that by itself (nothing inside
        // it self-terminates), so a `.then()` chained after it would simply
        // never run, leaving this GET connection open for the rest of the
        // process's life. Supplying our own controller and aborting it
        // right after starting the fetch is what actually closes it.
        const abort = new AbortController();
        void this.readLoop(body.connectionId, abort);
        abort.abort();
        return;
      }

      this.connectionId = body.connectionId;
      // NOT `this.backoff.reset()` — see `handleFrame`'s `hello` case.
      // A successful POST is a connection RECORD, not a stream: the body the
      // frames arrive on is the separate `GET /api/stream?c=` below, and a
      // server that can mint the record but not serve the stream (a proxy that
      // buffers text/event-stream, a rejected attach ticket, a restart caught
      // mid-flight) is precisely the state the backoff exists for. Resetting
      // here pins the attempt counter at zero for exactly that failure, which
      // both flattens every retry to `baseMs` and puts MAX_RECONNECT_ATTEMPTS
      // permanently out of reach — an unbounded ~1/s reconnect storm against a
      // server that is already unwell.
      for (const sub of subs) this.sentFilters.set(scopeKey(sub.scope, sub.id), sub.filter);

      void this.readLoop(body.connectionId);
    } catch {
      for (const key of this.scopes.keys()) this.forEachHandler(key, (o) => o.onDisconnected?.('network'));
      this.scheduleRetry();
    } finally {
      this.connecting = false;
      // `connect()` itself returns early when nothing is wanted any more, so
      // "everything was rejected" stops here without a further request.
      if (retryWithoutRejected) this.scheduleOpen();
    }
  }

  /**
   * Opens `GET /api/stream?c=<id>` and parses the multiplexed frames off its
   * body until it ends or is aborted.
   *
   * `abort`, when the caller supplies one, is whose signal actually attaches
   * the connection — letting `connect()`'s "nothing wants this anymore"
   * branch abort it deterministically right after starting the fetch,
   * instead of the loop only ever ending on its own (it does not: nothing
   * INSIDE this function ever aborts itself, so without an externally
   * triggered abort the read loop — and the open connection behind it —
   * would simply run forever).
   */
  private async readLoop(connectionId: string, abort: AbortController = new AbortController()): Promise<void> {
    this.connectionAbort = abort;
    try {
      const response = await this.attach(connectionId, abort);
      if (!response.ok || !response.body) {
        throw new Error(`Mux stream attach failed: ${response.status}`);
      }

      const parser = new SseParser();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const message of parser.push(decoder.decode(value, { stream: true }))) {
          this.handleFrame(message.event, message.data);
        }
      }
      // A clean end-of-body is still a disconnect — the server closed it.
      if (this.connectionAbort === abort && !this.closed) {
        this.teardown();
        this.scheduleRetry();
      }
    } catch {
      if (abort.signal.aborted) return; // intentional teardown, not a failure
      if (this.connectionAbort === abort && !this.closed) {
        this.teardown();
        this.scheduleRetry();
      }
    }
  }

  /**
   * Open the attach GET, by whichever route this platform can stream over.
   *
   * See `MuxStreamClientOptions.streamFetch` for why there are two.
   */
  private attach(connectionId: string, abort: AbortController): Promise<Response> {
    const query = `c=${encodeURIComponent(connectionId)}`;
    const init: RequestInit = { headers: { accept: 'text/event-stream' }, signal: abort.signal };
    const streamFetch = this.options.streamFetch;
    if (!streamFetch) return this.options.fetch(`/api/stream?${query}`, init);

    const base = (this.options.endpoint ?? '').replace(/\/$/, '');
    const ticket = this.connectionTicket
      ? `&ticket=${encodeURIComponent(this.connectionTicket)}`
      : '';
    return streamFetch(`${base}/api/stream?${query}${ticket}`, init);
  }

  private handleFrame(event: string, data: string): void {
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }

    switch (event) {
      case 'hello':
        // The ONLY place the backoff is cleared. `hello` is written by the
        // server onto the attached response body before any replayed event
        // (`apps/server/src/routes/stream.ts`), so receiving it is proof that
        // a stream genuinely exists end to end — which is the only event that
        // should count as "the last attempt worked".
        this.backoff.reset();
        if (typeof frame['connectionId'] === 'string') this.connectionId = frame['connectionId'];
        this.applyActiveSet(frame);
        void this.reconcile();
        return;
      case 'subs':
        this.applyActiveSet(frame);
        void this.reconcile();
        return;
      case 'gap': {
        // Scope-local and never fatal to the connection (§5.9.4 in the
        // browser reference) — only this one scope needs a fresh snapshot.
        const key = String(frame['s'] ?? '');
        if (!key) return;
        this.cursors.delete(key);
        this.forEachHandler(key, (o) => o.onDisconnected?.(`gap:${String(frame['reason'] ?? 'gap')}`));
        return;
      }
      case 'slow_consumer_dropped':
        for (const key of this.scopes.keys()) this.forEachHandler(key, (o) => o.onDisconnected?.('slow_consumer_dropped'));
        return;
      default:
        this.handleDataFrame(frame);
    }
  }

  private handleDataFrame(frame: Record<string, unknown>): void {
    if (typeof frame['s'] !== 'string') return;
    const key = frame['s'];

    // Cross-scope dedup: one server-side event can fan out to more than one
    // scope (a chat event also publishes to its session), and this client
    // may be subscribed to both — without this it would render twice.
    const eventId = typeof frame['e'] === 'number' ? frame['e'] : 0;
    if (eventId > 0) {
      if (this.seenEventIds.has(eventId)) return;
      this.seenEventIds.add(eventId);
      if (eventId > this.maxSeenEventId) this.maxSeenEventId = eventId;
      if (this.seenEventIds.size > SEEN_HIGH_WATER) {
        const floor = this.maxSeenEventId - SEEN_RETAIN;
        for (const id of this.seenEventIds) if (id < floor) this.seenEventIds.delete(id);
      }
    }

    const sequence = typeof frame['q'] === 'number' ? frame['q'] : undefined;
    if (sequence !== undefined && sequence > 0) this.cursors.set(key, sequence);

    const entry = this.scopes.get(key);
    if (!entry) return;
    const kind = frame['k'];
    const payload = (frame['p'] ?? {}) as Record<string, unknown>;
    // Each handler re-applies its own prefixes: the server was sent the
    // UNION of every local subscriber's filter, so a subscriber that asked
    // for a narrow prefix would otherwise also receive a co-resident
    // subscriber's wider one.
    for (const [handler, { filter }] of [...entry.handlers]) {
      if (!matchesFilter(filter, kind)) continue;
      try {
        handler({ kind: typeof kind === 'string' ? kind : String(kind), data: payload, ...(sequence !== undefined ? { sequence } : {}) });
      } catch (error) {
        // A bug in ONE pane's own event handler must not take down the
        // shared connection for every other pane/scope riding on it —
        // this loop runs inside `readLoop()`'s read loop, and an uncaught
        // throw here would otherwise propagate to its catch, which tears
        // the whole connection down and reconnects for everyone. The
        // deleted `SharedStreamPort` this replaces isolated handlers the
        // same way, for the same reason.
        console.error('[MuxStreamClient] a subscriber handler threw; other subscribers are unaffected:', error);
      }
    }
  }
}
