import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAdminApi } from '../../services/api/useAdminApi';
import type { DeviceRecord, Posture } from './model';

const devicesKey = ['auth', 'devices'] as const;
const postureKey = ['security', 'posture'] as const;
export function useDevices(enabled: boolean) {
  const admin = useAdminApi();
  return useQuery({ queryKey: devicesKey, enabled, queryFn: async (): Promise<DeviceRecord[]> => {
    const list = await admin.devices.list();
    return list.map((device) => ({ ...device, deviceName: device.name || 'Unnamed device', lastUsedAt: device.lastSeenAt }));
  } });
}
export function useSecurityPosture() {
  const admin = useAdminApi();
  return useQuery({ queryKey: postureKey, queryFn: async () => await admin.security.posture() as unknown as Posture });
}

/** Call only after the screen's confirmation and native step-up gate. */
export function useDeviceActions() {
  const admin = useAdminApi();
  const client = useQueryClient();
  return useMemo(() => {
    const refreshDevices = () => client.invalidateQueries({ queryKey: devicesKey });
    return {
      refreshDevices,
      refreshPosture: () => client.invalidateQueries({ queryKey: postureKey }),
      revoke: async (id: string) => { await admin.devices.revokeWithReason(id, 'Revoked from mobile'); await refreshDevices(); },
      setScopes: async (id: string, scopes: readonly string[]) => { await admin.devices.setScopes(encodeURIComponent(id), [...new Set(scopes)]); await refreshDevices(); },
      rotate: async (id: string) => { await admin.devices.rotate(id); await refreshDevices(); },
    };
  }, [admin, client]);
}
