import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { queryKeys } from '@generatorai/client-core';
import { useApi } from '../../services/api/useApi';

export function useChat(id: string, options: { enabled?: boolean; staleTime?: number } = {}) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.chat(id), queryFn: () => api.chats.get(id), ...options });
}
/**
 * MG-02 / MD-112: opening a chat sets its read mark (`PATCH {unread: false}`) each time the screen gains focus, so
 * the list's unread dot clears; a failure is silent (the dot simply stays).
 */
export function useMarkChatRead(id: string): void {
  const api = useApi();
  const client = useQueryClient();
  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      api.chats
        .setUnread(id, false)
        .then(() => client.invalidateQueries({ queryKey: queryKeys.chats() }))
        .catch(() => undefined);
    }, [api, client, id]),
  );
}

export function useChatPlans(id: string, enabled = true) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.chatPlans(id), queryFn: () => api.chats.plans(id), enabled });
}
export function useChatPlanContent(id: string, planId: string) {
  const api = useApi();
  return useQuery({ queryKey: [...queryKeys.chatPlans(id), planId, 'content'] as const, queryFn: () => api.chats.planContent(id, planId), enabled: Boolean(id && planId) });
}
export function useChatInteractions(id: string, options: { enabled?: boolean; refetchInterval?: number } = {}) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.chatInteractions(id), queryFn: () => api.chats.interactions(id), ...options });
}

export function useChatMessages(id: string, limit: number) {
  const api = useApi();
  return useQuery({ queryKey: [...queryKeys.chatMessages(id), limit], queryFn: () => api.chats.messages(id, { limit }) });
}
export function useChatProject(id: string | null) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.project(id ?? ''), queryFn: () => api.projects.get(id!), enabled: Boolean(id), staleTime: 60_000 });
}

import { useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, type ApiClient, type ChatSummary } from '@generatorai/client-core';
import type { MutationCallbacks } from '../../services/api/queryCallbacks';
import { useStreamStore } from '../../services/stream/streamStore';
import { toPlanDecision } from './gateActions';

export function useChatRefresh(id: string) {
  const client = useQueryClient();
  return useMemo(() => ({
    messages: () => client.invalidateQueries({ queryKey: queryKeys.chatMessages(id) }),
    decisions: () => {
      void client.invalidateQueries({ queryKey: queryKeys.chatPlans(id) });
      void client.invalidateQueries({ queryKey: queryKeys.chatInteractions(id) });
    },
  }), [client, id]);
}

type Prepared = Awaited<ReturnType<ApiClient['chats']['prepareWorkspace']>>;
export function usePrepareChatWorkspace(id: string, callbacks: MutationCallbacks<Prepared>) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({ ...callbacks, mutationFn: () => api.chats.prepareWorkspace(id), onSuccess: (...args) => {
    void client.invalidateQueries({ queryKey: queryKeys.chat(id) });
    return callbacks.onSuccess?.(...args);
  } });
}

export type ChatPatch = Parameters<ApiClient['chats']['update']>[1];
type Updated = Awaited<ReturnType<ApiClient['chats']['update']>>;
export function usePatchChat(id: string, callbacks: MutationCallbacks<Updated, ChatPatch, { previous: ChatSummary | undefined }>) {
  const api = useApi();
  const client = useQueryClient();
  const key = queryKeys.chat(id);
  return useMutation({ ...callbacks, mutationFn: (patch: ChatPatch) => api.chats.update(id, patch),
    onMutate: async (patch) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<ChatSummary>(key);
      if (previous) client.setQueryData<ChatSummary>(key, { ...previous, ...patch } as ChatSummary);
      return { previous };
    },
    onError: (...args) => {
      if (args[2]?.previous) client.setQueryData(key, args[2].previous);
      return callbacks.onError?.(...args);
    },
    onSettled: (...args) => {
      void client.invalidateQueries({ queryKey: key });
      void client.invalidateQueries({ queryKey: queryKeys.chats() });
      return callbacks.onSettled?.(...args);
    },
  });
}
export function useArchiveChat(id: string, callbacks: MutationCallbacks<Updated, 'archived' | 'active'>) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({ ...callbacks, mutationFn: (status: 'archived' | 'active') => api.chats.update(id, { status }), onSuccess: (...args) => {
    void client.invalidateQueries({ queryKey: queryKeys.chat(id) });
    void client.invalidateQueries({ queryKey: queryKeys.chats() });
    return callbacks.onSuccess?.(...args);
  } });
}
export function useCancelChat(id: string) {
  const api = useApi();
  return useMutation({ mutationFn: (options: { force: boolean; budgetSeconds: number }) => api.chats.cancel(id, options) });
}

type PlanDecisionInput = { planId: string; action: string; feedback?: string };
export function useDecideChatPlan(id: string, callbacks: MutationCallbacks<void, PlanDecisionInput>) {
  const api = useApi();
  const client = useQueryClient();
  const refresh = () => { void client.invalidateQueries({ queryKey: queryKeys.chatPlans(id) }); };
  return useMutation({ ...callbacks,
    mutationFn: ({ planId, action, feedback }: PlanDecisionInput) => api.chats.decidePlan(id, planId, toPlanDecision(action, feedback)),
    onSuccess: (...args) => { refresh(); return callbacks.onSuccess?.(...args); },
    onError: (...args) => {
      if (args[0] instanceof ApiError && args[0].status === 409) refresh();
      return callbacks.onError?.(...args);
    },
  });
}

type AnswerInput = { interactionId: string; answers: Record<string, string[]>; freeformResponse?: string };
type AnswerResult = Awaited<ReturnType<ApiClient['chats']['respond']>>;
export function useAnswerChatQuestion(id: string, streamKey: string, callbacks: MutationCallbacks<AnswerResult, AnswerInput> = {}) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({ ...callbacks,
    mutationFn: ({ interactionId, answers, freeformResponse }: AnswerInput) => api.chats.respond(id, interactionId, { answers, ...(freeformResponse ? { freeformResponse } : {}) }),
    onSuccess: (...args) => {
      useStreamStore.getState().applyEffects([{ op: 'answerQuestion', key: streamKey, ...args[1] }]);
      void client.invalidateQueries({ queryKey: queryKeys.chatInteractions(id) });
      return callbacks.onSuccess?.(...args);
    },
  });
}

type PermissionInput = { interactionId: string; behavior: 'allow' | 'deny'; message?: string };
type PermissionResult = Awaited<ReturnType<ApiClient['chats']['respondPermission']>>;
export function useResolveChatPermission(id: string, streamKey: string, callbacks: MutationCallbacks<PermissionResult, PermissionInput>) {
  const api = useApi();
  const client = useQueryClient();
  const refresh = () => { void client.invalidateQueries({ queryKey: queryKeys.chatInteractions(id) }); };
  return useMutation({ ...callbacks,
    mutationFn: ({ interactionId, behavior, message }: PermissionInput) => api.chats.respondPermission(id, interactionId, { behavior, ...(message ? { message } : {}) }),
    onSuccess: (...args) => {
      useStreamStore.getState().applyEffects([{ op: 'resolvePermission', key: streamKey, ...args[1] }]);
      refresh();
      return callbacks.onSuccess?.(...args);
    },
    onError: (...args) => {
      if (args[0] instanceof ApiError && args[0].status === 409) refresh();
      return callbacks.onError?.(...args);
    },
  });
}
