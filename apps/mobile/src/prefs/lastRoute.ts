// ────────────────────────────────────────────────────────────────
// Last route — put the user back where they were after a cold start.
//
// A phone kills backgrounded apps constantly. Reopening GeneratorAI and
// landing on Home when the user was mid-transcript five minutes ago reads as
// the app having forgotten them. Restoring the route hours later is the
// opposite mistake: they have moved on and the old chat is noise.
//
// So: the route is written on every navigation (MMKV, synchronous, cheap),
// and consumed exactly once on cold start — and only when it was written
// less than `LAST_ROUTE_TTL_MS` (30 minutes) ago.
//
// ── Wiring ──────────────────────────────────────────────────────
//   • `useLastRoute()` — mount ONCE, anywhere under the router (the tab
//     layout or root layout). It records `usePathname()` as it changes.
//   • `consumeLastRoute()` — call once from the entry route
//     (`app/index.tsx` / the tabs layout) on cold start; when it returns a
//     path, `router.replace(path)`. It clears the record so a second call
//     — or the next cold start — cannot replay a stale route.
//
// The tabs agent owns those call sites; this module only provides them.
// The rules (which routes, how fresh) live in `lastRouteRules.ts`.
// ────────────────────────────────────────────────────────────────

import { useEffect } from 'react';
import { usePathname } from 'expo-router';

import { PREF_KEYS, prefs } from '../storage/prefs';
import { isRestorableRoute, resolveLastRoute } from './lastRouteRules';

export {
  LAST_ROUTE_TTL_MS,
  isLastRouteFresh,
  isRestorableRoute,
  resolveLastRoute,
} from './lastRouteRules';

export function recordLastRoute(pathname: string, now: number = Date.now()): void {
  if (!isRestorableRoute(pathname)) return;
  prefs.setString(PREF_KEYS.lastRoute, pathname);
  prefs.setNumber(PREF_KEYS.lastRouteAt, now);
}

export function clearLastRoute(): void {
  prefs.delete(PREF_KEYS.lastRoute);
  prefs.delete(PREF_KEYS.lastRouteAt);
}

/**
 * Read-and-clear the restorable route, or null.
 *
 * Clears on every call, including the stale case: a record older than the
 * TTL is dead and must not linger for a later (fresher-looking) read.
 */
export function consumeLastRoute(now: number = Date.now()): string | null {
  const route = prefs.getString(PREF_KEYS.lastRoute);
  const savedAt = prefs.getNumber(PREF_KEYS.lastRouteAt, 0);
  clearLastRoute();
  return resolveLastRoute({ route, savedAt: savedAt || undefined }, now);
}

/** Records the current pathname as it changes. Mount once under the router. */
export function useLastRoute(): void {
  const pathname = usePathname();
  useEffect(() => {
    recordLastRoute(pathname);
  }, [pathname]);
}
