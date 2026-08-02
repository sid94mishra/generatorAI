// ────────────────────────────────────────────────────────────────
// renderWithProviders — Test wrapper with all required providers
// ────────────────────────────────────────────────────────────────

import React from 'react';
import type { ReactElement } from 'react';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { PlatformContext } from '@/providers/PlatformProvider.js';
import { ThemeProvider } from '@/providers/ThemeProvider.js';
import { MockPlatformClient } from './MockPlatformClient.js';
import type { IPlatformClient } from '@generatorai/shared';

interface WrapperOptions {
  /** Custom platform client (defaults to MockPlatformClient) */
  platform?: IPlatformClient;
  /** Initial route entries for MemoryRouter */
  initialEntries?: string[];
  /** Custom QueryClient (defaults to a fresh no-retry client) */
  queryClient?: QueryClient;
}

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

export function renderWithProviders(
  ui: ReactElement,
  options: WrapperOptions & Omit<RenderOptions, 'wrapper'> = {},
): RenderResult & { platform: MockPlatformClient; queryClient: QueryClient } {
  const {
    platform = new MockPlatformClient(),
    initialEntries = ['/'],
    queryClient = createTestQueryClient(),
    ...renderOptions
  } = options;

  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <PlatformContext.Provider value={platform as unknown as IPlatformClient}>
            <MemoryRouter initialEntries={initialEntries}>
              {children as any}
            </MemoryRouter>
          </PlatformContext.Provider>
        </QueryClientProvider>
      </ThemeProvider>
    );
  }

  return {
    ...render(ui, { wrapper: Wrapper, ...renderOptions }),
    platform: platform as MockPlatformClient,
    queryClient,
  };
}

export { createTestQueryClient };
