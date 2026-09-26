// ────────────────────────────────────────────────────────────────
// Agent-provider hooks — the G-09 web hooks.
//
// Pinned: one platform call backs the flat catalog, the provider list and the
// picker read model; the picker never opens on a provider that is not ready;
// `stale` keeps polling; refresh / sign-out write the fresh catalog into the
// shared cache; sign-in and set-default delegate to the platform client.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { HarnessProviderStatus, HarnessProvidersResponse, IPlatformClient } from '@generatorai/shared';

import { PlatformContext } from '@/providers/PlatformProvider.js';
import {
  HARNESS_PROVIDERS_KEY,
  useHarnessProviders,
  useModelPickerCatalog,
  useModels,
  useProviderLogin,
  useProviderLogout,
  useRefreshHarnessProviders,
  useSetDefaultProvider,
} from '@/hooks/harnessQueries.js';
import { MockPlatformClient } from '../helpers/MockPlatformClient.js';

function provider(type: string, ready: boolean): HarnessProviderStatus {
  return {
    type,
    label: type,
    installed: true,
    connected: ready,
    authenticated: ready,
    ready,
    modelCount: ready ? 1 : 0,
    models: ready ? [{ id: `${type}-m`, name: `${type} model`, category: 'versatile' }] : [],
    supportsLogin: !ready,
  };
}

const SIGNED_OUT_PRIMARY: HarnessProvidersResponse = {
  primary: 'copilot',
  stale: false,
  providers: [provider('copilot', false), provider('claude-agent', true)],
};

function setup(response: HarnessProvidersResponse = SIGNED_OUT_PRIMARY) {
  const platform = new MockPlatformClient();
  platform.getHarnessProviders.mockResolvedValue(response);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <PlatformContext.Provider value={platform as unknown as IPlatformClient}>{children}</PlatformContext.Provider>
    </QueryClientProvider>
  );
  return { platform, queryClient, wrapper };
}

describe('provider queries', () => {
  it('share one request between the provider list, the flat catalog and the picker', async () => {
    const { platform, wrapper } = setup();
    const { result } = renderHook(
      () => ({ providers: useHarnessProviders(), models: useModels(), picker: useModelPickerCatalog() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.picker.data).toBeDefined());
    expect(platform.getHarnessProviders).toHaveBeenCalledTimes(1);
    expect(platform.getHarnessProviders).toHaveBeenCalledWith();
    expect(result.current.providers.data?.primary).toBe('copilot');
    expect(result.current.models.data?.map((m) => [m.id, m.provider])).toEqual([['claude-agent-m', 'claude-agent']]);
  });

  it('never opens the picker on the configured provider while it is signed out', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useModelPickerCatalog(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    const catalog = result.current.data!;
    expect(catalog.defaultProvider).toBe('claude-agent');
    expect(catalog.providers.map((p) => [p.type, p.availability])).toEqual([
      ['claude-agent', 'ready'],
      ['copilot', 'signed_out'],
    ]);
    expect(catalog.models[0]).toMatchObject({ id: 'claude-agent-m', tier: 'versatile' });
  });

  it('keeps polling while the server says its answer is stale', async () => {
    const { platform, wrapper } = setup({ ...SIGNED_OUT_PRIMARY, stale: true });
    renderHook(() => useHarnessProviders(), { wrapper });
    await waitFor(() => expect(platform.getHarnessProviders.mock.calls.length).toBeGreaterThanOrEqual(2), {
      timeout: 5_000,
    });
  });
});

describe('provider mutations', () => {
  it('refresh forces a re-probe and stores the fresh catalog in the shared cache', async () => {
    const { platform, queryClient, wrapper } = setup();
    const fresh = { ...SIGNED_OUT_PRIMARY, providers: [provider('copilot', true)] };
    platform.getHarnessProviders.mockResolvedValueOnce(fresh);
    const { result } = renderHook(() => useRefreshHarnessProviders(), { wrapper });
    await act(() => result.current.mutateAsync());
    expect(platform.getHarnessProviders).toHaveBeenCalledWith({ refresh: true });
    expect(queryClient.getQueryData(HARNESS_PROVIDERS_KEY)).toEqual(fresh);
  });

  it('sign-out re-probes so no picker keeps the signed-out models', async () => {
    const { platform, queryClient, wrapper } = setup();
    const after = { ...SIGNED_OUT_PRIMARY, providers: [provider('claude-agent', false)] };
    platform.getHarnessProviders.mockResolvedValueOnce(after);
    const { result } = renderHook(() => useProviderLogout(), { wrapper });
    await act(() => result.current.mutateAsync('claude-agent'));
    expect(platform.logoutProvider).toHaveBeenCalledWith('claude-agent');
    expect(platform.getHarnessProviders).toHaveBeenCalledWith({ refresh: true });
    expect(queryClient.getQueryData(HARNESS_PROVIDERS_KEY)).toEqual(after);
  });

  it('sign-in returns the browser URL; set-default delegates', async () => {
    const { platform, wrapper } = setup();
    platform.loginProvider.mockResolvedValueOnce({ authUrl: 'https://auth.example' });
    const { result } = renderHook(() => ({ login: useProviderLogin(), setDefault: useSetDefaultProvider() }), {
      wrapper,
    });
    await expect(act(() => result.current.login.mutateAsync('codex'))).resolves.toEqual({
      authUrl: 'https://auth.example',
    });
    await act(() => result.current.setDefault.mutateAsync('claude-agent'));
    expect(platform.setDefaultProvider).toHaveBeenCalledWith('claude-agent');
  });
});
