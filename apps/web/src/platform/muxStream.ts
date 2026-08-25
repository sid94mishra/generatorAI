// ────────────────────────────────────────────────────────────────
// muxStream — W09-a (§5.9), client half.
//
// One `EventSource` for the whole tab instead of one per scope.
//
// The header of `sseManager.ts` argues against exactly this, on two premises
// that have both decayed: "only 1-2 EventSources per tab" (it is five with the
// right pane open) and "the old watchdog is gone" (it is still there, and
// per-scope connections multiplied the number of things that can silently
// stall from one to five).
//
// Four things had to be solved before it was safe, and each maps to a defect:
//
//  - **N-9 resume.** Sequence spaces are per scope, so `Last-Event-ID` — one
//    integer — is meaningless on a shared socket. The client owns a cursor
//    *map* and POSTs the whole thing; `hello.resumed` answers per scope.
//  - **N-10 duplicates.** One harness event is published to `chat:<id>` AND
//    `session:<id>`, and `sseManager` routes by `payload.sessionId`, not by
//    the connection's scope — so on a shared socket it would render twice.
//    Dedup keys on `e`, the global `stream_cursors` row id, which is stable
//    across every scope an event fans out to.
//  - **N-11 caps.** The server bounds connections per principal now; this
//    side simply stops opening five of them.
//  - **N-12 tickets.** One ticket authorises the connection; every
//    subscription is authorised individually as it is added.
//
// Subscription state is reconciled, not sequenced. `hello` and `subs` report
// the server's authoritative active set and this module POSTs the difference,
// so a mutation lost to a reconnect heals on the next frame instead of
// leaving the two sides silently disagreeing about what is subscribed.
// ────────────────────────────────────────────────────────────────

import { getAuthRuntime } from './authRuntime.js';

export interface MuxFrameEvent {
  /** The per-scope sequence, in the shape `parseFrame` already expects. */
  readonly lastEventId: string;
  /** `{"kind":…,"payload":…}` — the single-scope frame body, rebuilt. */
  readonly data: string;
}

export interface MuxHandlers {
  onMessage?: (event: MuxFrameEvent) => void;
  onOpen?: () => void;
  onError?: (source: EventSource | null) => void;
  /** This scope has a hole; only a replay can close it. See `authTransport`. */
  onResync?: (reason: string) => void;
}

/**
 * Kind-prefix allowlist for one subscriber, as `?filter=` on the single-scope
 * endpoint. Omitted means everything.
 *
 * Two views routinely watch the same scope wanting different prefixes — a chat
 * page wants `browser.session_created` while the browser panel wants all of
 * `browser.`. One socket can only hold one subscription per scope, so the union
 * goes to the server and each handler narrows again on arrival. Sending the
 * union rather than nothing still saves the bytes that matter: everything
 * outside it never leaves the server.
 */
export type MuxFilter = readonly string[] | undefined;

interface ScopeEntry {
  readonly scope: string;
  readonly id: string;
  readonly handlers: Map<MuxHandlers, MuxFilter>;
}

/** Union of a scope's filters, or undefined when any subscriber wants everything. */
function filterUnion(entry: ScopeEntry): MuxFilter {
  const all: string[] = [];
  for (const filter of entry.handlers.values()) {
    if (filter === undefined || filter.length === 0) return undefined;
    all.push(...filter);
  }
  return all.length > 0 ? [...new Set(all)].sort() : undefined;
}

function sameFilter(a: MuxFilter, b: MuxFilter): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.length === b.length && a.every((p, i) => p === b[i]);
}

function matchesFilter(filter: MuxFilter, kind: unknown): boolean {
  if (filter === undefined || filter.length === 0) return true;
  const k = typeof kind === 'string' ? kind : '';
  return filter.some((prefix) => k.startsWith(prefix));
}

/** Cross-scope dedup window. Items are rare, so this is ~30s of deltas. */
const SEEN_HIGH_WATER = 4000;
const SEEN_RETAIN = 2000;

/** A scope the server keeps refusing is not retried forever. */
const MAX_REJECTIONS_PER_SCOPE = 3;

const scopes = new Map<string, ScopeEntry>();
/** scopeKey → last seq seen. The resume vector, replacing `Last-Event-ID`. */
const cursors = new Map<string, number>();
/** scopeKey → the filter union the server is currently honouring. */
const sentFilters = new Map<string, MuxFilter>();
/** Global event ids already delivered, for N-10. */
const seenEventIds = new Set<number>();
const rejections = new Map<string, number>();

let maxSeenEventId = 0;
let source: EventSource | null = null;
let connectionId: string | null = null;
let connecting = false;
let openScheduled = false;
let reconciling = false;
let attempts = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let activeScopes = new Set<string>();

function scopeKey(scope: string, id: string): string {
  return `${scope}:${id}`;
}

function baseUrl(): string {
  const endpoint = getAuthRuntime().endpoint;
  return endpoint || (typeof window === 'undefined' ? '' : window.location.origin);
}

function forEachHandler(key: string, fn: (h: MuxHandlers) => void): void {
  const entry = scopes.get(key);
  if (!entry) return;
  for (const h of [...entry.handlers.keys()]) fn(h);
}

function parseControl(e: Event): Record<string, unknown> | null {
  const data = (e as MessageEvent<string>).data;
  if (typeof data !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(data);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function noteRejections(raw: unknown): void {
  if (!Array.isArray(raw)) return;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const key = String((item as Record<string, unknown>)['s'] ?? '');
    if (!key) continue;
    const next = (rejections.get(key) ?? 0) + 1;
    rejections.set(key, next);
    if (next >= MAX_REJECTIONS_PER_SCOPE) {
      // Stop asking. Retrying a refusal forever is a POST loop, and the
      // subscriber deserves to be told rather than left waiting silently.
      const reason = String((item as Record<string, unknown>)['reason'] ?? 'rejected');
      forEachHandler(key, (h) => h.onError?.(null));
      if (import.meta.env?.DEV) {
        console.debug('[muxStream] giving up on', key, reason);
      }
    }
  }
}

/** Scopes we still want and are still allowed to ask for. */
function wanted(): string[] {
  return [...scopes.keys()].filter(
    (k) => (rejections.get(k) ?? 0) < MAX_REJECTIONS_PER_SCOPE,
  );
}

function applyActiveSet(frame: Record<string, unknown>): void {
  const previous = activeScopes;
  activeScopes = new Set(
    Array.isArray(frame['active']) ? (frame['active'] as unknown[]).map(String) : [],
  );
  noteRejections(frame['rejected']);

  const resumed = (frame['resumed'] ?? {}) as Record<string, unknown>;
  for (const key of activeScopes) {
    if (!previous.has(key)) {
      rejections.delete(key);
      forEachHandler(key, (h) => h.onOpen?.());
    }
    if (Object.prototype.hasOwnProperty.call(resumed, key) && resumed[key] !== true) {
      // The cursor named a position the server could not honour. Keeping it
      // would make the next reconnect fail the same way.
      cursors.delete(key);
      forEachHandler(key, (h) => h.onResync?.('not_resumed'));
    }
  }
}

function subPayload(entry: ScopeEntry): { scope: string; id: string; filter?: readonly string[] } {
  const filter = filterUnion(entry);
  return { scope: entry.scope, id: entry.id, ...(filter ? { filter } : {}) };
}

/**
 * Bring the server's subscription set in line with ours.
 *
 * Idempotent and safe to call after every control frame — it no-ops once the
 * two sides agree, which is what makes a lost mutation self-healing.
 */
/**
 * Set when a scope changes while a reconcile is already in flight.
 *
 * △ Phase 1 review — without this, a scope requested during an in-flight
 * `POST /subs` was silently dropped by the `reconciling` guard below and only
 * picked up again by the NEXT control frame that happened to arrive (the
 * server always sends one `subs` frame per mutation, so this self-healed in
 * practice, just with an extra round trip of latency and no `onOpen()` in the
 * meantime). Retrying immediately once the in-flight call settles removes
 * that latency instead of relying on an incidental frame to cover for it.
 */
let reconcilePending = false;

async function reconcile(): Promise<void> {
  if (!connectionId || !source) return;
  if (reconciling) {
    reconcilePending = true;
    return;
  }
  const want = new Set(wanted());

  // A scope whose filter union changed has to be dropped and re-added: the
  // server holds one subscription per scope and its prefixes are fixed at
  // subscribe time, so a widened union would otherwise never deliver the kinds
  // the new subscriber joined for.
  const refilter = [...want].filter(
    (k) =>
      activeScopes.has(k) &&
      !sameFilter(sentFilters.get(k), filterUnion(scopes.get(k) as ScopeEntry)),
  );

  const add = [...want]
    .filter((k) => !activeScopes.has(k) || refilter.includes(k))
    .map((k) => scopes.get(k))
    .filter((e): e is ScopeEntry => e !== undefined)
    .map(subPayload);
  const remove = [...new Set([...activeScopes].filter((k) => !want.has(k)).concat(refilter))];
  if (add.length === 0 && remove.length === 0) return;

  reconciling = true;
  const target = connectionId;
  try {
    const res = await fetch(`${baseUrl()}/api/stream/connections/${target}/subs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ add, remove }),
    });
    if (!res.ok) {
      // The connection is gone server-side (restart, reap, cap). Reopening is
      // the only way back, and it carries the cursor map so nothing is lost.
      teardown();
      scheduleOpen();
      return;
    }
    for (const sub of add) sentFilters.set(scopeKey(sub.scope, sub.id), sub.filter);
  } catch {
    teardown();
    scheduleOpen();
  } finally {
    reconciling = false;
    if (reconcilePending) {
      reconcilePending = false;
      void reconcile();
    }
  }
}

function teardown(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (source) {
    try {
      source.close();
    } catch {
      /* already closed */
    }
    source = null;
  }
  connectionId = null;
  activeScopes = new Set();
  // Describes what the SERVER holds, so it cannot outlive the connection.
  sentFilters.clear();
}

function scheduleRetry(): void {
  if (retryTimer || scopes.size === 0) return;
  attempts += 1;
  const delay = Math.min(1000 * 2 ** Math.min(attempts, 5), 30_000);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void connect();
  }, delay);
}

/**
 * Coalesce a burst of subscriptions into one connection.
 *
 * Mounting a page subscribes several scopes in the same tick; opening on the
 * first one would POST a connection that is missing the rest and immediately
 * have to mutate it.
 */
function scheduleOpen(): void {
  if (openScheduled || connecting || source) return;
  openScheduled = true;
  queueMicrotask(() => {
    openScheduled = false;
    void connect();
  });
}

async function connect(): Promise<void> {
  if (connecting || source) return;
  const subs = wanted()
    .map((k) => scopes.get(k))
    .filter((e): e is ScopeEntry => e !== undefined)
    .map(subPayload);
  if (subs.length === 0) return;

  connecting = true;
  try {
    const cursorMap: Record<string, number> = {};
    for (const [key, seq] of cursors) {
      if (scopes.has(key)) cursorMap[key] = seq;
    }

    const res = await fetch(`${baseUrl()}/api/stream/connections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subs, cursors: cursorMap }),
    });
    if (!res.ok) {
      for (const key of scopes.keys()) forEachHandler(key, (h) => h.onError?.(null));
      scheduleRetry();
      return;
    }
    const body = (await res.json()) as { connectionId?: string; ticket?: string };
    if (!body.connectionId) {
      scheduleRetry();
      return;
    }
    if (scopes.size === 0) return; // everything unsubscribed while we waited

    connectionId = body.connectionId;
    for (const sub of subs) sentFilters.set(scopeKey(sub.scope, sub.id), sub.filter);
    const target = new URL('/api/stream', `${baseUrl()}/`);
    target.searchParams.set('c', body.connectionId);
    // Empty means the server runs unauthenticated — see `authTransport`.
    if (body.ticket) target.searchParams.set('ticket', body.ticket);

    const es = new EventSource(target.toString());
    source = es;
    wire(es);
  } catch {
    for (const key of scopes.keys()) forEachHandler(key, (h) => h.onError?.(null));
    scheduleRetry();
  } finally {
    connecting = false;
  }
}

function wire(es: EventSource): void {
  es.onmessage = (e) => {
    let frame: { s?: unknown; q?: unknown; e?: unknown; k?: unknown; p?: unknown };
    try {
      frame = JSON.parse((e as MessageEvent<string>).data) as typeof frame;
    } catch {
      return;
    }
    if (typeof frame.s !== 'string') return;

    // N-10 — the same event arrives once per scope it was published to, and
    // `sseManager` routes by `payload.sessionId`, so a second delivery is a
    // second render of the same token.
    const eventId = typeof frame.e === 'number' ? frame.e : 0;
    if (eventId > 0) {
      if (seenEventIds.has(eventId)) return;
      seenEventIds.add(eventId);
      if (eventId > maxSeenEventId) maxSeenEventId = eventId;
      if (seenEventIds.size > SEEN_HIGH_WATER) {
        const floor = maxSeenEventId - SEEN_RETAIN;
        for (const id of seenEventIds) if (id < floor) seenEventIds.delete(id);
      }
    }

    const seq = typeof frame.q === 'number' ? frame.q : 0;
    if (seq > 0) cursors.set(frame.s, seq);

    const data = JSON.stringify({ kind: frame.k, payload: frame.p ?? null });
    const entry = scopes.get(frame.s);
    if (!entry) return;
    // Each handler re-applies its own prefixes: the server was sent the UNION,
    // so a subscriber that asked for `browser.session_created` would otherwise
    // receive every `browser.` event a co-resident panel wanted.
    for (const [handler, filter] of [...entry.handlers]) {
      if (!matchesFilter(filter, frame.k)) continue;
      handler.onMessage?.({ lastEventId: String(seq), data });
    }
  };

  es.addEventListener('hello', (e) => {
    const frame = parseControl(e);
    if (!frame) return;
    attempts = 0;
    if (typeof frame['connectionId'] === 'string') connectionId = frame['connectionId'];
    applyActiveSet(frame);
    void reconcile();
  });

  es.addEventListener('subs', (e) => {
    const frame = parseControl(e);
    if (!frame) return;
    applyActiveSet(frame);
    void reconcile();
  });

  // Scope-local and never fatal to the connection (§5.9.4).
  es.addEventListener('gap', (e) => {
    const frame = parseControl(e);
    if (!frame) return;
    const key = String(frame['s'] ?? '');
    if (!key) return;
    forEachHandler(key, (h) => h.onResync?.(String(frame['reason'] ?? 'gap')));
  });

  // Last resort — the socket could not drain at all, so every scope is suspect.
  es.addEventListener('slow_consumer_dropped', () => {
    for (const key of scopes.keys()) {
      forEachHandler(key, (h) => h.onResync?.('slow_consumer_dropped'));
    }
  });

  es.onerror = () => {
    for (const key of scopes.keys()) forEachHandler(key, (h) => h.onError?.(es));
    // CONNECTING means the browser is still retrying a transport blip on its
    // own — but its retry replays a redeemed single-use ticket, so we own it.
    if (es.readyState !== EventSource.CLOSED && es.readyState !== EventSource.CONNECTING) return;
    if (source !== es) return;
    teardown();
    scheduleRetry();
  };
}

/**
 * Subscribe one scope to the shared connection.
 *
 * Mirrors `openAuthenticatedEventSource`'s handle shape so the call site keeps
 * its existing cleanup.
 */
export function openMultiplexedStream(
  scope: string,
  id: string,
  handlers: MuxHandlers,
  filter?: readonly string[],
): { close: () => void } {
  const key = scopeKey(scope, id);
  let entry = scopes.get(key);
  if (!entry) {
    entry = { scope, id, handlers: new Map() };
    scopes.set(key, entry);
  }
  entry.handlers.set(handlers, filter);

  if (source && connectionId) {
    // `reconcile` also covers the case where this subscriber widened the scope's
    // filter union, which an `activeScopes` membership test alone would miss.
    if (activeScopes.has(key) && sameFilter(sentFilters.get(key), filterUnion(entry))) {
      handlers.onOpen?.();
    } else {
      void reconcile();
    }
  } else {
    scheduleOpen();
  }

  let released = false;
  return {
    close: () => {
      if (released) return;
      released = true;
      const current = scopes.get(key);
      if (!current) return;
      current.handlers.delete(handlers);
      if (current.handlers.size > 0) {
        // Narrowing the union is not worth a resubscribe: the survivors filter
        // locally anyway, and a round trip would cost them their cursor.
        return;
      }
      scopes.delete(key);
      cursors.delete(key);
      rejections.delete(key);
      sentFilters.delete(key);
      if (scopes.size === 0) teardown();
      else void reconcile();
    },
  };
}

/** Test seam. Never call from application code. */
export function resetMuxStreamForTests(): void {
  teardown();
  scopes.clear();
  cursors.clear();
  sentFilters.clear();
  seenEventIds.clear();
  rejections.clear();
  maxSeenEventId = 0;
  attempts = 0;
  connecting = false;
  openScheduled = false;
  reconciling = false;
}
