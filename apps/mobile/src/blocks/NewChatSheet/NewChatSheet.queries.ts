// MB-06 data: selectable agents (scoped to the project), an agent's own policy (for the capabilities page), the
// projects and a project's codebases, the skill / MCP catalogues, and creating the chat then sending its task as
// the first message (MNewChat: "Sent as the first message").
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys, type ApiClient } from '@generatorai/client-core';

import { useApi } from '../../services/api/useApi';

type CreateBody = Parameters<ApiClient['chats']['create']>[0];

export function useSelectableAgents(projectId?: string) {
  const api = useApi();
  return useQuery({ queryKey: ['agents', 'selectable', projectId ?? ''] as const, meta: { persist: true }, queryFn: () => api.agents.selectable(projectId) });
}

export function useAgentDetail(id: string | null) {
  const api = useApi();
  return useQuery({ queryKey: ['agents', 'detail', id ?? ''] as const, queryFn: () => api.agents.get(id!), enabled: Boolean(id), staleTime: 60_000 });
}

export function useProjectsList() {
  const api = useApi();
  return useQuery({ queryKey: [...queryKeys.projects(), 'summary'], meta: { persist: true }, queryFn: () => api.projects.list({ includeSummary: true }), staleTime: 60_000 });
}

export function useProjectCodebases(projectId: string | undefined) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.codebases(projectId ?? ''), queryFn: () => api.projects.codebases(projectId!), enabled: Boolean(projectId) });
}

export function useSkillCatalog(enabled: boolean) {
  const api = useApi();
  return useQuery({ queryKey: ['system', 'artifacts', 'skill'] as const, queryFn: () => api.system.artifacts('skill'), enabled, staleTime: 5 * 60_000 });
}

export function useMcpCatalog(enabled: boolean) {
  const api = useApi();
  return useQuery({ queryKey: ['system', 'mcp-servers'] as const, queryFn: () => api.system.mcpServers(), enabled, staleTime: 5 * 60_000 });
}

/** Creates the chat, then sends the task; the chat exists even if the first send fails (the caller says so). */
export function useCreateChatWithTask() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ body, task }: { body: CreateBody; task: string }) => {
      const chat = await api.chats.create(body);
      let sent = true;
      if (task.trim()) {
        try {
          await api.chats.send(chat.id, { message: task.trim() });
        } catch {
          sent = false;
        }
      }
      return { chat, sent };
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: queryKeys.chats() }),
  });
}
