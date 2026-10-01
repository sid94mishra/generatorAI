import { useApi } from '../../services/api/useApi';
export type { WorkspaceCheckpoint as CheckpointRow, ChangeSummary as ChangeSummaryV2 } from '@generatorai/client-core';

export function useWorkspaceExtras() {
  return useApi().workspaces;
}
