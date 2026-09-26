// ────────────────────────────────────────────────────────────────
// System info hook (G-12) — Home "System" card + Settings › Diagnostics.
//
// A single cheap `GET /api/system/info` — no SSE, no per-project filter.
// `database.sizeBytes` and `disk` are absent (not `0`) whenever the server
// could not measure them (D-36): render those rows as unknown, never "0 B".
// ────────────────────────────────────────────────────────────────

import { useQuery } from '@tanstack/react-query';
import { usePlatform } from '../providers/PlatformProvider.js';

export const SYSTEM_INFO_KEY = ['system-info'] as const;

/** Refreshed every 30 s — cheap on the server, and uptime/disk/agents drift slowly. */
const SYSTEM_INFO_REFETCH_MS = 30_000;

export function useSystemInfo() {
  const platform = usePlatform();
  return useQuery({
    queryKey: SYSTEM_INFO_KEY,
    queryFn: () => platform.getSystemInfo(),
    staleTime: SYSTEM_INFO_REFETCH_MS,
    refetchInterval: SYSTEM_INFO_REFETCH_MS,
  });
}
