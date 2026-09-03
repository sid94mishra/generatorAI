// ────────────────────────────────────────────────────────────────
// QueryProvider — TanStack React Query configuration
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { ApiError } from '@/platform/apiFetch.js';
import { globalSingleton } from '../lib/globalSingleton.js';

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

// P1-51 — the global defaults, revisited.
//
// `staleTime: 0` meant EVERY query in the app was permanently stale. That is
// not a freshness policy, it is a licence to refetch: every remount refetched,
// and `refetchOnWindowFocus` turned a single alt-tab back into the app into a
// simultaneous refetch of every mounted query. Combined with the 21 polling
// `refetchInterval`s in `hooks/*` and the SSE invalidation path, the client
// asked the server for the same data several times per second.
//
// The window is short (5 s) and it does NOT delay live data: `invalidateQueries`
// marks an entry stale and refetches it regardless of `staleTime`, so the SSE
// path — which is how anything that actually changes reaches the client — is
// exactly as immediate as before. What the window suppresses is the duplicate
// refetch nobody asked for: a remount seconds after the last fetch, and the
// focus storm. Static resources still override with a 5-minute staleTime at
// their hook site; anything needing sub-5-second freshness without an event
// behind it must say so at its own call site, where the cost is visible.
const DEFAULT_STALE_TIME_MS = 5_000;

const queryClientImpl = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: DEFAULT_STALE_TIME_MS,
      gcTime: 5 * 60 * 1000,
      retry: retryUnlessClientError,
      // Kept on: it is the recovery path when the SSE connection died while
      // the tab was backgrounded. It is now bounded by `staleTime` instead of
      // firing for every query unconditionally.
      refetchOnWindowFocus: true,
    },
    mutations: {
      retry: 0,
    },
  },
});

export { DEFAULT_STALE_TIME_MS };

// HMR-split-proof: sseManager invalidates queries on this client, and the
// component tree reads from it. If Vite serves this module under two URLs
// they MUST still share one cache — see lib/globalSingleton.ts.
const queryClient = globalSingleton('web.queryClient', () => queryClientImpl);

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
