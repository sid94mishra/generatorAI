// MB-02 Turn sheet data: the chat (its model, mode and harness options), the provider catalogue (G-09), the live
// context usage, and the PATCH that applies the sheet on Done.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { buildModelPickerCatalog, queryKeys, type AgentMode, type ModelPickerCatalog } from '@generatorai/client-core';

import { useApi } from '../../services/api/useApi';
import { useProviders } from '../../services/api/useModels';
import { useStreamStore } from '../../services/stream/streamStore';

export function useTurnChat(chatId: string) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.chat(chatId), queryFn: () => api.chats.get(chatId), enabled: Boolean(chatId) });
}

export function useModelPickerCatalog(): { catalog: ModelPickerCatalog | null; loading: boolean; error: unknown; refresh: () => void } {
  const providers = useProviders();
  return {
    catalog: providers.data ? buildModelPickerCatalog(providers.data) : null,
    loading: providers.isLoading,
    error: providers.error,
    refresh: () => void providers.refetch(),
  };
}

export function useLiveContextUsage(streamKey: string) {
  return useStreamStore((s) => s.streams[streamKey]?.contextUsage ?? null);
}

export interface TurnPatch {
  model: string;
  defaultAgentMode: AgentMode;
  permissionMode: string;
  harnessConfig: Record<string, unknown>;
}

export function useApplyTurn(chatId: string) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: TurnPatch) => api.chats.update(chatId, patch as Parameters<typeof api.chats.update>[1]),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: queryKeys.chat(chatId) });
      void client.invalidateQueries({ queryKey: queryKeys.chats() });
    },
  });
}
