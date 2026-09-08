// ────────────────────────────────────────────────────────────────
// streamConnectionRegistry — W09-a (§5.9.5)
//
// A multiplexed connection is created by a POST and *then* attached by a GET,
// because SSE is a bodyless GET and the resume vector is a map, not a header.
// The record between those two calls is what this file owns.
//
// It also fixes N-11. `sseConnectionCap` caps per `(scope, id)`, which bounds
// nothing a real tab does — five EventSources are five different pairs, so the
// cap of 6 is never approached. The bound that matters is **per principal**,
// and only a connection registry can see that.
// ────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import type { StreamScope } from '@generatorai/core';
import type { EphemeralScope } from './ephemeralScopes.js';

/**
 * Scopes a multiplexed connection can carry.
 *
 * Deliberately wider than `StreamScope`, which is the DURABLE set: it names the
 * scopes `stream_cursors` stores rows for. An ephemeral scope is live-only and
 * must never reach the repository, so widening that type instead would make the
 * unpersistable look persistable everywhere it is used.
 */
export type MuxScope = StreamScope | EphemeralScope;

/**
 * Every surface shares ONE principal in the shared-key model — web tabs, the
 * desktop app, the CLI companion and a second browser window all count
 * against the same key. 2 ("a live tab plus one reconnecting") locked the
 * principal out of live streaming the moment a second tab opened, and a
 * reload raced its own dying socket for the last slot (observed live
 * 2026-08-31 as an endless 429 retry loop with a dead UI). 8 bounds a
 * runaway client while letting the normal multi-surface setup breathe.
 */
export const MAX_CONNECTIONS_PER_PRINCIPAL = 8;

/** Bounds broker fan-out registrations and the size of the `hello` frame. */
export const MAX_SUBS_PER_CONNECTION = 32;

/**
 * How long an unattached record holds its cap slot.
 *
 * A POST that never gets its GET — the tab closed, the ticket expired — would
 * otherwise hold one of two slots for the lifetime of the process, and two
 * such aborts would lock the principal out of streaming entirely.
 */
export const UNATTACHED_TTL_MS = 60_000;

export interface MuxSub {
  readonly scope: MuxScope;
  readonly id: string;
  /**
   * Kind-prefix allowlist (STR-06), as `?filter=` carries on the single-scope
   * endpoint. Several views can watch one scope wanting different prefixes, so
   * the client sends their union and narrows again locally.
   */
  readonly filter?: readonly string[];
  /**
   * Set by `routes/stream.ts` when the sub was authorised under `read:activity`
   * rather than `admin:settings`: the `global` feed is then narrowed to
   * `LIFECYCLE_EVENT_KINDS` server-side, whatever `filter` says. Never
   * client-supplied — `parseSub` does not read it.
   */
  readonly lifecycleOnly?: boolean;
}

export function scopeKeyOf(scope: MuxScope, id: string): string {
  return `${scope}:${id}`;
}

export interface MuxConnectionRecord {
  readonly id: string;
  readonly principalKey: string;
  readonly createdAt: number;
  /** scopeKey → sub. A Map because subscriptions mutate out of band. */
  readonly subs: Map<string, MuxSub>;
  /** scopeKey → the seq the client last saw. Its resume vector. */
  readonly cursors: Map<string, number>;
  attachedAt: number | null;
  /**
   * Set by the attached GET so `POST /:id/subs` can subscribe and confirm on
   * the stream itself. Null while nothing is attached, which is why a
   * mutation on an unattached connection is a 409 rather than a silent no-op.
   */
  onMutate: ((add: readonly MuxSub[], remove: readonly string[]) => Promise<void>) | null;
}

const records = new Map<string, MuxConnectionRecord>();

export type CreateResult =
  | { ok: true; record: MuxConnectionRecord }
  | { ok: false; code: 'CONNECTION_CAP_EXCEEDED'; cap: number; current: number }
  | { ok: false; code: 'TOO_MANY_SUBSCRIPTIONS'; cap: number; current: number };

/**
 * Reap records whose GET never arrived.
 *
 * Called from `create` rather than on a timer: the only thing a stale record
 * costs is a cap slot, and the only moment that matters is when someone is
 * asking for one. A timer would keep the process alive for no benefit.
 */
function sweep(now: number): void {
  for (const [id, rec] of records) {
    if (rec.attachedAt === null && now - rec.createdAt > UNATTACHED_TTL_MS) {
      records.delete(id);
    }
  }
}

export function countForPrincipal(principalKey: string): number {
  let n = 0;
  for (const rec of records.values()) if (rec.principalKey === principalKey) n += 1;
  return n;
}

export function createConnection(
  principalKey: string,
  subs: readonly MuxSub[],
  cursors: ReadonlyMap<string, number>,
): CreateResult {
  const now = Date.now();
  sweep(now);

  if (subs.length > MAX_SUBS_PER_CONNECTION) {
    return {
      ok: false,
      code: 'TOO_MANY_SUBSCRIPTIONS',
      cap: MAX_SUBS_PER_CONNECTION,
      current: subs.length,
    };
  }

  const current = countForPrincipal(principalKey);
  if (current >= MAX_CONNECTIONS_PER_PRINCIPAL) {
    return {
      ok: false,
      code: 'CONNECTION_CAP_EXCEEDED',
      cap: MAX_CONNECTIONS_PER_PRINCIPAL,
      current,
    };
  }

  const record: MuxConnectionRecord = {
    id: randomUUID(),
    principalKey,
    createdAt: now,
    subs: new Map(subs.map((s) => [scopeKeyOf(s.scope, s.id), s])),
    // Cursors for scopes that were not subscribed are dropped rather than
    // kept: they would otherwise grow without bound across reconnects, and a
    // cursor for a scope nobody is watching resumes nothing.
    cursors: new Map(
      [...cursors].filter(([key]) => subs.some((s) => scopeKeyOf(s.scope, s.id) === key)),
    ),
    attachedAt: null,
    onMutate: null,
  };
  records.set(record.id, record);
  return { ok: true, record };
}

export function getConnection(id: string): MuxConnectionRecord | undefined {
  return records.get(id);
}

/**
 * Claim a record for one GET.
 *
 * Returns false when it is already attached, so a replayed ticket cannot fork
 * a second socket onto the same registry entry and double the fan-out.
 */
export function attachConnection(id: string): MuxConnectionRecord | undefined {
  const rec = records.get(id);
  if (!rec || rec.attachedAt !== null) return undefined;
  rec.attachedAt = Date.now();
  return rec;
}

export function destroyConnection(id: string): void {
  records.delete(id);
}

/** Test seam. Never call from application code. */
export function resetConnectionRegistry(): void {
  records.clear();
}
