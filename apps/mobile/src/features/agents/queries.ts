// Agents data (M7-03): the catalog (the wire rows are full agents; AgentListItem names what the list uses), one agent
// (MG-22 `api.agents.get`), where it is bound (usage), the effective capabilities (resolve-preview, MB-46), the import
// preview (MG-12) and every write (create / update / delete with force / export / import).
import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@generatorai/client-core';
import type { Agent, AgentImportPreviewRequest, CreateAgentParams, UpdateAgentParams } from '@generatorai/shared';

import { useAdminApi } from '../../services/api/useAdminApi';
import { useApi } from '../../services/api/useApi';
import type { AgentListItem, UsageLike } from './model/agentsModel';

const AGENTS_KEY = ['agents'] as const;

export function useAgents() {
  const api = useApi();
  return useQuery({ queryKey: [...AGENTS_KEY, 'all'] as const, meta: { persist: true }, queryFn: async () => (await api.agents.list()) as unknown as AgentListItem[] });
}

export function useSelectableAgents() {
  const api = useApi();
  return useQuery({ queryKey: [...AGENTS_KEY, 'selectable'] as const, meta: { persist: true }, queryFn: () => api.agents.selectable() });
}

export function useAgent(id: string) {
  const api = useApi();
  return useQuery({ queryKey: [...AGENTS_KEY, 'detail', id], queryFn: () => api.agents.get(id), enabled: Boolean(id) });
}

export function useAgentUsage(id: string, enabled = true) {
  const admin = useAdminApi();
  return useQuery({ queryKey: [...AGENTS_KEY, 'usage', id], queryFn: async () => (await admin.agents.usage(encodeURIComponent(id))) as unknown as UsageLike, enabled: Boolean(id) && enabled, retry: false });
}

export function useProjectsForAgents(enabled = true) {
  const api = useApi();
  return useQuery({ queryKey: [...queryKeys.projects(), 'summary'], meta: { persist: true }, queryFn: () => api.projects.list({ includeSummary: true }), enabled, staleTime: 60_000 });
}

export function useAgentCatalogs(projectId: string | null, enabled: boolean) {
  const api = useApi();
  const skills = useQuery({ queryKey: ['system', 'artifacts', 'skill'] as const, queryFn: () => api.system.artifacts('skill'), enabled, staleTime: 5 * 60_000 });
  const mcp = useQuery({ queryKey: ['system', 'mcp-servers'] as const, queryFn: () => api.system.mcpServers(), enabled, staleTime: 5 * 60_000 });
  const projectSkills = useQuery({
    queryKey: ['projects', projectId ?? '', 'available-artifacts', 'skill'],
    queryFn: () => api.projects.availableArtifacts(encodeURIComponent(projectId!), 'skill'),
    enabled: enabled && Boolean(projectId),
  });
  const skillList = useMemo(() => {
    const byId = new Map<string, { id: string; name: string }>();
    for (const s of [...(skills.data ?? []), ...(projectSkills.data ?? [])]) byId.set(s.id, { id: s.id, name: s.name });
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [skills.data, projectSkills.data]);
  const mcpList = useMemo(() => (mcp.data ?? []).map((m) => ({ id: m.id ?? m.name, name: m.name, needsKey: Boolean((m as { needsConfiguration?: boolean }).needsConfiguration) })), [mcp.data]);
  return { skills: skillList, mcp: mcpList, loading: skills.isLoading || mcp.isLoading };
}

export function useAgentWrites() {
  const admin = useAdminApi();
  const client = useQueryClient();
  const refresh = () => void client.invalidateQueries({ queryKey: AGENTS_KEY });
  return {
    create: (body: CreateAgentParams): Promise<Agent> => admin.agents.create(body).finally(refresh),
    update: (id: string, body: UpdateAgentParams): Promise<Agent> => admin.agents.update(encodeURIComponent(id), body).finally(refresh),
    remove: (id: string, force: boolean) => admin.agents.remove(encodeURIComponent(id), force).finally(refresh),
    export: async (id: string): Promise<string> => {
      const res = await admin.agents.export(encodeURIComponent(id));
      return typeof res === 'string' ? res : res.markdown;
    },
    import: (body: { markdown: string; scope: 'global' | 'project'; projectId?: string; overwrite: boolean }) => admin.agents.import(body).finally(refresh),
  };
}

/** MG-12 — what an import would create; keyed on the document so a re-pick re-asks. */
export function useImportPreview(body: AgentImportPreviewRequest | null) {
  const admin = useAdminApi();
  return useQuery({
    queryKey: [...AGENTS_KEY, 'import-preview', body?.scope, body?.projectId, body?.markdown.length, body?.markdown.slice(0, 200)],
    queryFn: () => admin.agents.importPreview(body!),
    enabled: body !== null,
    retry: false,
  });
}

export function useCreateAgent() {
  const writes = useAgentWrites();
  return useMutation({ mutationFn: writes.create });
}
