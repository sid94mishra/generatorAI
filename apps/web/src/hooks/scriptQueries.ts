// ────────────────────────────────────────────────────────────────
// TanStack Query hooks — Workflow Scripts
// ────────────────────────────────────────────────────────────────

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePlatform } from '../providers/PlatformProvider.js';

// ── Query Keys ──
export const scriptKeys = {
  scripts: ['scripts'] as const,
  script: (id: string) => ['script', id] as const,
  profiles: (id: string) => ['script-profiles', id] as const,
};

// ── Queries ──

export function useScripts() {
  const platform = usePlatform();
  return useQuery({
    queryKey: scriptKeys.scripts,
    queryFn: () => platform.listScripts(),
    staleTime: 30_000,
  });
}

export function useScript(id: string | undefined) {
  const platform = usePlatform();
  return useQuery({
    queryKey: scriptKeys.script(id ?? ''),
    queryFn: () => platform.getScript(id!),
    enabled: !!id,
  });
}

export function useScriptProfiles(id: string | undefined) {
  const platform = usePlatform();
  return useQuery({
    queryKey: scriptKeys.profiles(id ?? ''),
    queryFn: () => platform.getScriptProfiles(id!),
    enabled: !!id,
  });
}

// ── Mutations ──

export function useMaterializeScript() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, options }: { id: string; options?: { name?: string; projectId?: string } }) =>
      platform.materializeScript(id, options),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['definitions'] });
    },
  });
}

export function useReloadScripts() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => platform.reloadScripts(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scriptKeys.scripts });
    },
  });
}
