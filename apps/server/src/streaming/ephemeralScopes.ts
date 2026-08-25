// ────────────────────────────────────────────────────────────────
// ephemeralScopes — W09 / W09-a, the live-only half of the stream.
//
// Some feeds have no replay value and must not touch the durable log. The
// computer preview is the example: a window frame per action and a cursor
// sample every ~30 ms, none of which anyone will ever ask to see again. Routing
// it through `StreamBroker` would persist a row per sample — reintroducing
// exactly the write volume Phase 0 removed — so it does not go through the
// broker at all. It goes here.
//
// The other half of the defect is P1-11's actual wording: the preview ran a
// **250 ms filesystem poll per connection**. Two open panels meant two polls of
// the same directory producing identical bytes. A source here is started by the
// FIRST subscriber and stopped by the last, so N watchers cost one poll.
//
// Because a subscriber can arrive mid-run, each source keeps the latest value
// per kind and replays it on subscribe. Without that, a panel opened between
// two agent actions sits blank until the next one — which for a preview can be
// minutes, and reads as the feature being broken rather than idle.
// ────────────────────────────────────────────────────────────────

import type { ILogger } from '@generatorai/shared';

/** Scopes that exist only while someone is watching. Never persisted. */
export const EPHEMERAL_SCOPES = ['computer'] as const;

export type EphemeralScope = (typeof EPHEMERAL_SCOPES)[number];

const EPHEMERAL_SET = new Set<string>(EPHEMERAL_SCOPES);

export function isEphemeralScope(scope: string): scope is EphemeralScope {
  return EPHEMERAL_SET.has(scope);
}

export interface EphemeralEvent {
  readonly kind: string;
  readonly payload: unknown;
  /**
   * Delta frames are dropped on a congested socket; item frames are queued.
   *
   * Stated per emission rather than derived from `kind`, because W04's table is
   * typed over `AgentEvent['kind']` and these kinds are not agent events. A
   * source that lies here does not corrupt anything — it only chooses whether
   * its own frames are droppable.
   */
  readonly cls: 'delta' | 'item';
  /**
   * Replay this to a subscriber that arrives later, superseding any earlier
   * event of the same kind. False for a pure stream like cursor motion, where
   * a stale sample is worse than none.
   */
  readonly latest?: boolean;
}

export type EphemeralHandler = (event: EphemeralEvent) => void;

/**
 * Starts producing into `emit`. Returns a function that stops it.
 *
 * `emit` must be safe to call after the stop function returns — a producer
 * mid-`await` cannot always stop synchronously — and is a no-op then.
 */
export type EphemeralProducer = (
  id: string,
  emit: (event: EphemeralEvent) => void,
) => () => void;

interface Source {
  readonly handlers: Set<EphemeralHandler>;
  readonly latest: Map<string, EphemeralEvent>;
  stop: (() => void) | null;
  stopped: boolean;
}

const producers = new Map<EphemeralScope, EphemeralProducer>();
const sources = new Map<string, Source>();

/** Register the producer for a scope. Called once, from the composition root. */
export function registerEphemeralProducer(
  scope: EphemeralScope,
  producer: EphemeralProducer,
): void {
  producers.set(scope, producer);
}

export function hasEphemeralProducer(scope: string): boolean {
  return isEphemeralScope(scope) && producers.has(scope);
}

/**
 * Attach to a live scope. Returns a detach function.
 *
 * Throws when no producer is registered, so a subscription to a scope nobody
 * feeds is a visible rejection rather than a socket that stays silent forever.
 */
export function subscribeEphemeral(
  scope: EphemeralScope,
  id: string,
  handler: EphemeralHandler,
  logger?: ILogger,
): () => void {
  const producer = producers.get(scope);
  if (!producer) throw new Error(`No producer registered for ephemeral scope "${scope}"`);

  const key = `${scope}:${id}`;
  let source = sources.get(key);
  if (!source) {
    const created: Source = { handlers: new Set(), latest: new Map(), stop: null, stopped: false };
    sources.set(key, created);
    source = created;
    // `emit` closes over `created`, not over a lookup, so a late emission from
    // a producer that has already been asked to stop cannot resurrect a source
    // that a newer subscriber has since recreated under the same key.
    const emit = (event: EphemeralEvent): void => {
      if (created.stopped) return;
      if (event.latest !== false) created.latest.set(event.kind, event);
      for (const h of [...created.handlers]) {
        try {
          h(event);
        } catch (err) {
          logger?.warn?.(
            `[EphemeralScope] handler threw on ${key}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    };
    try {
      created.stop = producer(id, emit);
    } catch (err) {
      sources.delete(key);
      throw err;
    }
  }

  source.handlers.add(handler);
  // Replayed after the handler is attached so nothing produced during this
  // loop is lost to a source that is already running.
  for (const event of [...source.latest.values()]) {
    try {
      handler(event);
    } catch {
      /* a failing new subscriber must not take down the source */
    }
  }

  let detached = false;
  return () => {
    if (detached) return;
    detached = true;
    const current = sources.get(key);
    if (!current || current !== source) return;
    current.handlers.delete(handler);
    if (current.handlers.size > 0) return;
    current.stopped = true;
    sources.delete(key);
    try {
      current.stop?.();
    } catch (err) {
      logger?.warn?.(
        `[EphemeralScope] producer stop threw on ${key}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  };
}

/** Live source count. Surfaced on the health endpoint and asserted in tests. */
export function ephemeralSourceCount(): number {
  return sources.size;
}

/** Test seam. Stops every source and forgets every producer. */
export function resetEphemeralScopesForTests(): void {
  for (const source of sources.values()) {
    source.stopped = true;
    try {
      source.stop?.();
    } catch {
      /* test teardown */
    }
  }
  sources.clear();
  producers.clear();
}
