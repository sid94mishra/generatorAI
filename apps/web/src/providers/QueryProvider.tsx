// ────────────────────────────────────────────────────────────────
// QueryProvider — TanStack React Query configuration
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { ApiError } from '@/platform/apiFetch.js';

/**
 * Retry transport failures, never the server's considered answer.
 *
 * A 4xx means the request itself was wrong — a missing file, a bad id, no
 * permission — and repeating it verbatim cannot change the outcome. It just
 * doubles the load and the console noise. 408 and 429 are the exceptions:
 * both explicitly invite a retry.
 */
function retryUnlessClientError(failureCount: number, error: unknown): boolean {
  if (
    error instanceof ApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408 &&
    error.status !== 429
  ) {
    return false;
  }
  return failureCount < 1;
}

// Phase 1, 1.22 — staleTime defaults split by query nature.
//
// Before: every query had `staleTime: 30_000`. That caused brief flashes
// of stale data after SSE-driven invalidations (invalidation marked the
// entry stale, but the 30s bucket meant the next refetch might not fire
// immediately). Going to `staleTime: 0` across the board works, but
// costs refetches on pure-static data (templates, definitions).
//
// Per-hook overrides are the real solution; the default here is 0 so
// forgetting an override is safe (fresh data > stale flash). Static
// resources override with a 5-minute staleTime at their hook site.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      gcTime: 5 * 60 * 1000,
      retry: retryUnlessClientError,
      refetchOnWindowFocus: true,
    },
    mutations: {
      retry: 0,
    },
  },
});

export { queryClient };

interface QueryProviderProps {
  children: React.ReactNode;
  client?: QueryClient;
}

export function QueryProvider({ children, client }: QueryProviderProps) {
  return (
     
    <QueryClientProvider client={client ?? queryClient}>
      {children as any}
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
