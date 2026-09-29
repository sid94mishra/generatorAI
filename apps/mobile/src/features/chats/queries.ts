import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys, type ApiClient } from '@generatorai/client-core';
import { useApi } from '../../services/api/useApi';
import type { MutationCallbacks } from '../../services/api/queryCallbacks';

type CreateChatBody = Parameters<ApiClient['chats']['create']>[0];
type CreatedChat = Awaited<ReturnType<ApiClient['chats']['create']>>;
type UpdatedChat = Awaited<ReturnType<ApiClient['chats']['update']>>;
type RemovedChat = Awaited<ReturnType<ApiClient['chats']['remove']>>;

export function useChats() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.chats(), queryFn: () => api.chats.list({ limit: 200 }) });
}
export function useCreateChat(callbacks: MutationCallbacks<CreatedChat, CreateChatBody>) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({ ...callbacks, mutationFn: (body: CreateChatBody) => api.chats.create(body), onSuccess: (...args) => {
    void client.invalidateQueries({ queryKey: queryKeys.chats() });
    return callbacks.onSuccess?.(...args);
  } });
}
export function useSetChatStatus(callbacks: MutationCallbacks<UpdatedChat, { id: string; status: string }>) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({ ...callbacks, mutationFn: ({ id, status }: { id: string; status: string }) => api.chats.update(id, { status }), onSuccess: (...args) => {
    void client.invalidateQueries({ queryKey: queryKeys.chats() });
    return callbacks.onSuccess?.(...args);
  } });
}
export function useRenameChat(callbacks: MutationCallbacks<UpdatedChat, { id: string; name: string }>) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({ ...callbacks, mutationFn: ({ id, name }: { id: string; name: string }) => api.chats.update(id, { name }), onSuccess: (...args) => {
    void client.invalidateQueries({ queryKey: queryKeys.chats() });
    return callbacks.onSuccess?.(...args);
  } });
}
export function useRemoveChat(callbacks: MutationCallbacks<RemovedChat, string>) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({ ...callbacks, mutationFn: (id: string) => api.chats.remove(id), onSuccess: (...args) => {
    void client.invalidateQueries({ queryKey: queryKeys.chats() });
    return callbacks.onSuccess?.(...args);
  } });
}
export function useRemoveChats(callbacks: MutationCallbacks<{ failedIds: string[]; total: number }, string[]>) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({ ...callbacks, mutationFn: async (ids: string[]) => {
    const result = await api.chats.removeMany(ids);
    return { failedIds: result.failed.map((failed) => failed.id), total: ids.length };
  }, onSuccess: (...args) => {
    void client.invalidateQueries({ queryKey: queryKeys.chats() });
    return callbacks.onSuccess?.(...args);
  } });
}
