// ────────────────────────────────────────────────────────────────
// useApi — the typed API client, bound to the authenticated fetch.
//
// Memoised on the fetch identity so the client is stable across renders;
// an unstable client would make every TanStack query key churn.
// ────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { createApiClient, type ApiClient } from '@generatorai/client-core';

import { useAuth } from '../auth/AuthProvider';

export function useApi(): ApiClient {
  const { fetch } = useAuth();
  return useMemo(() => createApiClient(fetch), [fetch]);
}
