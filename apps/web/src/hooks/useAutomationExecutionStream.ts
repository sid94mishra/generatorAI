// ────────────────────────────────────────────────────────────────
// useAutomationExecutionStream — Track B
//   Opens an SSE connection to the unified /api/stream endpoint
//   scoped to a specific automation execution and invalidates
//   TanStack Query caches when relevant events arrive.
// ────────────────────────────────────────────────────────────────

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { automationKeys } from './automationQueries.js';
import { openMultiplexedStream } from '../platform/muxStream.js';

/** Kinds we care about for cache invalidation. */
const AUTOMATION_KINDS = new Set([
  'automation_execution.started',
  'automation_execution.progress',
  'automation_execution.completed',
  'automation_execution.failed',
  'automation_execution.cancelled',
  'automation_execution.recovered',
  'automation_execution.iteration_started',
  'automation_execution.iteration_completed',
  'automation_execution.iteration_failed',
  'automation_execution.iteration_retried',
]);

/**
 * Opens `/api/stream?scope=automation&id=<executionId>` for the lifetime
 * of the calling component. Invalidates the execution + executions
 * detail queries on every event so the UI reflects live progress.
 *
 * Pass `enabled: false` to disable (e.g. when the execution is already
 * in a terminal state).
 */
export function useAutomationExecutionStream(
  automationId: string | undefined,
  executionId: string | undefined,
  opts: { enabled?: boolean } = {},
): void {
  const queryClient = useQueryClient();
  const enabled = opts.enabled !== false;

  useEffect(() => {
    if (!enabled || !automationId || !executionId) return;

    // One shared, ticket-authorised connection carries every scope this tab
    // watches; the prefix filter still runs server-side (W09-a).
    const es = openMultiplexedStream(
      'automation',
      executionId,
      {
        onMessage: (event) => {
          try {
            const payload = JSON.parse(event.data) as { kind?: string };
            if (payload.kind && AUTOMATION_KINDS.has(payload.kind)) {
              queryClient.invalidateQueries({ queryKey: automationKeys.executions(automationId) });
              queryClient.invalidateQueries({ queryKey: automationKeys.execution(automationId, executionId) });
              queryClient.invalidateQueries({ queryKey: automationKeys.detail(automationId) });
            }
          } catch {
            /* malformed payload — ignore */
          }
        },
      },
      ['automation_execution.'],
    );

    return () => {
      es.close();
    };
  }, [automationId, executionId, enabled, queryClient]);
}
