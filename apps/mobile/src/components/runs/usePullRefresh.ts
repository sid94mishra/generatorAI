// ────────────────────────────────────────────────────────────────
// usePullRefresh — a refresh spinner that only a PULL turns on.
//
// Binding `RefreshControl.refreshing` to a query's `isFetching` makes the
// spinner flash on every background poll and every stream-driven refetch —
// on a live run that is every few seconds. The spinner means "you asked for
// this", so it is driven by the gesture and the refetch it started.
// ────────────────────────────────────────────────────────────────

import { useCallback, useRef, useState } from 'react';

import { haptics } from '../ui/haptics';

export function usePullRefresh(refetch: () => Promise<unknown> | unknown): {
  refreshing: boolean;
  onRefresh: () => void;
} {
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(refetch);
  latest.current = refetch;

  const onRefresh = useCallback(() => {
    haptics.tap();
    setRefreshing(true);
    void Promise.resolve()
      .then(() => latest.current())
      .catch(() => undefined)
      .finally(() => setRefreshing(false));
  }, []);

  return { refreshing, onRefresh };
}
