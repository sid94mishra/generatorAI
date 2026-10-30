// ────────────────────────────────────────────────────────────────
// The run page's platform-bound pieces (features/workflows/run may not hold
// the platform client, D-04): the run's live SSE connection and the run's
// effective permission mode as the server resolves it.
// ────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import type { WorkflowRunPermissionMode } from '@generatorai/shared';
import { usePlatform } from '@/providers/PlatformProvider.js';
import { connectWorkflowRun } from '@/stores/sseManager.js';
import type { HttpPlatformClient } from '@/platform/HttpPlatformClient.js';

/** Subscribe to the run's event stream while mounted (feeds workflowRunStore and the stage streams). */
export function useWorkflowRunConnection(runId: string | undefined): void {
  const platform = usePlatform() as HttpPlatformClient;
  useEffect(() => {
    if (!runId) return;
    return connectWorkflowRun(runId, platform);
  }, [runId, platform]);
}

/**
 * The run's permission mode: its own when set, else the server's effective
 * mode (the definition's). Re-read whenever the run's own mode changes, so
 * another client's change shows here too.
 */
export function useRunPermissionMode(
  runId: string | undefined,
  runMode: WorkflowRunPermissionMode | undefined,
): WorkflowRunPermissionMode | undefined {
  const platform = usePlatform() as HttpPlatformClient;
  const [fetched, setFetched] = useState<WorkflowRunPermissionMode | undefined>(undefined);
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    platform
      .getPermissionMode(runId)
      .then((res) => {
        if (!cancelled) setFetched(res.mode);
      })
      .catch(() => {
        /* non-fatal: the control shows the run's own mode */
      });
    return () => {
      cancelled = true;
    };
  }, [runId, platform, runMode]);
  return runMode ?? fetched;
}
