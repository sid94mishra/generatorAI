// ────────────────────────────────────────────────────────────────
// StageRunStateMachine — 8 states, 12 transitions
// Manages the lifecycle of a single stage execution within a run
// ────────────────────────────────────────────────────────────────

import { InvalidTransitionError } from '@generatorai/shared';
import type { StageRunStatus, StageRunTransition } from '@generatorai/shared';

const STAGE_RUN_TRANSITIONS: Record<
  StageRunStatus,
  Partial<Record<StageRunTransition, StageRunStatus>>
> = {
  pending: {
    'sys:enqueue': 'queued',
    'sys:skip': 'skipped',
    'sys:parent_cancel': 'cancelled',
  },
  queued: {
    'sys:session_ready': 'running',
    'sys:parent_cancel': 'cancelled',
    'sys:error': 'failed',
  },
  running: {
    'user:pause': 'paused',
    'sys:parent_pause': 'paused',
    'user:cancel': 'cancelled',
    'sys:parent_cancel': 'cancelled',
    'sys:done': 'completed',
    'sys:error': 'failed',
    // HITL-01 — stage asked for human input. Release the SDK session
    // (caller's responsibility) and park with `interrupt_data` persisted
    // on the row; the POST /resume endpoint drives `sys:input_received`
    // back to `running`.
    'sys:input_request': 'awaiting_input',
  },
  paused: {
    'user:resume': 'running',
    'sys:parent_resume': 'running',
    'user:cancel': 'cancelled',
    'sys:parent_cancel': 'cancelled',
  },
  completed: {
    // Terminal state
  },
  failed: {
    'sys:retry': 'queued',
  },
  cancelled: {
    // Terminal state
  },
  skipped: {
    // Terminal state
  },
  // HITL-01 — waiting for human approval. Only three exits:
  //   1. approver supplies value → `sys:input_received` → running
  //   2. user cancels this stage → `user:cancel`
  //   3. parent run cancels → `sys:parent_cancel`
  //
  // Pausing from here is intentionally not allowed — the stage is already
  // quiescent; `paused` would be confusing semantics.
  awaiting_input: {
    'sys:input_received': 'running',
    'user:cancel': 'cancelled',
    'sys:parent_cancel': 'cancelled',
  },
};

export class StageRunStateMachine {
  private currentStatus: StageRunStatus;

  constructor(initialStatus: StageRunStatus) {
    this.currentStatus = initialStatus;
  }

  get status(): StageRunStatus {
    return this.currentStatus;
  }

  /**
   * Apply a transition event. Returns the new status.
   * @throws InvalidTransitionError if transition is not valid from current state.
   */
  transition(event: StageRunTransition): StageRunStatus {
    const nextStatus = STAGE_RUN_TRANSITIONS[this.currentStatus]?.[event];
    if (!nextStatus) {
      throw new InvalidTransitionError(
        `Cannot apply '${event}' to stage run in '${this.currentStatus}' state`,
      );
    }
    this.currentStatus = nextStatus;
    return nextStatus;
  }

  /** Check if a transition event is valid from the current state. */
  canTransition(event: StageRunTransition): boolean {
    return !!STAGE_RUN_TRANSITIONS[this.currentStatus]?.[event];
  }

  /** Whether the stage run is in a terminal state. */
  get isTerminal(): boolean {
    return (
      this.currentStatus === 'completed' ||
      this.currentStatus === 'failed' ||
      this.currentStatus === 'cancelled' ||
      this.currentStatus === 'skipped'
    );
  }

  /** Whether the stage is actively executing. */
  get isActive(): boolean {
    return this.currentStatus === 'running';
  }

  /** Returns all valid transitions from the current state. */
  get validTransitions(): StageRunTransition[] {
    const transitions = STAGE_RUN_TRANSITIONS[this.currentStatus];
    return transitions ? (Object.keys(transitions) as StageRunTransition[]) : [];
  }
}
