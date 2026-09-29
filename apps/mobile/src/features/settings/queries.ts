import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys, scmKeys, type ApiClient, type AdminApi } from '@generatorai/client-core';
import { useApi } from '../../services/api/useApi';
import { useAdminApi } from '../../services/api/useAdminApi';
import type { MutationCallbacks } from '../../services/api/queryCallbacks';
import { parseAudioSettings, type AudioSettings } from './audioModel';
import { toRow, type ExtensionRow } from './extensionModel';

export function useHealth(refetchInterval: number) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.health(), queryFn: () => api.health(), refetchInterval });
}

export function useProviders() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.providers(), queryFn: () => api.harness.providers() });
}

export function useProbeProviders() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.harness.providers(true),
    onSuccess: (data) => client.setQueryData(queryKeys.providers(), data),
  });
}

export function useDefaultProvider() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (type: string) => api.harness.setDefault(type),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.providers() });
      void client.invalidateQueries({ queryKey: ['harness', 'models'] });
    },
  });
}

const audioKey = ['system', 'audio'] as const;
export type AudioPatch = Partial<Pick<AudioSettings, 'sttEngine' | 'textFormatter' | 'endpointSilenceMs' | 'ttsEnabled' | 'ttsSpeed'>>;
export function useAudioSettings() {
  const api = useApi();
  return useQuery({
    queryKey: audioKey,
    queryFn: async () => {
      const parsed = parseAudioSettings(await api.system.audio());
      if (!parsed) throw new Error('Unexpected response');
      return parsed;
    },
  });
}

export function useSaveAudio(callbacks: MutationCallbacks<AudioSettings | null, AudioPatch, { previous: AudioSettings | undefined }>) {
  const admin = useAdminApi();
  const client = useQueryClient();
  return useMutation({
    ...callbacks,
    mutationFn: async (patch: AudioPatch) => parseAudioSettings(await admin.systemAdmin.setAudio(patch)),
    onMutate: async (patch) => {
      await client.cancelQueries({ queryKey: audioKey });
      const previous = client.getQueryData<AudioSettings>(audioKey);
      if (previous) client.setQueryData<AudioSettings>(audioKey, { ...previous, ...patch });
      return { previous };
    },
    onSuccess: (...args) => {
      if (args[0]) client.setQueryData(audioKey, args[0]);
      return callbacks.onSuccess?.(...args);
    },
    onError: (...args) => {
      if (args[2]?.previous) client.setQueryData(audioKey, args[2].previous);
      return callbacks.onError?.(...args);
    },
  });
}

export function useSourceControlSettings() {
  const { scm } = useApi();
  return useQuery({ queryKey: scmKeys.settings(), queryFn: () => scm.settings() });
}

type DefaultAccountResult = Awaited<ReturnType<ApiClient['scm']['setDefaultAccount']>>;
export function useDefaultScmAccount(callbacks: MutationCallbacks<DefaultAccountResult, string>) {
  const { scm } = useApi();
  const client = useQueryClient();
  return useMutation({
    ...callbacks,
    mutationFn: (id: string) => scm.setDefaultAccount(id),
    onSuccess: (...args) => {
      void client.invalidateQueries({ queryKey: scmKeys.settings() });
      return callbacks.onSuccess?.(...args);
    },
  });
}

export function useDisconnectScmAccount(callbacks: MutationCallbacks<void, string>) {
  const { scm } = useApi();
  const client = useQueryClient();
  return useMutation({
    ...callbacks,
    mutationFn: (id: string) => scm.disconnectAccount(id),
    onSuccess: (...args) => {
      void client.invalidateQueries({ queryKey: scmKeys.settings() });
      return callbacks.onSuccess?.(...args);
    },
  });
}

const extensionsKey = ['extensions'] as const;
export function useExtensions() {
  const admin = useAdminApi();
  return useQuery({
    queryKey: extensionsKey,
    queryFn: async () => ((await admin.extensions.list()) as unknown[]).map(toRow).filter((row): row is ExtensionRow => row !== null),
  });
}

type ExtensionUpdate = Awaited<ReturnType<AdminApi['extensions']['update']>>;
export function useToggleExtension(callbacks: MutationCallbacks<ExtensionUpdate, { id: string; enabled: boolean }>) {
  const admin = useAdminApi();
  const client = useQueryClient();
  return useMutation({
    ...callbacks,
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => admin.extensions.update(encodeURIComponent(id), { enabled }),
    onSettled: (...args) => {
      void client.invalidateQueries({ queryKey: extensionsKey });
      return callbacks.onSettled?.(...args);
    },
  });
}


export function useSystemArtifacts() {
  const api = useApi();
  return useQuery({ queryKey: ['system', 'artifacts'], queryFn: () => api.system.artifacts(), staleTime: 5 * 60_000 });
}
export function useSystemMcpServers() {
  const api = useApi();
  return useQuery({ queryKey: ['system', 'mcp-servers'], queryFn: () => api.system.mcpServers(), staleTime: 5 * 60_000 });
}
export function useSystemArtifactContent(id: string) {
  const api = useApi();
  return useQuery({ queryKey: ['system', 'artifacts', id], queryFn: () => api.system.artifactContent(id), enabled: Boolean(id) });
}

import { globalMcpToggle, type McpEntryLike } from './mcpModel';
type McpToggle = { server: McpEntryLike; enabled: boolean };
export function useToggleSystemMcp(callbacks: MutationCallbacks<void, McpToggle, { before: McpEntryLike[] | undefined }>) {
  const admin = useAdminApi();
  const client = useQueryClient();
  const key = ['system', 'mcp-servers'];
  return useMutation({
    ...callbacks,
    mutationFn: async ({ server, enabled }: McpToggle) => {
      const call = globalMcpToggle(server, enabled);
      if (!call) throw new Error('This server cannot be switched from here.');
      await admin.systemAdmin.updateMcp(call.source, call.id, call.body);
    },
    onMutate: async ({ server, enabled }) => {
      await client.cancelQueries({ queryKey: key });
      const before = client.getQueryData<McpEntryLike[]>(key);
      client.setQueryData<McpEntryLike[]>(key, (list) => list?.map((item) => item.id === server.id ? { ...item, userEnabled: enabled } : item));
      return { before };
    },
    onError: (...args) => {
      if (args[2]?.before) client.setQueryData(key, args[2].before);
      return callbacks.onError?.(...args);
    },
    onSettled: (...args) => {
      void client.invalidateQueries({ queryKey: key });
      return callbacks.onSettled?.(...args);
    },
  });
}
