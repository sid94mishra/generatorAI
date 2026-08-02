// ────────────────────────────────────────────────────────────────
// WorkflowStateMachine types — 7 states, 10 transition events
// Pure TypeScript  
// ────────────────────────────────────────────────────────────────

export type WorkflowStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type WorkflowTransition =
  | 'sys:session_start'
  | 'sys:turn'
  | 'user:pause'
  | 'sys:parent_pause'
  | 'user:resume'
  | 'sys:parent_resume'
  | 'user:cancel'
  | 'sys:parent_cancel'
  | 'sys:done'
  | 'sys:error';
