// ────────────────────────────────────────────────────────────────
// ACP agents (docs/acp, ACP-4…ACP-12) — the ACP Registry catalogue in
// Settings › Model providers: install / update / uninstall, enable, per-agent
// environment, sign-in, connection tests and custom agents (`/api/acp`).
//
// Every `/api/acp` mutation answers the full `AcpAgentsResponse`, so the
// list is replaced in one step. Enabling, signing in or changing an agent's
// environment changes which models the `acp` provider serves, so those also
// refetch the provider catalog (`HARNESS_PROVIDERS_KEY`) the pickers read.
//
// While any agent is installing the list polls (progress, then installed).
// ────────────────────────────────────────────────────────────────

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AcpAgentsResponse,
  AcpCustomAgentRequest,
  AcpTerminalAuthSpec,
  AcpTestResult,
} from '@generatorai/shared';
import { apiFetch } from '../platform/apiFetch.js';
import { HARNESS_PROVIDERS_KEY } from './harnessQueries.js';

export const ACP_AGENTS_KEY = ['acp-agents'] as const;

const INSTALL_POLL_MS = 1_500;

const agentPath = (id: string, tail: string) => `/api/acp/agents/${encodeURIComponent(id)}/${tail}`;
const send = (method: string, body?: unknown): RequestInit =>
  body === undefined ? { method } : { method, body: JSON.stringify(body) };

/**
 * An install is running, an enabled agent has not answered its first probe yet (it may say "Starting…"), or the
 * list came from the built-in copy while the server fetches the registry in the background.
 */
const settling = (data: AcpAgentsResponse | undefined): boolean =>
  (data?.registry.source === 'snapshot' && !data.registry.error) ||
  !!data?.agents.some((a) => a.installing || (a.enabled && a.status && !a.status.checkedAt && !a.status.connected));

const readyIds = (data: AcpAgentsResponse | undefined): string =>
  (data?.agents ?? []).filter((a) => a.status?.ready).map((a) => `${a.id}:${a.status?.modelCount ?? 0}`).join(',');

/** The registry catalogue, installed and custom agents, with live status. */
export function useAcpAgents() {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ACP_AGENTS_KEY,
    queryFn: async () => {
      const before = queryClient.getQueryData<AcpAgentsResponse>(ACP_AGENTS_KEY);
      const data = await apiFetch<AcpAgentsResponse>('/api/acp/agents');
      // An agent came up (or went away) while polling: the pickers' catalog follows.
      if (before && readyIds(before) !== readyIds(data)) void queryClient.invalidateQueries({ queryKey: HARNESS_PROVIDERS_KEY });
      return data;
    },
    refetchOnWindowFocus: false,
    refetchInterval: (query) => (settling(query.state.data) ? INSTALL_POLL_MS : false),
  });
}

/** A mutation answering the full list: store it, and refetch the provider catalog when the picker may change. */
function useAcpListMutation<V>(request: (vars: V) => Promise<AcpAgentsResponse>, refreshesProviders = true) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (data) => {
      queryClient.setQueryData(ACP_AGENTS_KEY, data);
      if (refreshesProviders) void queryClient.invalidateQueries({ queryKey: HARNESS_PROVIDERS_KEY });
    },
  });
}

/** Fetch the registry index now. */
export function useRefreshAcpRegistry() {
  return useAcpListMutation((_: void) => apiFetch<AcpAgentsResponse>('/api/acp/registry/refresh', send('POST')), false);
}

/** Install the registry's version (runs in the background; the list polls its progress). */
export function useInstallAcpAgent() {
  return useAcpListMutation((id: string) => apiFetch<AcpAgentsResponse>(agentPath(id, 'install'), send('POST')), false);
}

/** Update an installed agent to the registry's version. */
export function useUpdateAcpAgent() {
  return useAcpListMutation((id: string) => apiFetch<AcpAgentsResponse>(agentPath(id, 'update'), send('POST')));
}

/** Disable, stop and remove an installed agent. */
export function useUninstallAcpAgent() {
  return useAcpListMutation((id: string) => apiFetch<AcpAgentsResponse>(agentPath(id, 'install'), send('DELETE')));
}

/** Show or hide an agent's models in the model picker (it runs while enabled). */
export function useSetAcpAgentEnabled() {
  return useAcpListMutation(({ id, enabled }: { id: string; enabled: boolean }) =>
    apiFetch<AcpAgentsResponse>(agentPath(id, 'enabled'), send('PUT', { enabled })),
  );
}

/** Set (`string`) or remove (`null`) an agent's environment variables; values are write-only. */
export function useSetAcpAgentEnv() {
  return useAcpListMutation(({ id, env }: { id: string; env: Record<string, string | null> }) =>
    apiFetch<AcpAgentsResponse>(agentPath(id, 'env'), send('PUT', { env })),
  );
}

/** Sign in with an `agent` method; resolves when the agent finishes (it may open a browser). */
export function useAuthenticateAcpAgent() {
  return useAcpListMutation(({ id, methodId }: { id: string; methodId: string }) =>
    apiFetch<AcpAgentsResponse>(agentPath(id, 'authenticate'), send('POST', { methodId })),
  );
}

/** Sign an agent out (only when its status says it supports it). */
export function useLogoutAcpAgent() {
  return useAcpListMutation((id: string) => apiFetch<AcpAgentsResponse>(agentPath(id, 'logout'), send('POST')));
}

/** The exact command a `terminal` sign-in method runs (ACP-12: the user runs it in a terminal). */
export function useAcpTerminalAuth() {
  return useMutation({
    mutationFn: ({ id, methodId }: { id: string; methodId: string }) =>
      apiFetch<AcpTerminalAuthSpec>(agentPath(id, 'terminal-auth'), send('POST', { methodId })),
  });
}

/** Restart an agent's process and re-probe it (after a terminal sign-in). */
export function useReinitializeAcpAgent() {
  return useAcpListMutation((id: string) => apiFetch<AcpAgentsResponse>(agentPath(id, 'reinitialize'), send('POST')));
}

/** Start a separate, fresh connection to the agent and report what it answered. */
export function useTestAcpAgent() {
  return useMutation({
    mutationFn: (id: string) => apiFetch<AcpTestResult>(agentPath(id, 'test'), send('POST')),
  });
}

/** Add a custom agent (a typed command, ACP-10); it is enabled at once. */
export function useAddCustomAcpAgent() {
  return useAcpListMutation((request: AcpCustomAgentRequest) => apiFetch<AcpAgentsResponse>('/api/acp/custom', send('POST', request)));
}

/** Remove a custom agent and its stored environment. */
export function useRemoveCustomAcpAgent() {
  return useAcpListMutation((id: string) => apiFetch<AcpAgentsResponse>(`/api/acp/custom/${encodeURIComponent(id)}`, send('DELETE')));
}
