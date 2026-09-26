// ────────────────────────────────────────────────────────────────
// Stage-run (instance) state machine v2 as data (G5 §5.9).
//
// This table is the only source `transition()` uses (P03), and the UI
// derives action enablement from it. Rows are `from → to` for one event,
// owned by the executor (in-attempt transitions while its frame is alive)
// or the actor (everything else); the two meet only through compare-and-set.
// `applies` limits a row to a node class: `work` nodes run attempts (agent,
// and check from P05), `wait` nodes park without an executor, `container`
// nodes (loop, map, sub-workflow, expansion) own child scopes.
// Terminal states have no exits: re-running is a fork.
// ────────────────────────────────────────────────────────────────

export const STAGE_RUN_STATES = [
  'pending',
  'ready',
  'starting',
  'running',
  'validating',
  'awaiting_input',
  'waiting',
  'retry_wait',
  'paused',
  'completed',
  'failed',
  'skipped',
  'cancelled',
] as const;
export type StageRunState = (typeof STAGE_RUN_STATES)[number];

export const TERMINAL_STAGE_RUN_STATES: readonly StageRunState[] = ['completed', 'failed', 'skipped', 'cancelled'];

export type TransitionOwner = 'actor' | 'executor';
export type StageNodeClass = 'work' | 'wait' | 'container';

export interface StageRunTransition {
  from: StageRunState;
  to: StageRunState;
  /** `source:name`: sched (the actor's decide), exec (executor), user, run (run-level command), timer. */
  event: string;
  owner: TransitionOwner;
  /** Node classes the row applies to. */
  applies: readonly StageNodeClass[];
  /** Guard or side effect, for docs. */
  note?: string;
}

const ALL: readonly StageNodeClass[] = ['work', 'wait', 'container'];
const WORK: readonly StageNodeClass[] = ['work'];
const WAIT: readonly StageNodeClass[] = ['wait'];
const CONTAINER: readonly StageNodeClass[] = ['container'];
const WORK_AND_CONTAINER: readonly StageNodeClass[] = ['work', 'container'];

function rows(
  from: StageRunState | StageRunState[],
  to: StageRunState,
  event: string,
  owner: TransitionOwner,
  applies: readonly StageNodeClass[],
  note?: string,
): StageRunTransition[] {
  return (Array.isArray(from) ? from : [from]).map((f) => ({ from: f, to, event, owner, applies, ...(note ? { note } : {}) }));
}

const ATTEMPT: StageRunState[] = ['starting', 'running', 'validating'];

export const STAGE_RUN_TRANSITIONS: readonly StageRunTransition[] = Object.freeze([
  ...rows('pending', 'ready', 'sched:deps_satisfied', 'actor', ALL, 'join satisfied and guard true'),
  ...rows('pending', 'skipped', 'sched:skip', 'actor', ALL, 'skip_reason and skip_cause_id recorded'),
  ...rows('pending', 'cancelled', 'run:cancel', 'actor', ALL),
  ...rows('ready', 'starting', 'exec:claim', 'executor', WORK, 'lease set; attempt row created'),
  ...rows('ready', 'skipped', 'sched:cancel_loser', 'actor', ALL, 'join fired with cancelRemaining'),
  ...rows('ready', 'skipped', 'user:skip', 'actor', ALL),
  ...rows('ready', 'paused', 'user:pause', 'actor', ALL),
  ...rows('ready', 'cancelled', 'user:cancel', 'actor', ALL),
  ...rows('ready', 'cancelled', 'run:cancel', 'actor', ALL),
  ...rows('ready', 'failed', 'sched:queue_timeout', 'actor', WORK, 'deterministic queue_timeout'),
  ...rows('ready', 'waiting', 'sched:wait_armed', 'actor', WAIT, 'no executor, lease or admission slot'),
  ...rows('ready', 'running', 'sched:scope_started', 'actor', CONTAINER, 'child scopes created'),
  ...rows('starting', 'running', 'exec:session_ready', 'executor', WORK, 'heartbeat and progress stamped'),
  ...rows(ATTEMPT, 'retry_wait', 'sched:attempt_failed', 'actor', WORK, 'retryable; retry timer armed, lease cleared'),
  ...rows(ATTEMPT, 'failed', 'sched:attempt_failed', 'actor', WORK, 'routed to a failure edge, or onExhausted fail'),
  ...rows(ATTEMPT, 'paused', 'sched:attempt_failed', 'actor', WORK, 'onExhausted pause; executor aborted after the write'),
  ...rows(ATTEMPT, 'paused', 'sched:lease_expired', 'actor', WORK, 'unsafe to replay'),
  ...rows(ATTEMPT, 'paused', 'user:pause', 'actor', WORK, 'executor aborted after the write'),
  ...rows(ATTEMPT, 'paused', 'run:pause', 'actor', WORK, 'run paused with interrupt'),
  ...rows(ATTEMPT, 'cancelled', 'user:cancel', 'actor', WORK, 'executor aborted after the write'),
  ...rows(ATTEMPT, 'cancelled', 'run:cancel', 'actor', WORK, 'executor aborted after the write'),
  ...rows(ATTEMPT, 'cancelled', 'sched:budget_abort', 'actor', WORK, 'budget hard cap'),
  ...rows('running', 'validating', 'exec:output_ready', 'executor', WORK),
  ...rows('running', 'awaiting_input', 'exec:input_request', 'executor', WORK, 'tool permission or approval gate; lease cleared'),
  ...rows('validating', 'running', 'exec:repair', 'executor', WORK, 'repair_count + 1; lease re-stamped'),
  ...rows('validating', 'completed', 'sched:attempt_succeeded', 'actor', WORK, 'same transaction as successor activation'),
  ...rows('awaiting_input', 'running', 'exec:input_received', 'executor', WORK, 'frame alive; lease re-stamped'),
  ...rows('awaiting_input', 'ready', 'sched:input_received', 'actor', WORK, 'no frame after a restart; the resume attempt carries the verdict'),
  ...rows('awaiting_input', 'paused', 'sched:frame_lost', 'actor', WORK, 'an in-turn gate (tool permission, question, plan) lost to a restart: paused(interrupted)'),
  ...rows('awaiting_input', 'failed', 'user:reject', 'actor', WORK, 'rejected_by_human'),
  ...rows('awaiting_input', 'cancelled', 'user:cancel', 'actor', WORK_AND_CONTAINER, 'waiter cancelled'),
  ...rows('awaiting_input', 'cancelled', 'run:cancel', 'actor', WORK_AND_CONTAINER, 'waiter cancelled'),
  ...rows('waiting', 'completed', 'sched:wait_resolved', 'actor', WAIT, 'output = outcome'),
  ...rows('waiting', 'completed', 'timer:wait_timeout', 'actor', WAIT, 'onTimeout complete'),
  ...rows('waiting', 'failed', 'timer:wait_timeout', 'actor', WAIT, 'onTimeout fail'),
  ...rows('waiting', 'cancelled', 'user:cancel', 'actor', WAIT),
  ...rows('waiting', 'cancelled', 'run:cancel', 'actor', WAIT),
  ...rows('retry_wait', 'ready', 'timer:retry', 'actor', WORK, 'new attempt (resume or restart)'),
  ...rows('retry_wait', 'paused', 'user:pause', 'actor', WORK, 'retry timer cancelled'),
  ...rows('retry_wait', 'paused', 'run:pause', 'actor', WORK, 'retry timer cancelled'),
  ...rows('retry_wait', 'cancelled', 'user:cancel', 'actor', WORK, 'retry timer cancelled'),
  ...rows('retry_wait', 'cancelled', 'run:cancel', 'actor', WORK, 'retry timer cancelled'),
  ...rows('paused', 'ready', 'user:resume', 'actor', ALL, 'a new attempt for work nodes'),
  ...rows('paused', 'retry_wait', 'user:resume', 'actor', WORK, 'a pause taken while waiting to retry: the backoff is waited out again'),
  ...rows('paused', 'retry_wait', 'run:resume', 'actor', WORK, 'a pause taken while waiting to retry: the backoff is waited out again'),
  ...rows('paused', 'ready', 'user:retry', 'actor', WORK, 'a new attempt (resume or restart)'),
  ...rows('paused', 'skipped', 'user:skip', 'actor', ALL, 'gate_as completed or skipped'),
  ...rows('paused', 'failed', 'user:fail', 'actor', ALL),
  ...rows('paused', 'failed', 'timer:pause_ttl', 'actor', ALL, 'unattended pause expired'),
  ...rows('paused', 'cancelled', 'user:cancel', 'actor', ALL),
  ...rows('paused', 'cancelled', 'run:cancel', 'actor', ALL),
  ...rows('running', 'awaiting_input', 'sched:exhausted_pause', 'actor', CONTAINER, 'loop exhausted with onLimit pause'),
  ...rows('awaiting_input', 'running', 'user:grant', 'actor', CONTAINER, 'operator granted iterations or budget'),
  ...rows('awaiting_input', 'completed', 'user:accept', 'actor', CONTAINER),
  ...rows('awaiting_input', 'failed', 'user:fail', 'actor', CONTAINER),
  ...rows('running', 'completed', 'sched:scope_outcome', 'actor', CONTAINER),
  ...rows('running', 'failed', 'sched:scope_outcome', 'actor', CONTAINER),
  ...rows('running', 'cancelled', 'sched:scope_outcome', 'actor', CONTAINER),
  ...rows('running', 'cancelled', 'run:cancel', 'actor', CONTAINER),
  ...rows('running', 'paused', 'run:pause', 'actor', CONTAINER, 'children paused too'),
  ...rows('paused', 'running', 'run:resume', 'actor', CONTAINER, 'children resumed'),
]);

export function isTerminalStageRunState(s: string): boolean {
  return (TERMINAL_STAGE_RUN_STATES as readonly string[]).includes(s);
}

/** Whether `from → to` is legal for the node class (any event). */
export function isLegalStageRunTransition(from: StageRunState, to: StageRunState, cls?: StageNodeClass): boolean {
  return STAGE_RUN_TRANSITIONS.some((t) => t.from === from && t.to === to && (!cls || t.applies.includes(cls)));
}
