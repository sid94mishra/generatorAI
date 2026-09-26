// ────────────────────────────────────────────────────────────────
// Workflow-run state machine v2 as data (G5 §5.10, with the P03/P04
// refinements: prepare phases run in `starting`, compensation, onExit and
// post-processing run in `finalizing`, and an unattended pause that
// outlives its TTL fails the run, PD-2).
//
// `waiting` means nothing is launchable or in flight, but something is
// awaiting input, waiting, in retry backoff or paused. The outcome is fixed
// when the run enters `finalizing`. Terminal states have no exits: a retry
// is a fork.
// ────────────────────────────────────────────────────────────────

export const WORKFLOW_RUN_STATES = [
  'created',
  'starting',
  'running',
  'waiting',
  'paused',
  'finalizing',
  'cancelling',
  'completed',
  'failed',
  'cancelled',
] as const;
export type WorkflowRunState = (typeof WORKFLOW_RUN_STATES)[number];

export const TERMINAL_WORKFLOW_RUN_STATES: readonly WorkflowRunState[] = ['completed', 'failed', 'cancelled'];

export interface WorkflowRunTransition {
  from: WorkflowRunState;
  to: WorkflowRunState;
  /** `source:name`: user (command), sys (engine), timer. */
  event: string;
  note?: string;
}

function rows(from: WorkflowRunState | WorkflowRunState[], to: WorkflowRunState, event: string, note?: string): WorkflowRunTransition[] {
  return (Array.isArray(from) ? from : [from]).map((f) => ({ from: f, to, event, ...(note ? { note } : {}) }));
}

export const WORKFLOW_RUN_TRANSITIONS: readonly WorkflowRunTransition[] = Object.freeze([
  ...rows('created', 'starting', 'user:start', 'idempotent through compare-and-set'),
  ...rows('starting', 'running', 'sys:ready', 'every prepare phase settled (workspace, mounts, uploads, preprocessing, sandbox)'),
  ...rows('starting', 'failed', 'sys:setup_error', 'status_reason setup:<phase>'),
  ...rows('running', 'waiting', 'sys:idle', 'computed after every decision'),
  ...rows('waiting', 'running', 'sys:work_available'),
  ...rows(['running', 'waiting'], 'paused', 'user:pause', 'drain stops launches; interrupt also pauses in-flight instances'),
  ...rows('paused', 'running', 'user:resume', 'instances paused by the run go to ready'),
  ...rows(['running', 'waiting'], 'finalizing', 'sys:scope_terminal', 'outcome decided; exactly once'),
  ...rows('paused', 'finalizing', 'timer:pause_ttl', 'unattended pause expired; outcome failed'),
  ...rows('finalizing', 'completed', 'sys:finalized', 'outcome completed, after onExit and post-processing'),
  ...rows('finalizing', 'failed', 'sys:finalized', 'outcome failed (compensation and onFailure ran), or post-processing failed'),
  ...rows(['created', 'starting', 'running', 'waiting', 'paused'], 'cancelling', 'user:cancel', 'every live instance gets desired state cancelled first'),
  ...rows('finalizing', 'cancelling', 'user:cancel', 'skips post-processing; compensation still runs'),
  ...rows('cancelling', 'cancelled', 'sys:all_stopped', 'executors acknowledged or leases expired; compensation and onExit ran'),
]);

export function isLegalWorkflowRunTransition(from: WorkflowRunState, to: WorkflowRunState): boolean {
  return WORKFLOW_RUN_TRANSITIONS.some((t) => t.from === from && t.to === to);
}
