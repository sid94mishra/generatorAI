// ────────────────────────────────────────────────────────────────
// Palette entity search hook (G-18) — CommandPalette.
//
// One merged, ranked list across chats, projects, agents, workflows,
// automations and scripts, from `GET /api/search`. Recents ("Recent chats")
// and settings/navigation matches are composed by the caller from other
// hooks (`useChats({ sort: 'activity', limit: 5 })` + the attention feed) —
// not part of this response.
// ────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SearchEntityType } from '@generatorai/shared';
import { usePlatform } from '../providers/PlatformProvider.js';

export const searchKeys = {
  search: (q: string, types?: SearchEntityType[], limit?: number) => ['search', q, types ?? null, limit ?? null] as const,
};

const DEBOUNCE_MS = 120;

/** Debounces `value` by `delayMs` — the palette's own 120ms rule (05 §G-18). */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

export interface UseSearchOptions {
  types?: SearchEntityType[];
  limit?: number;
  /** Default true. Set false to hold off (e.g. palette closed). */
  enabled?: boolean;
}

/** `q` is debounced by 120ms before it reaches the network. */
export function useSearch(q: string, options?: UseSearchOptions) {
  const platform = usePlatform();
  const debouncedQ = useDebouncedValue(q.trim(), DEBOUNCE_MS);
  return useQuery({
    queryKey: searchKeys.search(debouncedQ, options?.types, options?.limit),
    queryFn: () => platform.search({ q: debouncedQ, types: options?.types, limit: options?.limit }),
    enabled: (options?.enabled ?? true) && debouncedQ.length > 0,
    staleTime: 10_000,
  });
}
