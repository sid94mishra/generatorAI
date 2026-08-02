// ────────────────────────────────────────────────────────────────
// WorkflowRunStateMachine — 8 states, 10 transitions
// Manages the lifecycle of a DAG-based workflow execution
// ────────────────────────────────────────────────────────────────

import { InvalidTransitionError } from '@generatorai/shared';
import type { WorkflowRunStatus, WorkflowRunTransition } from '@generatorai/shared';

const WORKFLOW_RUN_TRANSITIONS: Record<
  WorkflowRunStatus,
  Partial<Record<WorkflowRunTransition, WorkflowRunStatus>>
> = {
  created: {
    'sys:start': 'starting',
  },
  starting: {
    'sys:dag_ready': 'running',
    'sys:error': 'failed',
    'user:cancel': 'cancelling',
  },
  running: {
    'user:pause': 'paused',
    'user:cancel': 'cancelling',
    'sys:all_stages_done': 'completed',
    'sys:stage_failed': 'failed',
    'sys:error': 'failed',
  },
  paused: {
    'user:resume': 'running',
    'user:cancel': 'cancelling',
  },
  cancelling: {
    'sys:all_stopped': 'cancelled',
    'sys:error': 'failed',
  },
  completed: {
    // Terminal state
  },
  failed: {
    'sys:recover': 'created',
    // Phase 2, 2.4 — user-initiated retry. Resets the run to `created`
    // so `startRun` can re-schedule from scratch; WorkflowRunService
    // resets failed stage rows + clears retryCount/error separately.
    'user:retry': 'created',
  },
  cancelled: {
    // Terminal state
  },
};

export class WorkflowRunStateMachine {
  private currentStatus: WorkflowRunStatus;

  constructor(initialStatus: WorkflowRunStatus) {
    this.currentStatus = initialStatus;
  }

  get status(): WorkflowRunStatus {
    return this.currentStatus;
  }

  /**
   * Apply a transition event. Returns the new status.
   * @throws InvalidTransitionError if transition is not valid from current state.
   */
  transition(event: WorkflowRunTransition): WorkflowRunStatus {
    const nextStatus = WORKFLOW_RUN_TRANSITIONS[this.currentStatus]?.[event];
    if (!nextStatus) {
      throw new InvalidTransitionError(
        `Cannot apply '${event}' to workflow run in '${this.currentStatus}' state`,
      );
    }
    this.currentStatus = nextStatus;
    return nextStatus;
  }

  /** Check if a transition event is valid from the current state. */
  canTransition(event: WorkflowRunTransition): boolean {
    return !!WORKFLOW_RUN_TRANSITIONS[this.currentStatus]?.[event];
  }

  /** Whether the run is in a terminal state. */
  get isTerminal(): boolean {
    return (
      this.currentStatus === 'completed' ||
      this.currentStatus === 'failed' ||
      this.currentStatus === 'cancelled'
    );
  }

  /** Whether the run is actively executing stages. */
  get isActive(): boolean {
    return this.currentStatus === 'running' || this.currentStatus === 'starting';
  }

  /** Returns all valid transitions from the current state. */
  get validTransitions(): WorkflowRunTransition[] {
    const transitions = WORKFLOW_RUN_TRANSITIONS[this.currentStatus];
    return transitions ? (Object.keys(transitions) as WorkflowRunTransition[]) : [];
  }
}
