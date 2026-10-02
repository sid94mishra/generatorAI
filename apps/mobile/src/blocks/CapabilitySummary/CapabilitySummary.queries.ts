// MB-46 data: `POST /agents/resolve-preview` for a saved agent (by ref) or an unsaved draft (debounced 400 ms).
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ResolvedAgentProjection } from '@generatorai/shared';

import { useAdminApi } from '../../services/api/useAdminApi';

export interface ResolvePreviewInput {
  agentRef?: string;
  draft?: Record<string, unknown>;
  projectId?: string;
  harnessType?: string;
  scope: string;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useResolvePreview(input: ResolvePreviewInput | null) {
  const admin = useAdminApi();
  const key = useDebounced(input ? JSON.stringify(input) : null, input?.draft ? 400 : 0);
  return useQuery({
    queryKey: ['agents', 'resolve-preview', key],
    queryFn: async () => (await admin.agents.resolvePreview(JSON.parse(key!) as ResolvePreviewInput & { scope: string })) as unknown as ResolvedAgentProjection,
    enabled: key !== null,
    retry: false,
    staleTime: 30_000,
  });
}
