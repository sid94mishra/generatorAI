// ────────────────────────────────────────────────────────────────
// Scope requests — asking this server for more than the phone holds, and
// (on an admin phone) answering other devices' requests.
//
// Thin TanStack hooks over `@generatorai/client-core`, bound to the
// authenticated fetch like `useApi`. Contract (apps/server/src/routes/
// scopeRequests.ts):
//
//   POST   /api/auth/devices/me/scope-requests   {scopes, reason?}  → 201 request
//   GET    /api/auth/devices/me/scope-requests                      → {requests}
//   DELETE /api/auth/devices/me/scope-requests/:id                  → 204
//   GET    /api/auth/scope-requests?status=pending   (admin:devices) → {requests}
//   POST   /api/auth/scope-requests/:id/approve      {scopes?, note?}
//   POST   /api/auth/scope-requests/:id/deny         {note?}
//
// The request-creation sheet (`/scope-request`) posts the first shape; the
// Security screen renders "Pending since …" from the second and cancels
// with the third; an admin phone drives the last three.
// ────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createAdminApi,
  queryKeys,
  type DeviceScopeRequest,
} from '@generatorai/client-core';

import { useAuth } from '../auth/AuthProvider';
import { useApi } from './useApi';

export type { DeviceScopeRequest };

/** The open request among a device's own list, if any. */
export function pendingRequestOf(
  requests: readonly DeviceScopeRequest[] | undefined,
): DeviceScopeRequest | null {
  return requests?.find((request) => request.status === 'pending') ?? null;
}

/**
 * The most recent ANSWERED request. Shown so a phone that asked yesterday
 * learns it was denied (or approved — in which case "Check for new
 * permissions" is the next tap) instead of the request silently vanishing.
 */
export function lastResolvedRequestOf(
  requests: readonly DeviceScopeRequest[] | undefined,
): DeviceScopeRequest | null {
  return (
    requests?.find((request) => request.status === 'approved' || request.status === 'denied') ??
    null
  );
}

// ── This device ─────────────────────────────────────────────────

export function useMyScopeRequests(enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.myScopeRequests(),
    queryFn: () => api.auth.scopeRequests.mine(),
    enabled,
    // The answer arrives from another device; keep the "pending" row honest
    // even when the global lifecycle stream is not connected.
    refetchInterval: 30_000,
  });
}

export function useCreateScopeRequest() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { scopes: string[]; reason?: string }) =>
      api.auth.scopeRequests.create(body),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.myScopeRequests() }),
  });
}

export function useCancelScopeRequest() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) => api.auth.scopeRequests.cancel(requestId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.myScopeRequests() }),
  });
}

// ── Other devices (admin:devices) ───────────────────────────────

function useAdminApi() {
  const { fetch } = useAuth();
  return useMemo(() => createAdminApi(fetch), [fetch]);
}

/** Pass `enabled: false` unless the device holds `admin:devices` — a 403 is not a bug to render. */
export function usePendingScopeRequests(enabled: boolean) {
  const admin = useAdminApi();
  return useQuery({
    queryKey: queryKeys.pendingScopeRequests(),
    queryFn: () => admin.devices.scopeRequests.listPending(),
    enabled,
    refetchInterval: 30_000,
  });
}

export function useApproveScopeRequest() {
  const admin = useAdminApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { requestId: string; scopes?: string[]; note?: string }) =>
      admin.devices.scopeRequests.approve(params.requestId, {
        ...(params.scopes ? { scopes: params.scopes } : {}),
        ...(params.note ? { note: params.note } : {}),
      }),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.pendingScopeRequests() }),
        // The approved device's scopes changed; the devices list shows them.
        queryClient.invalidateQueries({ queryKey: queryKeys.devices() }),
      ]),
  });
}

export function useDenyScopeRequest() {
  const admin = useAdminApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { requestId: string; note?: string }) =>
      admin.devices.scopeRequests.deny(params.requestId, params.note ? { note: params.note } : {}),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.pendingScopeRequests() }),
  });
}
