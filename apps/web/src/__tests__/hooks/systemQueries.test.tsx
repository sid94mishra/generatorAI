// ────────────────────────────────────────────────────────────────
// System info hook (G-12) — the web wraps `platform.getSystemInfo()`
// (`HttpPlatformClient`, beyond the shared `IPlatformClient` surface — the
// same convention `listProjects` / `listSystemArtifacts` already use).
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { IPlatformClient, SystemInfo } from '@generatorai/shared';

import { PlatformContext } from '@/providers/PlatformProvider.js';
import { useSystemInfo } from '@/hooks/systemQueries.js';

const INFO: SystemInfo = {
  serverName: 'my-mac',
  serverVersion: '0.1.0',
  platform: 'darwin',
  uptimeSec: 1234,
  agents: { running: 1, max: 8 },
  database: { kind: 'sqlite', sizeBytes: 2048 },
  disk: { usedBytes: 100, totalBytes: 400 },
};

function setup() {
  const platform = { getSystemInfo: vi.fn().mockResolvedValue(INFO) };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <PlatformContext.Provider value={platform as unknown as IPlatformClient}>{children}</PlatformContext.Provider>
    </QueryClientProvider>
  );
  return { platform, wrapper };
}

describe('useSystemInfo', () => {
  it('reads the server info snapshot', async () => {
    const { platform, wrapper } = setup();
    const { result } = renderHook(() => useSystemInfo(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(platform.getSystemInfo).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual(INFO);
  });

  it('has no data until the platform call resolves — never an invented empty snapshot', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useSystemInfo(), { wrapper });
    expect(result.current.data).toBeUndefined();
  });
});
