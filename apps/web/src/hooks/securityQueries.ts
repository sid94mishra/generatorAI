// ────────────────────────────────────────────────────────────────
// Security & devices hooks (F-settings-14; was the fetch layer of
// components/settings/sections/Security.tsx).
//
// Reads: the server's security posture, network exposure, paired devices
// (revoked included), open pairing grants and pending scope requests. Access
// requests arrive from other devices and nothing streams them, so every read
// re-polls every 30 s while the tab is visible (react-query pauses the
// interval in a background tab and refetches on focus).
//
// Mutations invalidate every read: one action (a pairing, a revoke) changes
// several of them.
// ────────────────────────────────────────────────────────────────

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../platform/apiFetch.js';
import { desktopServer } from '../lib/desktop.js';

/** `GET /api/auth/devices` row. The server omits key material on purpose. */
export interface DeviceSummary {
  deviceId: string;
  name: string;
  platform: 'web' | 'desktop' | 'cli' | 'mobile' | 'other';
  scopes: string[];
  createdAt: number;
  lastSeenAt: number | null;
  lastSeenTransport: string | null;
  revokedAt: number | null;
  revokedReason: string | null;
  credentialVersion: number;
  connectionMode: string;
  relayBound: boolean;
}

/** `GET /api/auth/pair/pending` row. */
export interface PendingPairing {
  grantId: string;
  deviceName: string | null;
  platform: string;
  requestedScopes: string[];
  createdAt: number;
  expiresAt: number;
  attempts: number;
  maxAttempts: number;
}

/** `POST /api/auth/pair` response. */
export interface PairingResponse {
  grantId: string;
  expiresAt: number;
  requestedScopes: string[];
  serverId: string;
  pairingCode: string;
  pairingUrl: string;
  /** Human-typeable code, grouped for display (`4H7K-2M9P-XQ3T`). */
  shortCode: string;
  /** Origin the joining device should open in its browser. */
  joinUrl: string;
}

export interface NetworkEndpoint {
  origin: string;
  reachability: string;
  priority?: number;
  /** Host-only adapter (WSL/Hyper-V/Docker) that nothing off-box can reach. */
  virtual?: boolean;
}

/** `GET /api/security/network-access`. The server supports exactly these two modes (D-42). */
export interface NetworkAccess {
  mode: 'local-only' | 'network-accessible';
  /** What the listener is doing now; lags `mode` until a restart. */
  active: boolean;
  pendingRestart: boolean;
  bindHost: string;
  envOverride: string | null;
  blockers: { code: string; message: string }[];
  endpoints: NetworkEndpoint[];
}

/** `GET /api/security/posture`. */
export interface SecurityPosture {
  server: { hostId: string; bindHost: string; loopbackOnly: boolean; production: boolean; tokenAudience: string };
  authentication: { required: boolean; unauthenticatedLoopback: boolean; legacyApiKeyActive: boolean; dpopRequired: boolean };
  secretStore: { kind: string; secure: boolean; reason: string | null; supportsRotation: boolean };
  devices: { active: number; revoked: number; relayBound: number };
  relay: { enabled: boolean; clientAvailable: boolean; state: string; hostId: string | null };
  warnings: { code: string; severity: 'warn' | 'critical'; message: string }[];
}

/** `GET /api/auth/scope-requests?status=pending` row. */
export interface ScopeRequestSummary {
  requestId: string;
  deviceId: string;
  deviceName: string | null;
  platform: string | null;
  scopes: string[];
  reason: string | null;
  status: 'pending' | 'approved' | 'denied' | 'cancelled';
  createdAt: number;
}

export interface CreatePairingInput {
  platform: 'mobile' | 'web' | 'cli' | 'desktop';
  deviceName?: string;
  scopes?: string[];
  includeRelay?: boolean;
}

export const securityKeys = {
  all: ['security'] as const,
  posture: ['security', 'posture'] as const,
  network: ['security', 'network'] as const,
  devices: ['security', 'devices'] as const,
  pending: ['security', 'pending-pairings'] as const,
  requests: ['security', 'scope-requests'] as const,
};

const POLL_MS = 30_000;
const poll = { refetchInterval: POLL_MS, staleTime: 5_000 } as const;

/** One line for an error from these routes; a 403 names the missing scope. */
export function securityErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 403) {
    return 'This device does not have permission to manage security settings (admin:devices).';
  }
  return err instanceof Error ? err.message : String(err);
}

export function useSecurityPosture(): UseQueryResult<SecurityPosture> {
  return useQuery({ queryKey: securityKeys.posture, queryFn: () => apiFetch<SecurityPosture>('/api/security/posture'), ...poll });
}

export function useNetworkAccess(): UseQueryResult<NetworkAccess> {
  return useQuery({ queryKey: securityKeys.network, queryFn: () => apiFetch<NetworkAccess>('/api/security/network-access'), ...poll });
}

export function useDevices(): UseQueryResult<DeviceSummary[]> {
  return useQuery({
    queryKey: securityKeys.devices,
    queryFn: async () => (await apiFetch<{ devices: DeviceSummary[] }>('/api/auth/devices?includeRevoked=true')).devices,
    ...poll,
  });
}

export function usePendingPairings(): UseQueryResult<PendingPairing[]> {
  return useQuery({
    queryKey: securityKeys.pending,
    queryFn: async () => (await apiFetch<{ pending: PendingPairing[] }>('/api/auth/pair/pending')).pending,
    ...poll,
  });
}

export function useScopeRequests(): UseQueryResult<ScopeRequestSummary[]> {
  return useQuery({
    queryKey: securityKeys.requests,
    queryFn: async () =>
      (await apiFetch<{ requests: ScopeRequestSummary[] }>('/api/auth/scope-requests?status=pending')).requests,
    ...poll,
  });
}

function useSecurityMutation<TInput, TResult = unknown>(fn: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => queryClient.invalidateQueries({ queryKey: securityKeys.all }),
  });
}

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

/**
 * Change the network exposure. In the desktop shell the server is a child
 * process the app owns, so the restart the change needs happens at once; a
 * browser against a standalone server shows the pending-restart notice.
 */
export function useSetNetworkAccess() {
  return useSecurityMutation(async (mode: NetworkAccess['mode']) => {
    await apiFetch('/api/security/network-access', post({ mode }));
    if (desktopServer.canRestart()) await desktopServer.restart();
  });
}

export function useCreatePairing() {
  return useSecurityMutation((input: CreatePairingInput) => apiFetch<PairingResponse>('/api/auth/pair', post(input)));
}

export function useCancelPairing() {
  return useSecurityMutation((grantId: string) => apiFetch(`/api/auth/pair/${encodeURIComponent(grantId)}`, { method: 'DELETE' }));
}

export function useRevokeDevice() {
  return useSecurityMutation((deviceId: string) => apiFetch(`/api/auth/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' }));
}

/** Replace a device's scopes (the endpoint replaces, it does not merge). */
export function useSetDeviceScopes() {
  return useSecurityMutation(({ deviceId, scopes }: { deviceId: string; scopes: string[] }) =>
    apiFetch(`/api/auth/devices/${encodeURIComponent(deviceId)}/scopes`, { method: 'PUT', body: JSON.stringify({ scopes }) }),
  );
}

/** Approve a request; `scopes` narrows the grant to a subset (omitted = all asked for). */
export function useApproveScopeRequest() {
  return useSecurityMutation(({ requestId, scopes }: { requestId: string; scopes?: string[] }) =>
    apiFetch(`/api/auth/scope-requests/${encodeURIComponent(requestId)}/approve`, post(scopes ? { scopes } : {})),
  );
}

export function useDenyScopeRequest() {
  return useSecurityMutation((requestId: string) =>
    apiFetch(`/api/auth/scope-requests/${encodeURIComponent(requestId)}/deny`, post({})),
  );
}

/** Refetch every security read now (the section's Refresh). */
export function useRefreshSecurity(): () => void {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: securityKeys.all });
}

/** Restart the embedded server — only the desktop shell can (the Network exposure notice). */
export const canRestartServer = (): boolean => desktopServer.canRestart();
export function useRestartServer() {
  return useSecurityMutation(() => desktopServer.restart());
}
