import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys, scmKeys, type AgentSummary, type ApiClient, type AdminApi } from '@generatorai/client-core';
import type { HarnessProviderStatus, HarnessProvidersResponse, McpServerBody, SystemMcpPrefsBody } from '@generatorai/shared';
import { useApi } from '../../services/api/useApi';
import { useAdminApi } from '../../services/api/useAdminApi';
import type { MutationCallbacks } from '../../services/api/queryCallbacks';
import { parseAudioSettings, type AudioSettings } from './audioModel';
import { toRow, type ExtensionRow } from './extensionModel';
import { globalMcpToggle, type McpEntryLike } from './mcpModel';

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

export function useSystemInfo() {
  const api = useApi();
  return useQuery({ queryKey: ['system', 'info'], meta: { persist: true }, queryFn: () => api.system.info(), refetchInterval: 30_000 });
}

// ── M7-05: providers, agents, skills, MCP, templates ─────────────────────────────────────────────────────────────

/** Re-probe until `stale` clears (the server answers from its snapshot while it re-probes). */
export function useProvidersLive() {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.providers(),
    queryFn: () => api.harness.providers(),
    refetchInterval: (q) => ((q.state.data as HarnessProvidersResponse | undefined)?.stale ? 3_000 : false),
  });
}

export type ProviderOutcome = { ok: boolean; message: string };

/** "Test connection" / "Test all": a forced re-probe, stored as the list. */
export function useTestProviders() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (provider: HarnessProviderStatus | null): Promise<ProviderOutcome> => {
      const fresh = await api.harness.providers(true);
      client.setQueryData(queryKeys.providers(), fresh);
      if (!provider) {
        const ready = fresh.providers.filter((p) => p.ready);
        return { ok: true, message: ready.length ? `${ready.length} connected: ${ready.map((p) => p.label).join(', ')}` : 'No providers are connected.' };
      }
      const me = fresh.providers.find((p) => p.type === provider.type);
      if (me?.ready) return { ok: true, message: `${me.label} connected — ${me.modelCount} model${me.modelCount === 1 ? '' : 's'} available.` };
      return { ok: false, message: `${provider.label} is not connected${me?.error ? `: ${me.error}` : '.'}` };
    },
  });
}

/** Sign in: open the provider's own browser flow (when it has one), then poll until it reports authenticated (≤ 3 min). */
export function useProviderSignIn(openUrl: (url: string) => Promise<void>) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (provider: HarnessProviderStatus): Promise<ProviderOutcome> => {
      const body = await api.harness.login(provider.type);
      if (body.authUrl) await openUrl(body.authUrl);
      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline) {
        const fresh = await api.harness.providers(true).catch(() => null);
        if (fresh) {
          const me = fresh.providers.find((p) => p.type === provider.type);
          if (me?.authenticated) {
            client.setQueryData(queryKeys.providers(), fresh);
            return { ok: true, message: `${provider.label} signed in — ${me.modelCount} model${me.modelCount === 1 ? '' : 's'} available.` };
          }
          client.setQueryData(queryKeys.providers(), fresh);
        }
        if (!body.authUrl) break;
        await new Promise((r) => setTimeout(r, 4_000));
      }
      return { ok: false, message: body.authUrl ? `${provider.label} did not report a finished sign-in. Finish it in the browser, then test the connection.` : `${provider.label} could not be signed in from here. Sign in on the server with its CLI.` };
    },
  });
}

export function useProviderSignOut() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (type: string) => api.harness.logout(type),
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.providers() }),
  });
}

export function useAgentSummaries() {
  const api = useApi();
  // Same key as the Agents module, so either screen warms the other.
  return useQuery({ queryKey: ['agents', 'all'] as const, meta: { persist: true }, queryFn: async () => (await api.agents.list()) as AgentSummary[] });
}

export function useMcpServers() {
  const api = useApi();
  return useQuery({ queryKey: ['system', 'mcp-servers'], queryFn: async () => (await api.system.mcpServers()) as unknown as McpEntryLike[], staleTime: 60_000 });
}

export function useMcpWrites() {
  const admin = useAdminApi();
  const client = useQueryClient();
  const settle = (): Promise<void> => client.invalidateQueries({ queryKey: ['system', 'mcp-servers'] });
  return {
    setup: async (id: string, body: SystemMcpPrefsBody) => {
      await admin.systemAdmin.setSystemMcp(id, body);
      await settle();
    },
    addCustom: async (body: McpServerBody) => {
      const made = await admin.systemAdmin.addCustomMcp(body);
      await settle();
      return made;
    },
    updateCustom: async (id: string, body: McpServerBody) => {
      await admin.systemAdmin.updateCustomMcp(id, body);
      await settle();
    },
    removeCustom: async (id: string) => {
      await admin.systemAdmin.removeCustomMcp(id);
      await settle();
    },
    addToProject: async (projectId: string, body: McpServerBody) => {
      await admin.projects.mcp.add(projectId, body as unknown as Record<string, unknown>);
      await client.invalidateQueries({ queryKey: queryKeys.projects() });
    },
  };
}

export function useTemplates() {
  const admin = useAdminApi();
  return useQuery({ queryKey: ['templates'], queryFn: () => admin.templates.list(), staleTime: 5 * 60_000 });
}

export function useUseTemplate() {
  const admin = useAdminApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (templateId: string) => admin.definitions.importTemplate(templateId),
    onSuccess: () => void client.invalidateQueries({ queryKey: queryKeys.workflows() }),
  });
}

export interface ComputerUseStatus {
  enabled: boolean;
  allowSynthetic?: boolean;
  killSwitch?: boolean;
  skillId?: string;
  runtime?: { state?: string; detail?: string; message?: string; [key: string]: unknown };
}

export function useComputerUseStatus() {
  const api = useApi();
  return useQuery({ queryKey: ['system', 'computer-use'], queryFn: async () => (await api.system.computerUse()) as ComputerUseStatus });
}

export interface RetentionPrefs {
  enabled: boolean;
  retentionDays: number;
  minDays: number;
  maxDays: number;
}

export function useRetention() {
  const admin = useAdminApi();
  return useQuery({ queryKey: ['system', 'workspace-retention'], queryFn: async () => (await admin.systemAdmin.workspaceRetention()) as unknown as RetentionPrefs, retry: false });
}
