// ────────────────────────────────────────────────────────────────
// useSidebarMode — which of the two sidebar forms the frame shows (06 §2.5).
//
//   1. A route with `handle.forceRail` (the workflow builder), or a window
//      below 1200px (`RAIL_QUERY`), shows the rail whatever the preference;
//      Expand then opens the SidebarFlyout and the preference is untouched.
//   2. Otherwise the saved preference (`shellStore.sidebarPref`).
// There is no phone drawer: below 768px the rail stays (04 §4.1 row 3; the
// desktop window never gets that narrow, a browser tab can).
// The forced flag is mirrored into the store so `sidebar.toggle` knows
// whether to flip the flyout or the preference.
// ────────────────────────────────────────────────────────────────

import { useEffect } from 'react';
import { useMatches } from 'react-router';
import { RAIL_QUERY, useMediaQuery } from '@/hooks/useMediaQuery.js';
import { useShellStore } from '@/stores/shellStore.js';
import type { GaiRouteHandle } from '../routes/defineRoute.js';

export interface SidebarModeState {
  mode: 'expanded' | 'rail';
  /** The rail is shown regardless of the preference. */
  forced: boolean;
}

/** Pure rule, exported for tests. */
export function sidebarModeFor(input: {
  narrow: boolean;
  forceRail: boolean;
  pref: 'expanded' | 'rail';
}): SidebarModeState {
  const forced = input.narrow || input.forceRail;
  return { mode: forced ? 'rail' : input.pref, forced };
}

export function useSidebarMode(): SidebarModeState {
  const narrow = useMediaQuery(RAIL_QUERY);
  const matches = useMatches();
  const forceRail = matches.some((m) => (m.handle as Partial<GaiRouteHandle> | undefined)?.forceRail === true);
  const pref = useShellStore((s) => s.sidebarPref);
  const setRailForced = useShellStore((s) => s.setRailForced);
  const state = sidebarModeFor({ narrow, forceRail, pref });

  useEffect(() => {
    setRailForced(state.forced);
  }, [state.forced, setRailForced]);

  return state;
}
