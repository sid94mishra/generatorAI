/** Statuses that are still in flight. */
export function isActive(status: string): boolean {
  return ACTIVE.has(status);
}

const ACTIVE: ReadonlySet<string> = new Set([
  'ready',
  'starting',
  'running',
  'validating',
  'retry_wait',
  'finalizing',
]);

/** Statuses that will never change again without an explicit action. */
export function isTerminal(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'skipped';
}
/**
 * Should the screen keep polling?
 *
 * Only a terminal run stops. `created` and `cancelling` are not terminal —
 * they are about to change on their own — so they keep a (slow) poll going.
 */
export function pollIntervalFor(status: string | undefined, streamConnected: boolean): number | false {
  if (!status) return 5_000;
  if (isTerminal(status)) return false;
  // With the run scope connected, events drive refreshes; polling is only a
  // safety net for a dropped event.
  return streamConnected ? 30_000 : 5_000;
}

/**
 * Statuses that require a human before anything else happens.
 *
 * This drives the "Needs attention" grouping — the single most valuable thing
 * a phone can surface, because a blocked run costs nothing to unblock but
 * stalls everything downstream until someone notices.
 */
export function needsAttention(status: string): boolean {
  return status === 'paused' || status === 'awaiting_input' || status === 'failed';
}

