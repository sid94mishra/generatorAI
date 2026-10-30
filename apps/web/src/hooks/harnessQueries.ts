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
import type {
  HarnessProvidersResponse,
  HarnessProviderStatus,
  HarnessVisibilityResponse,
  HarnessVisibilityUpdate,
} from '@generatorai/shared';
import { usePlatform } from '../providers/PlatformProvider.js';

export const HARNESS_PROVIDERS_KEY = ['harness-providers'] as const;
export const HARNESS_VISIBILITY_KEY = ['harness-visibility'] as const;

const HARNESS_PROVIDERS_STALE_POLL_MS = 3_000;
const HARNESS_PROVIDERS_INSTALL_POLL_MS = 1_500;
const HARNESS_PROVIDERS_STALE_TIME_MS = 5 * 60_000;

function useProvidersQuery<T>(select: (data: HarnessProvidersResponse) => T) {
  const platform = usePlatform();
  return useQuery({
    queryKey: HARNESS_PROVIDERS_KEY,
    queryFn: () => platform.getHarnessProviders(),
    staleTime: HARNESS_PROVIDERS_STALE_TIME_MS,
    refetchOnWindowFocus: false,
    // A CLI download in flight is followed closely: its progress, then the provider coming up.
    refetchInterval: (query) =>
      query.state.data?.providers.some((p) => p.installing)
        ? HARNESS_PROVIDERS_INSTALL_POLL_MS
        : query.state.data?.stale
          ? HARNESS_PROVIDERS_STALE_POLL_MS
          : false,
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

/** Start downloading a provider's CLI (Copilot); the providers query then polls its progress. */
export function useInstallProvider() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (type: string) => platform.installProvider(type),
    meta: { errorTitle: 'Download not started' },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: HARNESS_PROVIDERS_KEY }),
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

/** Outcome of a "Test connection" / sign-in action (Settings › Model providers, F-settings-04). */
export interface ProviderActionResult {
  ok: boolean;
  message: string;
}

/** Re-probe every provider and report how many are now ready ("Test all connections"). */
export function useTestAllProviders() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<ProviderActionResult> => {
      const fresh = await platform.getHarnessProviders({ refresh: true });
      storeProviders(queryClient, fresh);
      const ready = fresh.providers.filter((p) => p.ready);
      return {
        ok: true,
        message:
          ready.length > 0
            ? `${ready.length} provider${ready.length === 1 ? '' : 's'} connected: ${ready.map((p) => p.label).join(', ')}`
            : 'No providers are currently connected.',
      };
    },
  });
}

/** Re-probe one provider ("Test connection" on its row). */
export function useTestProviderConnection() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (provider: HarnessProviderStatus): Promise<ProviderActionResult> => {
      const fresh = await platform.getHarnessProviders({ refresh: true });
      storeProviders(queryClient, fresh);
      const me = fresh.providers.find((p) => p.type === provider.type);
      if (me?.ready) return { ok: true, message: `${me.label} connected — ${me.modelCount} model${me.modelCount === 1 ? '' : 's'} available.` };
      return { ok: false, message: `${provider.label} is not connected${me?.error ? `: ${me.error}` : '.'}` };
    },
  });
}

/**
 * Start a provider's sign-in and poll until it reports authenticated (≤ 3
 * minutes) or, for a CLI-only provider with no browser step, give up after
 * one probe (D-55, G-09).
 */
export function useSignInProvider() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (provider: HarnessProviderStatus): Promise<ProviderActionResult> => {
      const body = await platform.loginProvider(provider.type);
      if (body.authUrl) window.open(body.authUrl, '_blank', 'noopener,noreferrer');
      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, body.authUrl ? 4_000 : 1_000));
        const fresh = await platform.getHarnessProviders({ refresh: true }).catch(() => null);
        if (!fresh) continue;
        const me = fresh.providers.find((p) => p.type === provider.type);
        if (me?.authenticated) {
          storeProviders(queryClient, fresh);
          return { ok: true, message: `${provider.label} signed in — ${me.modelCount} model${me.modelCount === 1 ? '' : 's'} available.` };
        }
        if (!body.authUrl) break;
      }
      return body.authUrl
        ? { ok: false, message: `${provider.label} did not report a completed sign-in. Finish the browser flow and press Test connection.` }
        : { ok: false, message: `${provider.label} could not be signed in.` };
    },
  });
}

/** Which providers this server serves (D-131) — Settings › Model providers › Experimental providers. */
export function useHarnessVisibility() {
  const platform = usePlatform();
  return useQuery({
    queryKey: HARNESS_VISIBILITY_KEY,
    queryFn: () => platform.getHarnessVisibility(),
    refetchOnWindowFocus: false,
  });
}

/**
 * Reveal or hide providers (admin:harnesses). The server applies it at once and
 * re-probes, so the provider list is refetched: a revealed provider appears in
 * every picker, a hidden one disappears.
 */
export function useSetHarnessVisibility() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (update: HarnessVisibilityUpdate) => platform.setHarnessVisibility(update),
    onSuccess: (data: HarnessVisibilityResponse) => {
      queryClient.setQueryData(HARNESS_VISIBILITY_KEY, data);
      void queryClient.invalidateQueries({ queryKey: HARNESS_PROVIDERS_KEY });
    },
  });
}
