// Scripts data (M7-04): the loaded scripts, one script's metadata + compiled graph, its run profiles, run (one
// invocation with a `script` target; `write:workflows` + `exec:agent`), materialize (a Draft workflow) and reload.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@generatorai/client-core';

import { useAdminApi } from '../../services/api/useAdminApi';
import { useApi } from '../../services/api/useApi';
import { parseScriptProfiles } from './model';
import type { ScriptMeta } from './model/scriptView';

export const scriptKeys = { all: () => ['workflow-scripts'] as const, detail: (id: string) => ['workflow-scripts', id] as const };

export function useScripts() {
  const admin = useAdminApi();
  return useQuery({ queryKey: scriptKeys.all(), meta: { persist: true }, queryFn: async () => (await admin.scripts.list()) as unknown as ScriptMeta[], staleTime: 60_000 });
}

export function useScript(id: string) {
  const admin = useAdminApi();
  return useQuery({
    queryKey: scriptKeys.detail(id),
    queryFn: async () => {
      const raw = await admin.scripts.get(encodeURIComponent(id));
      return { meta: { ...(raw.metadata as unknown as ScriptMeta), id }, graph: raw.graph as unknown };
    },
    enabled: id.length > 0,
  });
}

export function useScriptProfiles(id: string) {
  const admin = useAdminApi();
  return useQuery({ queryKey: [...scriptKeys.detail(id), 'profiles'], queryFn: async () => parseScriptProfiles(await admin.scripts.profiles(encodeURIComponent(id))), enabled: id.length > 0 });
}

export function useProjectsList() {
  const api = useApi();
  return useQuery({ queryKey: [...queryKeys.projects(), 'summary'], meta: { persist: true }, queryFn: () => api.projects.list({ includeSummary: true }), staleTime: 60_000 });
}

export function useScriptWrites(id: string) {
  const admin = useAdminApi();
  const client = useQueryClient();
  return {
    materialize: (body: { name?: string; projectId?: string } = {}) => admin.scripts.materialize(encodeURIComponent(id), body).finally(() => void client.invalidateQueries({ queryKey: queryKeys.workflows() })),
    reloadAll: () => admin.scripts.reloadAll().finally(() => void client.invalidateQueries({ queryKey: scriptKeys.all() })),
  };
}

export function useRunScript(id: string) {
  const admin = useAdminApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { variables: Record<string, unknown>; profile: string | null; projectId: string | null; idempotencyKey: string }) =>
      admin.workflows.invoke(
        { target: { kind: 'script', scriptId: id }, variables: input.variables, ...(input.profile ? { profile: input.profile } : {}), ...(input.projectId ? { projectId: input.projectId } : {}), client: 'mobile' },
        { idempotencyKey: input.idempotencyKey },
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.runs() });
      void client.invalidateQueries({ queryKey: queryKeys.workflows() });
    },
  });
}
