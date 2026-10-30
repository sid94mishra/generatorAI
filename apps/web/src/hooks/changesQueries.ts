// ────────────────────────────────────────────────────────────────
// Changes query hooks — per-file diff bodies and summary refresh.
//
// The summary / checkpoint / keep / discard hooks live in `queries.ts`; these
// are the pieces the Changes block and the composer tray used to reach for
// through the platform client or the query client directly (03 §1.2).
// ────────────────────────────────────────────────────────────────

import { useCallback } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { usePlatform } from '@/providers/PlatformProvider.js';
import type { HttpPlatformClient } from '@/platform/HttpPlatformClient.js';
import type { ChangeSummaryFile } from '@/types/changes.js';

/** One changed file whose old/new bodies should be fetched. */
export interface ChangeFileBodyRequest {
  alias: string;
  file: ChangeSummaryFile;
}

/**
 * Old/new bodies for the given changed files, one query per file, in request
 * order.
 *
 * The blob pair is part of the key. A file's content is immutable for a given
 * pair, but the path is not: when the agent edits a file the summary reports
 * new blobs while the path/base/head stay the same. Without the pair the key
 * would not change and `staleTime` would serve the pre-edit body for five
 * minutes — and with it, the long `staleTime` is exact rather than a guess.
 */
export function useWorkspaceChangeFileBodies(
  workspaceId: string | undefined,
  requests: readonly ChangeFileBodyRequest[],
  base: string,
  head: string,
) {
  const platform = usePlatform() as HttpPlatformClient;
  return useQueries({
    queries: requests.map((entry) => ({
      queryKey: [
        'workspace-change-file',
        workspaceId ?? '',
        entry.alias,
        entry.file.path,
        base,
        head,
        `${entry.file.oldBlob ?? 'none'}:${entry.file.newBlob ?? 'none'}`,
      ],
      queryFn: () =>
        platform.getWorkspaceChangeFile(workspaceId!, entry.file.path, {
          alias: entry.alias,
          base,
          head,
          // The summary already resolved both sides' objects. Handing them
          // back lets the server read exactly those blobs rather than
          // re-deriving them, which is what makes expanding a file feel
          // instant instead of taking a couple of seconds.
          ...(entry.file.oldBlob ? { oldBlob: entry.file.oldBlob } : {}),
          ...(entry.file.newBlob ? { newBlob: entry.file.newBlob } : {}),
          // A renamed file is stored under its OLD name on the base side;
          // without this the server finds nothing there and the diff renders
          // as a pure addition.
          ...(entry.file.oldPath ? { oldPath: entry.file.oldPath } : {}),
        }),
      enabled: !!workspaceId,
      staleTime: 5 * 60_000,
    })),
  });
}

/**
 * Mark every change summary of one workspace stale (all bases, all heads), so
 * whatever is showing it refetches. The composer tray calls this after live
 * file ops and when a turn settles, so the tray and the Changes tab converge
 * on the same numbers without a manual refresh.
 */
export function useInvalidateWorkspaceChangeSummary(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useCallback(() => {
    if (!workspaceId) return;
    void queryClient.invalidateQueries({ queryKey: ['workspace-change-summary', workspaceId] });
  }, [queryClient, workspaceId]);
}
