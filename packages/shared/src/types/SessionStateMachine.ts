// ────────────────────────────────────────────────────────────────
// SessionStateMachine — 6 states, 7 transition events.
// Sessions are thin harness conversation wrappers.
// This is the canonical session state machine type surface; the runtime
// implementation lives in packages/core/src/domain/state-machines/SessionStateMachine.ts.
// ────────────────────────────────────────────────────────────────

/**
 * Transition events for the session lifecycle.
 * Each maps to a specific harness SDK method call.
 */
export type SessionTransition =
  | 'sys:activate'      // → harness.createConversation()
  | 'user:pause'        // → harness.abortConversation() (abort in-flight turn)
  | 'user:resume'       // → harness.resumeConversation() if handle lost
  | 'user:close'        // → harness.abortConversation() + harness.destroyConversation()
  | 'sys:cleanup_done'  // cleanup complete, session fully closed
  | 'sys:error'         // SDK already errored
  | 'sys:recover';      // → harness.resumeConversation()
