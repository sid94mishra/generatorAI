import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@generatorai/client-core';
import { useAdminApi } from '../../services/api/useAdminApi';
import type { MutationCallbacks } from '../../services/api/queryCallbacks';
import { parseScriptDetail, parseScriptProfiles, parseScriptRows } from './model';

export const scriptKeys = { all: () => ['workflow-scripts'] as const, detail: (id: string) => ['workflow-scripts', id] as const };

export function useScripts() {
  const admin = useAdminApi();
  return useQuery({ queryKey: scriptKeys.all(), queryFn: async () => parseScriptRows(await admin.scripts.list()), staleTime: 60_000 });
}

export function useScript(id: string) {
  const admin = useAdminApi();
  return useQuery({ queryKey: scriptKeys.detail(id), queryFn: async () => parseScriptDetail(await admin.scripts.get(id), id), enabled: id.length > 0 });
}

export function useScriptProfiles(id: string) {
  const admin = useAdminApi();
  return useQuery({ queryKey: [...scriptKeys.detail(id), 'profiles'], queryFn: async () => parseScriptProfiles(await admin.scripts.profiles(id)), enabled: id.length > 0 });
}

type ScriptInvocation = { variables: Record<string, unknown>; profile: string | null; projectId: string | null; idempotencyKey: string };

export function useRunScript(id: string, callbacks: MutationCallbacks<string, ScriptInvocation>) {
  const admin = useAdminApi();
  const client = useQueryClient();
  return useMutation({
    ...callbacks,
    mutationFn: async ({ variables, profile, projectId, idempotencyKey }: ScriptInvocation) => {
      const invocation = await admin.workflows.invoke({
        target: { kind: 'script', scriptId: id }, variables,
        ...(profile ? { profile } : {}), ...(projectId ? { projectId } : {}), client: 'mobile',
      }, { idempotencyKey });
      return invocation.runId;
    },
    onSuccess: (...args) => {
      void client.invalidateQueries({ queryKey: queryKeys.runs() });
      void client.invalidateQueries({ queryKey: queryKeys.workflows() });
      return callbacks.onSuccess?.(...args);
    },
  });
}
