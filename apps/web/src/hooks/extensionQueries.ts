// ────────────────────────────────────────────────────────────────
// Extension hooks (F-settings-13) — install (by path), enable/disable,
// uninstall and hot-reload. All operations take effect immediately on the
// server; enable/disable is applied optimistically with rollback so the
// switch never lags a click.
// ────────────────────────────────────────────────────────────────

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InstallExtensionParams, InstalledExtension } from '@generatorai/shared';
import { usePlatform } from '../providers/PlatformProvider.js';

export const extensionKeys = {
  list: ['extensions'] as const,
};

export function useExtensions() {
  const platform = usePlatform();
  return useQuery({
    queryKey: extensionKeys.list,
    queryFn: () => platform.getExtensions(),
  });
}

export function useInstallExtension() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: InstallExtensionParams) => platform.installExtension(params),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: extensionKeys.list }),
  });
}

export function useReloadExtensions() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => platform.reloadExtensions(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: extensionKeys.list }),
  });
}

export function useSetExtensionEnabled() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => platform.setExtensionEnabled(id, enabled),
    onMutate: async ({ id, enabled }) => {
      const previous = queryClient.getQueryData<InstalledExtension[]>(extensionKeys.list);
      queryClient.setQueryData<InstalledExtension[]>(extensionKeys.list, (current) =>
        current?.map((extension) => (extension.manifest.id === id ? { ...extension, enabled } : extension)),
      );
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(extensionKeys.list, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: extensionKeys.list }),
  });
}

export function useUninstallExtension() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => platform.uninstallExtension(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: extensionKeys.list }),
  });
}
