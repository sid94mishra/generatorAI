// ────────────────────────────────────────────────────────────────
// useModels — the merged model catalogue.
//
// One shared query so the composer, the model sheet and the new-chat flow all
// read the same cache. A cold catalogue costs a CLI probe on the server
// (~13s), a warm one ~20ms, so it is cached aggressively and only refreshed
// on explicit user action.
//
// The pure parts live in `modelCatalogue.ts`; this file is only the React
// binding.
// ────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { queryKeys, type ModelInfo, type ProvidersResponse } from '@generatorai/client-core';

import { useApi } from './useApi';
import { groupModels, type ModelGroup } from './modelCatalogue';

export {
  findModel,
  groupModels,
  promptLimit,
  reasoningEfforts,
  type ModelGroup,
} from './modelCatalogue';

export function useModels(): UseQueryResult<ModelInfo[]> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.models(),
    queryFn: () => api.models(),
    // The catalogue only changes when a provider is re-authenticated or the
    // server restarts. Re-probing on every mount would spawn CLIs for nothing.
    staleTime: 10 * 60_000,
  });
}

/**
 * The per-provider catalogue the picker browses.
 *
 * The flat `useModels` list cannot answer "is this provider signed in?" — a
 * provider with zero ready models is indistinguishable from one that simply
 * has none, and the picker has to tell the user which it is.
 */
export function useProviders(): UseQueryResult<ProvidersResponse> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.providers(),
    queryFn: () => api.harness.providers(),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

/** Groups a flat catalogue by provider for a sectioned picker. */
export function useModelGroups(models: ModelInfo[] | undefined): ModelGroup[] {
  return useMemo(() => groupModels(models), [models]);
}
