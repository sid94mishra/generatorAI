// ────────────────────────────────────────────────────────────────
// SessionStateMachine — 6 states, 7 transition events
// Canonical session lifecycle state machine.
//
// Sessions are thin wrappers over harness conversations.
// Each transition maps to a specific harness SDK method call:
//   sys:activate    → harness.createConversation()
//   user:pause      → harness.abortConversation() (abort in-flight turn)
//   user:resume     → harness.resumeConversation() if handle lost
//   user:close      → harness.abortConversation() + harness.destroyConversation()
//   sys:cleanup_done → (cleanup complete, no SDK call)
//   sys:error       → (SDK already errored, no SDK call)
//   sys:recover     → harness.resumeConversation()
// ────────────────────────────────────────────────────────────────

import { InvalidTransitionError } from '@generatorai/shared';
import type { SessionStatus, SessionTransition } from '@generatorai/shared';

// Re-export the canonical session types for consumers of the state machine.
export type { SessionStatus, SessionTransition } from '@generatorai/shared';

const SESSION_TRANSITIONS: Record<
  SessionStatus,
  Partial<Record<SessionTransition, SessionStatus>>
> = {
  created: { 'sys:activate': 'active', 'sys:error': 'error' },
  active: {
    'user:pause': 'paused',
    'user:close': 'closing',
    'sys:error': 'error',
  },
  paused: {
    'user:resume': 'active',
    'user:close': 'closing',
    'sys:recover': 'active',
    'sys:error': 'error',
  },
  closing: { 'sys:cleanup_done': 'closed', 'sys:error': 'error' },
  closed: {},
  error: { 'sys:recover': 'active', 'user:close': 'closing' },
};

export class SessionStateMachine {
  private currentStatus: SessionStatus;

  constructor(initialStatus: SessionStatus) {
    this.currentStatus = initialStatus;
  }

  get status(): SessionStatus {
    return this.currentStatus;
  }

  /**
   * Apply a transition event. Returns the new status.
   * @throws InvalidTransitionError if transition is not valid from current state.
   */
  transition(event: SessionTransition): SessionStatus {
    const nextStatus = SESSION_TRANSITIONS[this.currentStatus]?.[event];
    if (!nextStatus) {
      throw new InvalidTransitionError(
        `Cannot apply '${event}' to session in '${this.currentStatus}' state`,
      );
    }
    this.currentStatus = nextStatus;
    return nextStatus;
  }

  /** Check if a transition event is valid from the current state. */
  canTransition(event: SessionTransition): boolean {
    return !!SESSION_TRANSITIONS[this.currentStatus]?.[event];
  }

  /** Whether the session is in a terminal state (closed). */
  get isTerminal(): boolean {
    return this.currentStatus === 'closed';
  }

  /** Whether the session can accept new prompts. */
  get canAcceptPrompts(): boolean {
    return this.currentStatus === 'active';
  }

  /** Whether chat is enabled (only when session is closed — read-only). */
  get isChatEnabled(): boolean {
    return this.currentStatus === 'closed';
  }

  /** Whether chat can function while paused. */
  get canChatWhilePaused(): boolean {
    return this.currentStatus === 'paused';
  }

  /** Returns all valid transitions from the current state. */
  get validTransitions(): SessionTransition[] {
    const transitions = SESSION_TRANSITIONS[this.currentStatus];
    return transitions ? (Object.keys(transitions) as SessionTransition[]) : [];
  }
}
