// MB-30 data: a worker's report (`GET …/background-tasks/:taskId` digest) and Cancel (G-20). The task list itself is
// the pane's shared `useBackgroundTasks` query (WorkspacePane), so the tab count and the list never disagree.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@generatorai/client-core';

import { useApi } from '../../services/api/useApi';
import { haptic } from '../../ui/platform/haptics';
import { toast } from '../../ui/primitives/Toast';

export function useTaskDigest(chatId: string, taskId: string, active: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...queryKeys.chatTasks(chatId), taskId, 'digest'],
    queryFn: () => api.chats.backgroundTaskDigest(chatId, taskId),
    staleTime: 5_000,
    subscribed: active,
  });
}

export function useCancelTask(chatId: string) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => api.chats.cancelBackgroundTask(chatId, taskId),
    onSuccess: () => {
      haptic('warning');
      void client.invalidateQueries({ queryKey: queryKeys.chatTasks(chatId) });
    },
    onError: (err) => {
      haptic('error');
      toast({ kind: 'error', message: err instanceof Error && err.message ? err.message : "Couldn't cancel that task." });
    },
  });
}
