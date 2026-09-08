// ────────────────────────────────────────────────────────────────
// Last route — the pure rules.
//
// Split from `lastRoute.ts` so they can be unit-tested on Node: that file
// imports expo-router and MMKV, neither of which loads outside a device.
// ────────────────────────────────────────────────────────────────

/** Restore only if the app was killed less than this long ago. */
export const LAST_ROUTE_TTL_MS = 30 * 60 * 1000;

/**
 * Routes that must never be restored.
 *
 * Restoring `/pair` would drop a paired user back onto the pairing flow;
 * restoring `/revoked` would show a revoked wall to a re-paired device;
 * `/` and the tab root are where the user lands anyway.
 */
const NON_RESTORABLE = new Set(['', '/', '/pair', '/revoked', '/(tabs)', '/index']);

export function isRestorableRoute(pathname: string | null | undefined): pathname is string {
  if (!pathname) return false;
  if (!pathname.startsWith('/')) return false;
  if (NON_RESTORABLE.has(pathname)) return false;
  // Settings screens are reached from a tab in one tap; restoring one after a
  // kill puts the user two levels deep in preferences they had finished with.
  if (pathname.startsWith('/settings')) return false;
  return true;
}

/** Is a record written at `savedAt` still fresh at `now`? */
export function isLastRouteFresh(
  savedAt: number | undefined,
  now: number,
  ttlMs: number = LAST_ROUTE_TTL_MS,
): boolean {
  if (typeof savedAt !== 'number' || !Number.isFinite(savedAt) || savedAt <= 0) return false;
  const age = now - savedAt;
  // A clock that went backwards (timezone change, NTP correction) makes the
  // record look like it is from the future; treat that as stale rather than
  // trusting it forever.
  if (age < 0) return false;
  return age < ttlMs;
}

/** Decide what to restore from a stored record. */
export function resolveLastRoute(
  record: { route: string | undefined; savedAt: number | undefined },
  now: number,
  ttlMs: number = LAST_ROUTE_TTL_MS,
): string | null {
  if (!isRestorableRoute(record.route)) return null;
  if (!isLastRouteFresh(record.savedAt, now, ttlMs)) return null;
  return record.route;
}
