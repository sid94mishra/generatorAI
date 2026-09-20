import type { HarnessProviderId } from '@generatorai/shared';
// ────────────────────────────────────────────────────────────────
// TanStack Query hooks — first-class Agents
//
// The agent catalog is small and changes rarely, so lists are cached
// generously. `useResolveAgentPreview` is a MUTATION rather than a query:
// the editor previews an unsaved draft, and a draft has no stable cache
// identity — keying it would either thrash the cache or serve a stale
// projection for a body the user has since edited.
// ────────────────────────────────────────────────────────────────

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  AgentScope,
  AgentRole,
  AgentOverrides,
  CreateAgentParams,
  UpdateAgentParams,
  ResolvedAgentProjection,
} from '@generatorai/shared';
import { usePlatform } from '../providers/PlatformProvider.js';

export interface AgentListFilterUi {
  scope?: AgentScope;
  role?: AgentRole;
  projectId?: string;
  q?: string;
  enabledOnly?: boolean;
}

// ── Query Keys ──
export const agentKeys = {
  all: ['agents'] as const,
  list: (filter?: AgentListFilterUi) => ['agents', 'list', filter ?? {}] as const,
  selectable: (projectId?: string) => ['agents', 'selectable', projectId ?? ''] as const,
  detail: (id: string) => ['agents', 'detail', id] as const,
  usage: (id: string) => ['agents', 'usage', id] as const,
};

// ── Queries ──

export function useAgents(filter?: AgentListFilterUi) {
  const platform = usePlatform();
  return useQuery({
    queryKey: agentKeys.list(filter),
    queryFn: () => platform.listAgents(filter),
    staleTime: 30_000,
  });
}

/** Picker list — project agents shadow global, global shadows system. */
export function useSelectableAgents(projectId?: string, enabled = true) {
  const platform = usePlatform();
  return useQuery({
    queryKey: agentKeys.selectable(projectId),
    queryFn: () => platform.listSelectableAgents(projectId),
    staleTime: 30_000,
    enabled,
  });
}

export function useAgent(id: string | undefined) {
  const platform = usePlatform();
  return useQuery({
    queryKey: agentKeys.detail(id ?? ''),
    queryFn: () => platform.getAgent(id!),
    enabled: !!id,
  });
}

export function useAgentUsage(id: string | undefined) {
  const platform = usePlatform();
  return useQuery({
    queryKey: agentKeys.usage(id ?? ''),
    queryFn: () => platform.getAgentUsage(id!),
    enabled: !!id,
  });
}

// ── Mutations ──

export function useCreateAgent() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateAgentParams) => platform.createAgent(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentKeys.all });
    },
  });
}

export function useUpdateAgent() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, params }: { id: string; params: UpdateAgentParams }) =>
      platform.updateAgent(id, params),
    onSuccess: (agent) => {
      queryClient.invalidateQueries({ queryKey: agentKeys.all });
      queryClient.setQueryData(agentKeys.detail(agent.id), agent);
    },
  });
}

export function useDeleteAgent() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, force }: { id: string; force?: boolean }) =>
      platform.deleteAgent(id, force ?? false),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentKeys.all });
    },
  });
}

export function useImportAgent() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      markdown: string;
      scope?: AgentScope;
      projectId?: string;
      overwrite?: boolean;
    }) => platform.importAgent(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentKeys.all });
    },
  });
}

export function useExportAgent() {
  const platform = usePlatform();
  return useMutation({
    mutationFn: (id: string) => platform.exportAgent(id),
  });
}

/**
 * Effective-capability preview. Response is already redacted server-side.
 */
export function useResolveAgentPreview() {
  const platform = usePlatform();
  return useMutation<
    ResolvedAgentProjection,
    Error,
    {
      agentRef?: string;
      overrides?: AgentOverrides;
      projectId?: string;
      harnessType?: HarnessProviderId;
      scope: 'chat' | 'stage' | 'worker';
      draft?: Record<string, unknown>;
    }
  >({
    mutationFn: (body) => platform.resolveAgentPreview(body),
  });
}
