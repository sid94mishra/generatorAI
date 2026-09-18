// ────────────────────────────────────────────────────────────────
// usePullToRefresh — a spinner for the USER'S pull, not for polling.
//
// Lists used to pass `refreshing={query.isFetching}`, so every background
// refetch (a 10 s poll, a stream invalidation) dropped the pull-to-refresh
// spinner over the list as if the user had asked for it. This tracks the
// pull itself: the spinner shows from the pull until the fetch it started
// settles (or a safety timeout), and a poll never shows it.
//
//   const pull = usePullToRefresh(() => query.refetch(), query.isFetching);
//   <LegendList refreshing={pull.refreshing} onRefresh={pull.onRefresh} />
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';

import { haptics } from './haptics';

const SAFETY_TIMEOUT_MS = 10_000;
/** A pull that starts no fetch at all (nothing to refetch) ends after this. */
const NO_FETCH_GRACE_MS = 800;

export function usePullToRefresh(
  refetch: () => unknown,
  isFetching: boolean,
): { refreshing: boolean; onRefresh: () => void } {
  const [pulling, setPulling] = useState(false);
  const sawFetch = useRef(false);

  useEffect(() => {
    if (!pulling) return;
    if (isFetching) sawFetch.current = true;
    else if (sawFetch.current) {
      sawFetch.current = false;
      setPulling(false);
    }
  }, [pulling, isFetching]);

  useEffect(() => {
    if (!pulling) return;
    const safety = setTimeout(() => setPulling(false), SAFETY_TIMEOUT_MS);
    const grace = setTimeout(() => {
      if (!sawFetch.current) setPulling(false);
    }, NO_FETCH_GRACE_MS);
    return () => {
      clearTimeout(safety);
      clearTimeout(grace);
    };
  }, [pulling]);

  const onRefresh = useCallback(() => {
    haptics.tap();
    sawFetch.current = false;
    setPulling(true);
    const result = refetch();
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      void (result as Promise<unknown>).finally(() => setPulling(false));
    }
  }, [refetch]);

  return { refreshing: pulling, onRefresh };
}
