// ────────────────────────────────────────────────────────────────
// Settings › Mobile devices (docs/devices DV-9): server-owned, because it
// decides whether agents get the `device_*` tools at all.
// ────────────────────────────────────────────────────────────────

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DeviceToolingStatus } from '@generatorai/shared';

export interface MobileDevicesSettings {
  enabled: boolean;
  androidSdkPath: string;
  tooling: DeviceToolingStatus[];
}

const KEY = ['mobile-devices-settings'] as const;

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      message = ((await res.json()) as { error?: { message?: string } }).error?.message ?? message;
    } catch {
      // not JSON
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export function useMobileDevicesSettings(options: { fresh?: boolean; enabled?: boolean } = {}) {
  return useQuery<MobileDevicesSettings>({
    queryKey: [...KEY, options.fresh === true],
    queryFn: async () => readJson(await fetch(`/api/system/mobile-devices${options.fresh ? '?fresh=1' : ''}`)),
    staleTime: 30_000,
    enabled: options.enabled ?? true,
  });
}

export function useSetMobileDevicesSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: { enabled?: boolean; androidSdkPath?: string }) =>
      readJson<MobileDevicesSettings>(
        await fetch('/api/system/mobile-devices', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        }),
      ),
    onSuccess: (next) => {
      queryClient.setQueryData([...KEY, false], next);
      queryClient.setQueryData([...KEY, true], next);
    },
  });
}
