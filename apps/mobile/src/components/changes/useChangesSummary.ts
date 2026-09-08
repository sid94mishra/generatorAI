// ────────────────────────────────────────────────────────────────
// useChangesSummary — the one query behind every Changes surface.
//
// The screen's composer tray, the workbench pane header and the route screen
// all show the same `+N −M · k files`; sharing the key means they refetch
// once when the stream's `workspace` invalidation lands, not three times.
//
// `active: false` stops background refetching without dropping the cache,
// so a pane the user swiped away from is cheap while hidden and instant
// when it comes back.
// ────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys, type ChangeFileEntry } from '@generatorai/client-core';

import { useWorkspaceExtras, type ChangeSummaryV2 } from './api';

export type ChangeRow = ChangeFileEntry & { alias: string; id: string };

export interface ChangesSummaryState {
  files: ChangeRow[];
  additions: number;
  deletions: number;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  hasGit: boolean;
  summary: ChangeSummaryV2 | undefined;
  refetch: () => void;
}

export function useChangesSummary(
  workspaceId: string | null | undefined,
  options: { base?: string; active?: boolean } = {},
): ChangesSummaryState {
  const extras = useWorkspaceExtras();
  const base = options.base ?? 'baseline';
  const active = options.active ?? true;

  const query = useQuery({
    // Prefix-compatible with `queryKeys.changes` so the stream's
    // `['workspaces', id]` invalidation reaches it.
    queryKey: [...queryKeys.changes(workspaceId ?? ''), base],
    queryFn: () => extras.changes(workspaceId!, { base, head: 'working' }),
    enabled: Boolean(workspaceId),
    staleTime: 10_000,
    // Paused panes keep their data but do not chase the server.
    refetchOnWindowFocus: active,
    refetchOnReconnect: active,
    subscribed: active,
  });

  const files = useMemo<ChangeRow[]>(
    () =>
      (query.data?.repos ?? []).flatMap((repo) =>
        repo.files.map((file) => ({ ...file, alias: repo.alias, id: `${repo.alias}:${file.path}` })),
      ),
    [query.data],
  );

  return {
    files,
    additions: query.data?.stats.additions ?? 0,
    deletions: query.data?.stats.deletions ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    isFetching: query.isFetching,
    hasGit: query.data?.hasGit ?? true,
    summary: query.data,
    refetch: () => void query.refetch(),
  };
}
