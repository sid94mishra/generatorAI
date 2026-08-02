// ────────────────────────────────────────────────────────────────
// WorkflowRunStateMachine — 8 states, 10 transition events
// Runtime workflow execution lifecycle
// ────────────────────────────────────────────────────────────────

import type { WorkflowRunStatus } from './WorkflowRun.js';

/**
 * Transition events for a WorkflowRun lifecycle.
 */
export type WorkflowRunTransition =
  | 'sys:start'          // start execution, transition to starting
  | 'sys:dag_ready'      // DAG validated and first stages scheduled → running
  | 'user:pause'         // pause all active stages
  | 'user:resume'        // resume paused stages
  | 'user:cancel'        // initiate cancellation of all stages
  | 'sys:all_stages_done'// all stages completed → completed
  | 'sys:stage_failed'   // a stage failed and no failure edges → failed
  | 'sys:all_stopped'    // all stages stopped after cancel → cancelled
  | 'sys:error'          // unexpected error during execution
  | 'sys:recover'        // recover from error state (StartupRecoveryService)
  | 'user:retry';        // Phase 2, 2.4 — user-initiated retry from failed
