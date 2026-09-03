// ────────────────────────────────────────────────────────────────
// What a Stop press does to the LOCAL stream store, on web.
//
// Extracted from `ChatPage`'s `useTwoPhaseStop({ onCancel })` so the one thing
// that broke W30-b on this surface is reachable from a test. The network half
// (`cancelMutation.mutate(chatId)`) stays at the call site; only the local
// store writes live here, because those are what decide whether the two-phase
// machine can advance.
// ────────────────────────────────────────────────────────────────

/** The slice of the stream store a Stop press writes to. */
export interface StopEffectStore {
  requestCancel: (sessionId: string) => void;
  clearStreamText: (sessionId: string) => void;
}

/**
 * Apply the local half of a Stop press.
 *
 * The GRACEFUL press writes nothing. That is the fix, and it is the whole
 * difference between this surface and mobile:
 *
 * `requestCancel` sets `status: 'complete'` (`packages/client-core/src/stream/
 * reducer.ts`). `ChatPage` derives the two-phase machine's `isLive` from that
 * same status, so calling it on the first press made the page tell the machine
 * the backend had settled — one tick later `StopController.observe('settled')`
 * reset the phase to `idle` and cleared `pressedAt`. `arming`, `stopping` and
 * `force` were therefore unreachable on web, and the 15 s Force reset that
 * W30-b exists for could never appear. Mobile never latched
 * (`apps/mobile/app/chats/[id].tsx` → `onCancel: () => cancel.mutate()`) and
 * kept the escape hatch; this brings web to that behaviour.
 *
 * The latch was there to stop late events flipping the composer back to a
 * "Stop" button mid-abort. It is no longer needed for that: the controller
 * itself now owns the label, showing "Stopping…" from the press onward, so the
 * button never reverts while an attempt is in flight. Pinning the status was
 * solving a rendering problem by lying about the backend.
 *
 * @param force `true` only on the escalated press — past W30-b's 15 s escape
 * hatch, once the graceful budget has demonstrably failed.
 */
export function applyStopEffects(
  store: StopEffectStore,
  sessionId: string | null | undefined,
  force: boolean,
): void {
  if (!sessionId) return;
  // The backend decides when the turn is over. Until it does, the machine
  // must keep offering escalation.
  if (!force) return;

  // Past the escape hatch the graceful path has demonstrably failed. Clearing
  // is the honest reset: whatever is on screen belongs to a turn the server
  // could not stop, and leaving it there implies it is still coming.
  store.requestCancel(sessionId);
  store.clearStreamText(sessionId);
}
