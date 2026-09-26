// ────────────────────────────────────────────────────────────────
// Agent-provider hooks (G-09) — provider readiness, model catalog, sign-in.
//
// One cache entry (`HARNESS_PROVIDERS_KEY`) backs every consumer: the flat
// catalog the composer reads (`useModels`), the provider list Settings shows
// (`useHarnessProviders`) and the picker's read model (`useModelPickerCatalog`,
// client-core's `buildModelPickerCatalog`: ready providers first, and a
// `defaultProvider` that is never one that is not ready). A cold probe spawns
// each provider's CLI on the server, so this is cached generously, never
// refetched on focus, and only re-probed on an explicit user action
// (`useRefreshHarnessProviders`).
//
// While the server answers from its snapshot (`stale: true`) the query polls
// every 3 s until the background re-probe lands, then stops.
// ────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { buildModelPickerCatalog, readyCatalogModels, type ModelPickerCatalog } from '@generatorai/client-core';
import type { HarnessProvidersResponse } from '@generatorai/shared';
import { usePlatform } from '../providers/PlatformProvider.js';

export const HARNESS_PROVIDERS_KEY = ['harness-providers'] as const;

const HARNESS_PROVIDERS_STALE_POLL_MS = 3_000;
const HARNESS_PROVIDERS_STALE_TIME_MS = 5 * 60_000;

function useProvidersQuery<T>(select: (data: HarnessProvidersResponse) => T) {
  const platform = usePlatform();
  return useQuery({
    queryKey: HARNESS_PROVIDERS_KEY,
    queryFn: () => platform.getHarnessProviders(),
    staleTime: HARNESS_PROVIDERS_STALE_TIME_MS,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => (query.state.data?.stale ? HARNESS_PROVIDERS_STALE_POLL_MS : false),
    select,
  });
}

const identity = (data: HarnessProvidersResponse): HarnessProvidersResponse => data;

/** Every provider's live status and catalog, as the server reports it. */
export function useHarnessProviders() {
  return useProvidersQuery(identity);
}

/** Every model of every READY provider, tagged with its provider (the composer's catalog). */
export function useModels() {
  return useProvidersQuery(readyCatalogModels);
}

/**
 * The model picker's read model: providers ready-first with why the others are
 * not usable, per-model details (tier, description, context, long context, max
 * output, reasoning levels, vision) and the provider to open on.
 */
export function useModelPickerCatalog() {
  const query = useHarnessProviders();
  const catalog = useMemo<ModelPickerCatalog | undefined>(
    () => (query.data ? buildModelPickerCatalog(query.data) : undefined),
    [query.data],
  );
  return { ...query, data: catalog };
}

function storeProviders(queryClient: QueryClient, data: HarnessProvidersResponse): void {
  queryClient.setQueryData(HARNESS_PROVIDERS_KEY, data);
}

/** Force a blocking re-probe of every provider (explicit refresh / "Test connection"). */
export function useRefreshHarnessProviders() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => platform.getHarnessProviders({ refresh: true }),
    onSuccess: (data) => storeProviders(queryClient, data),
  });
}

/**
 * Start a provider's sign-in. The caller opens `authUrl` when present and then
 * re-probes (`useRefreshHarnessProviders`) until the provider reports
 * `authenticated`; the sign-in completes in the browser, out of our sight.
 */
export function useProviderLogin() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (type: string) => platform.loginProvider(type),
    onSuccess: (result) => {
      if (result.completed) void queryClient.invalidateQueries({ queryKey: HARNESS_PROVIDERS_KEY });
    },
  });
}

/** Sign a provider out, then re-probe so every picker drops its models at once. */
export function useProviderLogout() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (type: string) => {
      await platform.logoutProvider(type);
      return platform.getHarnessProviders({ refresh: true });
    },
    onSuccess: (data) => storeProviders(queryClient, data),
  });
}

/** Make a READY provider the default for requests that name none (the server refuses others). */
export function useSetDefaultProvider() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (type: string) => platform.setDefaultProvider(type),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: HARNESS_PROVIDERS_KEY }),
  });
}
