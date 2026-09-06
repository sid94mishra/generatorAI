// ────────────────────────────────────────────────────────────────
// QueryProvider — TanStack React Query configuration
// ────────────────────────────────────────────────────────────────

import React from 'react';
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
  type Mutation,
  type Query,
} from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { ApiError } from '@/platform/apiFetch.js';
import { toast } from '@/components/Toast.js';
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

// ── Global error reporting ───────────────────────────────────────
//
// Review 5.8 / plan item 6: of ~90 `useMutation` sites, two declared an
// `onError`. Every other failed save looked exactly like a successful one —
// the request failed, nothing on screen changed, and the user carried on
// believing it had saved. One fallback on the cache fixes the whole class at
// once, and a per-mutation `onError` still wins where a specific message
// helps (the cache handler steps aside for it, see `shouldReportMutation`).
//
// Opt-outs are explicit and per call site: `meta: { silentError: true }` on a
// mutation or query whose failure is already surfaced inline. `meta.errorTitle`
// overrides the generic toast title.

/** `meta` keys the global handlers read. Declared here so call sites can't drift. */
export interface ErrorReportingMeta {
  /** The call site renders the failure itself — do not toast. */
  silentError?: boolean;
  /** Toast title override (default: "Action failed" / "Couldn't refresh"). */
  errorTitle?: string;
}

/**
 * The message a user should see for a failed request.
 *
 * Prefers the server's own message — an `ApiError` carries the body the route
 * sent — and falls back to a generic line only when nothing better exists.
 */
export function describeRequestError(error: unknown, fallback = 'The request failed.'): string {
  if (error instanceof ApiError) {
    if (error.message && error.message.trim()) return error.message;
    return `${fallback} (HTTP ${error.status})`;
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}

function readMeta(meta: unknown): ErrorReportingMeta {
  return (meta ?? {}) as ErrorReportingMeta;
}

/**
 * Should the global handler report this mutation's failure?
 *
 * No when the mutation declares its own `onError` (it has taken ownership of
 * the message), and no when the call site opted out via `meta.silentError`.
 */
export function shouldReportMutation(mutation: Pick<Mutation<unknown, unknown, unknown, unknown>, 'options'>): boolean {
  if (typeof mutation.options.onError === 'function') return false;
  if (readMeta(mutation.options.meta).silentError) return false;
  return true;
}

function onMutationError(
  error: unknown,
  _variables: unknown,
  _context: unknown,
  mutation: Mutation<unknown, unknown, unknown, unknown>,
): void {
  if (!shouldReportMutation(mutation)) return;
  toast({
    variant: 'error',
    title: readMeta(mutation.options.meta).errorTitle ?? 'Action failed',
    description: describeRequestError(error),
  });
}

/**
 * Query failures are reported only when they are BACKGROUND failures — a
 * refetch (poll, focus, invalidation) of data the page already shows. An
 * initial load that fails is the page's own error state to render, and
 * toasting it too would double-report every "not found" screen.
 *
 * Reported once per query, not once per attempt: a poll that keeps failing
 * every 5 s would otherwise stack an identical toast every 5 s. The latch
 * releases when the query next succeeds, so a later outage is reported again.
 */
function createQueryErrorReporter() {
  const reported = new Set<string>();
  return {
    onError(error: unknown, query: Query<unknown, unknown, unknown, readonly unknown[]>): void {
      if (readMeta(query.meta).silentError) return;
      // Nothing on screen yet — the page renders its own error state.
      if (query.state.data === undefined) return;
      if (reported.has(query.queryHash)) return;
      reported.add(query.queryHash);
      toast({
        variant: 'warning',
        title: readMeta(query.meta).errorTitle ?? "Couldn't refresh",
        description: `${describeRequestError(error)} Showing the last data received.`,
      });
    },
    onSuccess(_data: unknown, query: Query<unknown, unknown, unknown, readonly unknown[]>): void {
      reported.delete(query.queryHash);
    },
  };
}

/** Build the app's QueryClient. Exported so tests can construct isolated instances. */
export function createAppQueryClient(): QueryClient {
  const queryReporter = createQueryErrorReporter();
  return new QueryClient({
    mutationCache: new MutationCache({ onError: onMutationError }),
    queryCache: new QueryCache({
      onError: queryReporter.onError,
      onSuccess: queryReporter.onSuccess,
    }),
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
}

export { DEFAULT_STALE_TIME_MS };

// HMR-split-proof: sseManager invalidates queries on this client, and the
// component tree reads from it. If Vite serves this module under two URLs
// they MUST still share one cache — see lib/globalSingleton.ts.
const queryClient = globalSingleton('web.queryClient', createAppQueryClient);

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
