// ────────────────────────────────────────────────────────────────
// useActivityModel — the Activity column's cards (D-92): the live attention
// feed (SSE) + today's finished items (G-11, refetched when the feed loses an
// item) folded by client-core's `buildActivityModel` with the column's kind
// tab, "Show finished" and this device's dismissed failures. No polling.
// ────────────────────────────────────────────────────────────────

import { useCallback, useMemo } from 'react';
import { buildActivityModel, type ActivityModel } from '@generatorai/client-core';
import { useAttention } from '@/hooks/attentionQueries.js';
import { useTodayActivity } from '@/hooks/activityQueries.js';
import { useModels } from '@/hooks/harnessQueries.js';
import { useActivityStore, type ActivityKindFilter } from '@/stores/activityStore.js';

export interface ActivityModelResult {
  /** Undefined until the attention feed has loaded — never an invented empty list (D-36). */
  model: ActivityModel | undefined;
  /** The finished items are still loading (live cards may already show). */
  finishedLoading: boolean;
  error: string | null;
  retry: () => void;
  modelLabel: (id: string) => string;
}

export function useActivityModel(options: { kind?: ActivityKindFilter; enabled?: boolean } = {}): ActivityModelResult {
  const enabled = options.enabled !== false;
  const attention = useAttention({ enabled });
  const today = useTodayActivity({ enabled });
  const storeKind = useActivityStore((s) => s.kind);
  const showRecent = useActivityStore((s) => s.showRecent);
  const dismissedList = useActivityStore((s) => s.dismissed);
  const kind = options.kind ?? storeKind;
  const { data: models } = useModels();

  const labels = useMemo(() => new Map((models ?? []).map((m) => [m.id, m.name])), [models]);
  const modelLabel = useCallback((id: string) => labels.get(id) ?? id, [labels]);

  const dismissed = useMemo(() => new Set(dismissedList), [dismissedList]);
  const model = useMemo(
    () =>
      attention.data
        ? buildActivityModel({ attention: attention.data, recent: today.data?.items, dismissed, kind, showRecent })
        : undefined,
    [attention.data, today.data, dismissed, kind, showRecent],
  );

  const { refetch: refetchAttention } = attention;
  const { refetch: refetchToday } = today;
  const retry = useCallback(() => {
    void refetchAttention();
    void refetchToday();
  }, [refetchAttention, refetchToday]);

  return {
    model,
    finishedLoading: today.isLoading,
    error: attention.error ?? (today.error ? (today.error as Error).message : null),
    retry,
    modelLabel,
  };
}
