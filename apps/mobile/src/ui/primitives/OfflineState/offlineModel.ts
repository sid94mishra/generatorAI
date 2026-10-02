// OfflineState copy (03 MP-34; HEALTH.connection words): online follows the server, not the device (MD-89).
import { HEALTH } from '@generatorai/shared';
import type { OfflineStateProps } from './OfflineState.types';

export function offlineText({ state, serverName }: Pick<OfflineStateProps, 'state' | 'serverName'>): string {
  if (state === 'reconnecting') return `${HEALTH.connection.reconnecting.label}…`;
  if (state === 'unreachable') return serverName ? `Can't reach ${serverName}` : "Can't reach the server";
  return 'Offline · showing saved data';
}
