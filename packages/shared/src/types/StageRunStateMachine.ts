// ────────────────────────────────────────────────────────────────
// StageRunStateMachine — 8 states, 10 transition events
// Individual stage execution lifecycle within a WorkflowRun
// ────────────────────────────────────────────────────────────────

import type { StageRunStatus } from './WorkflowRun.js';

/**
 * Transition events for a StageRun lifecycle.
 */
export type StageRunTransition =
  | 'sys:enqueue'         // dependencies met, stage ready to execute
  | 'sys:session_ready'   // session allocated and conversation created → running
  | 'user:pause'          // pause stage execution
  | 'sys:parent_pause'    // parent workflow paused, cascade
  | 'user:resume'         // resume paused stage
  | 'sys:parent_resume'   // parent workflow resumed, cascade
  | 'sys:done'            // stage completed successfully
  | 'sys:error'           // stage execution failed
  | 'user:cancel'         // user-initiated cancel
  | 'sys:parent_cancel'   // parent workflow cancelled, cascade
  | 'sys:skip'            // condition not met, skip this stage
  | 'sys:retry'           // retry after failure
  | 'sys:input_request'   // HITL-01 — stage asked for human input; enters `awaiting_input`
  | 'sys:input_received'; // HITL-01 — approver supplied a value; resume to `running`
