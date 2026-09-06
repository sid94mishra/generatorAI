// ────────────────────────────────────────────────────────────────
// sourceQueries — the chat's mounts, and the pickers that edit them
// ────────────────────────────────────────────────────────────────
//
// `workspace-info` is the authority for "what is this chat working on":
// aliases, modes, branches, per-mount status and the branch base every diff
// is anchored to. It is invalidated by the `workspace.prep` SSE event (see
// sseManager), so a worktree finishing preparation refreshes every surface
// that renders a mount without any polling.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChatSourceSpec } from '@generatorai/shared';
import { usePlatform } from '../providers/PlatformProvider.js';
import type {
  FsDirListing,
  FsGitInfo,
  HttpPlatformClient,
  WorkspaceInfoDto,
} from '../platform/HttpPlatformClient.js';
import { queryKeys } from './queries.js';

export const workspaceInfoKey = (workspaceId: string) =>
  ['workspace-info', workspaceId] as const;

/** Mounts + preparation status for a workspace. */
export function useWorkspaceInfo(workspaceId: string | undefined, enabled = true) {
  const platform = usePlatform() as HttpPlatformClient;
  return useQuery<WorkspaceInfoDto>({
    queryKey: workspaceInfoKey(workspaceId ?? ''),
    queryFn: () => platform.getWorkspaceInfo(workspaceId!),
    enabled: !!workspaceId && enabled,
    staleTime: 15_000,
  });
}

/**
 * Child directories of `path`. `null` means "not browsing" (the query is
 * disabled); `''` lists the drive / home roots.
 */
export function useFsDirs(path: string | null) {
  const platform = usePlatform() as HttpPlatformClient;
  return useQuery<FsDirListing>({
    queryKey: ['fs-dirs', path ?? ''],
    queryFn: () => platform.listFsDirs(path ?? ''),
    enabled: path !== null,
    // Directory listings are cheap and the picker is short-lived, but
    // re-walking the same folder on every breadcrumb click is pure latency.
    staleTime: 30_000,
    retry: false,
  });
}

/** Branches / dirty state / nested repos for a folder the user picked. */
export function useFsGitInfo(path: string | undefined) {
  const platform = usePlatform() as HttpPlatformClient;
  return useQuery<FsGitInfo>({
    queryKey: ['fs-git-info', path ?? ''],
    queryFn: () => platform.getFsGitInfo(path!),
    enabled: !!path,
    staleTime: 30_000,
    retry: false,
  });
}

/** `PUT /api/chats/:id/sources` — replace the mount plan of an idle chat. */
export function useUpdateChatSources(chatId: string | undefined) {
  const platform = usePlatform() as HttpPlatformClient;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { sources: ChatSourceSpec[]; primary?: string }) =>
      platform.updateChatSources(chatId!, params.sources, params.primary),
    onSuccess: (chat) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.chat(chatId ?? '') });
      void queryClient.invalidateQueries({ queryKey: queryKeys.chats });
      if (chat.workspaceId) {
        void queryClient.invalidateQueries({ queryKey: workspaceInfoKey(chat.workspaceId) });
        // The mounts moved, so every view of the workspace is stale: the file
        // tree, the change summary and the checkpoint list are all per-mount.
        for (const prefix of [
          'workspace-files',
          'workspace-file-index',
          'workspace-tree',
          'workspace-change-summary',
          'workspace-checkpoints',
        ]) {
          void queryClient.invalidateQueries({ queryKey: [prefix, chat.workspaceId] });
        }
      }
    },
  });
}

/** `POST /api/chats/:id/workspace/prepare` — retry after a failed preparation. */
export function usePrepareChatWorkspace(chatId: string | undefined) {
  const platform = usePlatform() as HttpPlatformClient;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => platform.prepareChatWorkspace(chatId!),
    onSuccess: () => {
      // 202: preparation runs in the background and reports on SSE. Refetching
      // the chat immediately flips the bar to "Preparing…" rather than leaving
      // the error on screen until the first event lands.
      void queryClient.invalidateQueries({ queryKey: queryKeys.chat(chatId ?? '') });
    },
  });
}
