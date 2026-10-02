// MB-48 ChatRow data: the row actions every chat list runs (Chats, Home, Project › Chats, the palette). Pin and
// Mark unread are MG-02 (`PATCH /api/chats/:id {pinned | unread}`); Archive answers with an undo snackbar (MD-26);
// Delete confirms first (MP-29); Stop is the soft cancel. Every success refreshes the cached lists.
import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@generatorai/client-core';

import { useApi } from '../../services/api/useApi';
import { confirm } from '../../ui/native/AlertDialog';
import { haptic } from '../../ui/platform/haptics';
import { toast } from '../../ui/primitives/Toast';
import type { ChatRowActionId, ChatRowView } from './chatRowModel';

export interface ChatRowActionHandlers {
  /** Open the chat (the caller owns navigation). */
  onOpen: (row: ChatRowView) => void;
  /** "More" from a swipe: the caller presents the row menu (a sheet) and runs the chosen item through `run`. */
  onMore?: (row: ChatRowView, run: (id: ChatRowActionId, row: ChatRowView) => void) => void;
}

/** One dispatcher for menu items, swipe actions and accessibility actions. */
export function useChatRowActions({ onOpen, onMore }: ChatRowActionHandlers): (id: ChatRowActionId, row: ChatRowView) => void {
  const api = useApi();
  const client = useQueryClient();
  const refresh = useCallback(() => {
    void client.invalidateQueries({ queryKey: queryKeys.chats() });
  }, [client]);

  const attempt = useCallback(
    async (work: () => Promise<unknown>, failure: string, retry?: () => void) => {
      try {
        await work();
        refresh();
      } catch {
        haptic('error');
        toast({ kind: 'error', message: failure, ...(retry ? { action: { label: 'Retry', onPress: retry } } : {}) });
      }
    },
    [refresh],
  );

  return useCallback(
    function dispatch(id: ChatRowActionId, row: ChatRowView): void {
      switch (id) {
        case 'open':
          onOpen(row);
          return;
        case 'more':
          onMore?.(row, dispatch);
          return;
        case 'pin':
        case 'unpin':
          void attempt(() => api.chats.setPinned(row.id, id === 'pin'), id === 'pin' ? "Couldn't pin that chat." : "Couldn't unpin that chat.");
          return;
        case 'mark-unread':
        case 'mark-read':
          void attempt(() => api.chats.setUnread(row.id, id === 'mark-unread'), "Couldn't change that chat.");
          return;
        case 'stop':
          void attempt(() => api.chats.cancel(row.id, { force: false }), "Couldn't stop that chat.");
          return;
        case 'archive':
          void attempt(async () => {
            await api.chats.update(row.id, { status: 'archived' });
            // Reversible, so it says so and offers Undo (MD-26); no success toast otherwise (MD-58).
            toast({
              kind: 'undo',
              message: `Archived “${row.title}”`,
              undo: { onUndo: () => void attempt(() => api.chats.update(row.id, { status: 'active' }), "Couldn't restore that chat.") },
            });
          }, "Couldn't archive that chat.");
          return;
        case 'unarchive':
          void attempt(() => api.chats.update(row.id, { status: 'active' }), "Couldn't restore that chat.");
          return;
        case 'delete':
          void confirm({
            title: `Delete “${row.title}”?`,
            message: 'The transcript and everything the agent produced in it are removed. This cannot be undone.',
            confirmLabel: 'Delete',
            icon: 'trash',
          }).then((yes) => {
            if (yes) void attempt(() => api.chats.remove(row.id), "Couldn't delete that chat.");
          });
          return;
      }
    },
    [api, attempt, onMore, onOpen],
  );
}

/** Bulk Archive / Delete for selection mode (MD-60); resolves the ids that failed, which stay selected. */
export function useChatBulkActions(): { archive: (ids: string[]) => Promise<string[]>; remove: (ids: string[]) => Promise<string[] | null> } {
  const api = useApi();
  const client = useQueryClient();
  const run = useCallback(
    async (call: () => Promise<{ failed: ReadonlyArray<{ id: string }> }>, failure: string): Promise<string[]> => {
      try {
        const result = await call();
        void client.invalidateQueries({ queryKey: queryKeys.chats() });
        if (result.failed.length > 0) toast({ kind: 'error', message: `${result.failed.length} could not be changed.` });
        return result.failed.map((f) => f.id);
      } catch {
        haptic('error');
        toast({ kind: 'error', message: failure });
        throw new Error(failure);
      }
    },
    [client],
  );
  return {
    archive: (ids) => run(() => api.chats.archiveMany(ids), "Couldn't archive those chats."),
    remove: async (ids) => {
      const yes = await confirm({
        title: `Delete ${ids.length} ${ids.length === 1 ? 'chat' : 'chats'}?`,
        message: 'The conversations and their workspaces are removed for good. This cannot be undone.',
        confirmLabel: 'Delete',
        icon: 'trash',
      });
      if (!yes) return null;
      return run(() => api.chats.removeMany(ids), "Couldn't delete those chats.");
    },
  };
}
