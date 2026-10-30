// Opening a chat or a run on this device follows it (MD-90): it may then get a Live Activity / Live Update.
import { useEffect } from 'react';
import type { AttentionEntity } from '@generatorai/shared';

import { useAuth } from '../auth/AuthProvider';
import { followLive } from './liveStore';

export function useFollowLive(entity: AttentionEntity, entityId: string | null | undefined): void {
  const { serverId } = useAuth();
  useEffect(() => {
    if (serverId && entityId && /^[A-Za-z0-9_-]+$/.test(entityId)) followLive(serverId, entity, entityId);
  }, [serverId, entity, entityId]);
}
