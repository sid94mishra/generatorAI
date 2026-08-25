// ────────────────────────────────────────────────────────────────
// Event classification — W04, the foundation of the Phase 1 stream spine.
//
// Every event is either a DELTA or an ITEM, and the difference decides how it
// is persisted, coalesced, replayed and dropped:
//
//   DELTA  transport-only. Coalesceable, droppable under pressure with a gap
//          marker, replayable only within a bounded window. A token, a chunk of
//          tool stdout, a progress tick. Its value expires: the next one
//          supersedes it, and the completed item supersedes them all.
//
//   ITEM   durable. Batched but never dropped — the producer blocks instead.
//          A completed message, a tool call, a lifecycle transition. Losing one
//          is a hole a client cannot detect or recover from.
//
// Codex CLI states the underlying rule outright: its streaming deltas "may not
// exactly equal" the final item, and only the completed item is authoritative.
//
// ENFORCEMENT IS COMPILE-TIME, not a lint rule. `EVENT_CLASS` is typed
// `Record<AgentEvent['kind'], EventClass>`, so adding a kind to the union
// without classifying it fails `tsc`. A lint rule can be disabled inline and
// only runs where it is configured; this cannot be, and runs everywhere.
// ────────────────────────────────────────────────────────────────

import type { AgentEvent } from './AgentEvent.js';

export type EventClass = 'delta' | 'item';

/**
 * Classification for every event kind.
 *
 * Deltas are deliberately few. The bar is: does a later event of the same kind
 * make this one worthless, AND is it emitted more than once per logical step?
 * Both must hold. `harness.usage` looks like a delta and is not — each carries
 * a distinct cost figure nothing supersedes.
 */
export const EVENT_CLASS: Record<AgentEvent['kind'], EventClass> = {
  // harness
  'harness.token': 'delta',
  'harness.message_complete': 'item',
  'harness.user_message': 'item',
  'harness.reasoning_delta': 'delta',
  'harness.reasoning_complete': 'item',
  'harness.tool_start': 'item',
  'harness.tool_complete': 'item',
  'harness.idle': 'item',
  'harness.error': 'item',
  'harness.cancelled': 'item', // W13 / X-4 — semantic cancellation, not an error
  'harness.session_start': 'item',
  'harness.usage': 'item',
  'harness.context_usage': 'item',
  'harness.turn_start': 'item',
  'harness.turn_end': 'item',
  // Payload-discriminated — see `classifyEvent`. Defaults to item because the
  // union carries `subagent.*`, `abort`, `exit_plan_mode.*` and the
  // unresolved-variable diagnostic, none of which may be dropped.
  'harness.session_info': 'item',
  'harness.unknown': 'item',
  'harness.client_started': 'item',
  'harness.client_stopped': 'item',
  'harness.client_error': 'item',
  'harness.client_restarting': 'item',
  'harness.plan_changed': 'item',
  'harness.mode_changed': 'item',

  // harness.widget — an inline UI surface the model authors and drives.
  // All items: `state` is the widget's authoritative value (dropping one leaves
  // the UI showing something the agent believes it changed), and `action` /
  // `invoke` are user intent, which has no later event that supersedes it.
  'harness.widget.render': 'item',
  'harness.widget.state': 'item',
  'harness.widget.action': 'item',
  'harness.widget.invoke': 'item',
  'harness.widget.teardown': 'item',
  'harness.widget.closed': 'item',
  'harness.widget.error': 'item',

  // chat
  'chat.created': 'item',
  'chat.prompt_sent': 'item',
  'chat.prompt_failed': 'item',
  'chat.archived': 'item',
  'chat.deleted': 'item',
  'chat.mode_changed': 'item',
  'chat.agent_changed': 'item',

  // chat.background_task — `status` is a progress tick, but a background task
  // is exactly the thing a user is not watching, so a dropped status leaves the
  // only indication it is alive missing. Item.
  'chat.background_task.spawned': 'item',
  'chat.background_task.status': 'item',
  'chat.background_task.completed': 'item',
  'chat.background_task.failed': 'item',

  // chat.plan — plan mode is human-in-the-loop. `review_requested` and
  // `decided` gate a turn; losing either strands the run waiting on an approval
  // the user was never shown, or approves nothing.
  'chat.plan.drafting': 'item',
  'chat.plan.created': 'item',
  'chat.plan.updated': 'item',
  'chat.plan.review_requested': 'item',
  'chat.plan.decided': 'item',
  'chat.plan.expired': 'item',
  'chat.plan.extraction_failed': 'item',

  // chat.question — same gate, same reasoning.
  'chat.question.asked': 'item',
  'chat.question.answered': 'item',
  'chat.question.expired': 'item',

  // agent
  'agent.created': 'item',
  'agent.updated': 'item',
  'agent.deleted': 'item',

  // workflow_run
  'workflow_run.created': 'item',
  'workflow_run.starting': 'item',
  'workflow_run.running': 'item',
  'workflow_run.paused': 'item',
  'workflow_run.resumed': 'item',
  'workflow_run.cancelling': 'item',
  'workflow_run.completed': 'item',
  'workflow_run.failed': 'item',
  'workflow_run.cancelled': 'item',
  'workflow_run.retried': 'item',
  'workflow_run.orchestration_started': 'item',
  'workflow_run.worktree_creating': 'item',
  'workflow_run.worktree_created': 'item',
  'workflow_run.preprocessing_started': 'item',
  'workflow_run.preprocessing_completed': 'item',
  'workflow_run.preprocessing_step_started': 'item',
  'workflow_run.preprocessing_step_completed': 'item',
  'workflow_run.preprocessing_step_failed': 'item',
  'workflow_run.stage_validation': 'item',
  'workflow_run.orchestration_failed': 'item',
  'workflow_run.orchestration_completed': 'item',
  'workflow_run.sandbox_created': 'item',
  'workflow_run.sandbox_destroyed': 'item',
  'workflow_run.postprocessing_started': 'item',
  'workflow_run.postprocessing_completed': 'item',
  'workflow_run.postprocessing_step_started': 'item',
  'workflow_run.postprocessing_step_completed': 'item',
  'workflow_run.postprocessing_step_failed': 'item',
  'workflow_run.permission_mode_changed': 'item',

  // stage_run
  'stage_run.pending': 'item',
  'stage_run.queued': 'item',
  'stage_run.running': 'item',
  'stage_run.step_started': 'item',
  'stage_run.step_completed': 'item',
  'stage_run.paused': 'item',
  'stage_run.resumed': 'item',
  'stage_run.completed': 'item',
  'stage_run.failed': 'item',
  'stage_run.cancelled': 'item',
  'stage_run.skipped': 'item',
  'stage_run.retrying': 'item',
  'stage_run.sleeping': 'item',
  'stage_run.woken': 'item',
  'stage_run.awaiting_input': 'item',
  'stage_run.input_received': 'item',

  // session
  'session.created': 'item',
  'session.active': 'item',
  'session.paused': 'item',
  'session.closing': 'item',
  'session.closed': 'item',
  'session.error': 'item',

  // git
  'git.clone_start': 'item',
  'git.clone_progress': 'delta',
  'git.clone_complete': 'item',
  'git.commit': 'item',
  'git.push': 'item',
  'git.pr_created': 'item',

  // workspace
  'workspace.changed': 'item',

  // checkpoint
  'checkpoint.created': 'item',
  'checkpoint.restored': 'item',

  // script
  'script.stdout': 'delta',
  'script.stderr': 'delta',
  'script.exit': 'item',

  // hook
  'hook.started': 'item',
  'hook.completed': 'item',
  'hook.failed': 'item',
  'hook.skipped': 'item',

  // artifact
  'artifact.created': 'item',
  'artifact.available': 'item',

  // permission
  'permission.requested': 'item',
  'permission.granted': 'item',
  'permission.denied': 'item',

  // subscriber
  'subscriber.error': 'item',

  // browser
  'browser.session_created': 'item',
  'browser.session_stopped': 'item',
  'browser.session_updated': 'item',
  'browser.action_started': 'item',
  'browser.action_completed': 'item',
  'browser.snapshot': 'item',
  'browser.selection': 'item',
  'browser.error': 'item',

  // computer
  'computer.session_started': 'item',
  'computer.session_stopped': 'item',
  'computer.snapshot': 'item',
  'computer.action': 'item',
  'computer.refusal': 'item',
  'computer.consent_required': 'item',
  'computer.consent_resolved': 'item',
  'computer.error': 'item',

  // terminal
  'terminal.session_created': 'item',
  'terminal.session_closed': 'item',
  'terminal.session_resized': 'item',

  // extension
  'extension.installed': 'item',
  'extension.uninstalled': 'item',
  'extension.reloaded': 'item',
  'extension.error': 'item',

  // automation_execution
  'automation_execution.started': 'item',
  'automation_execution.progress': 'delta',
  'automation_execution.completed': 'item',
  'automation_execution.failed': 'item',
  'automation_execution.cancelled': 'item',
  'automation_execution.recovered': 'item',
  'automation_execution.iteration_started': 'item',
  'automation_execution.iteration_completed': 'item',
  'automation_execution.iteration_failed': 'item',
  'automation_execution.iteration_retried': 'item',
};

/**
 * `harness.session_info` payloads that are deltas despite the kind being an
 * item.
 *
 * This kind is a grab-bag: the Copilot mapper funnels `subagent.*`, `abort`,
 * `compaction_start`, `task_complete` AND per-chunk tool output through it.
 * The first group must never be dropped; the second is a token stream wearing
 * a lifecycle event's name. `tool.execution_partial_result` carries a chunk of
 * tool stdout and `tool.execution_progress` a progress tick, both emitted per
 * chunk, and neither is read by web, mobile, CLI or replay.
 *
 * This is the discrimination the `NOISE_EVENT_KINDS` filter approximates by
 * suppressing them outright.
 *
 * NOTE, and it matters: `EventBus.isNoiseEventKind` STILL suppresses these two
 * payloads before anything can classify them, so this branch is currently
 * reached only by callers that classify directly. Both must stay in step, and
 * the suppression lifts when W07's delta log exists — until then a delta is
 * still a `stream_cursors` INSERT, so un-suppressing would trade a real
 * regression for a future benefit. `DELTA_SESSION_INFO_TYPES` is the single
 * definition both sides read, so they cannot drift.
 */
export const DELTA_SESSION_INFO_TYPES: ReadonlySet<string> = new Set([
  'tool_partial_result',
  'tool_progress',
]);

/**
 * Classify one event. `data` is only consulted for kinds whose class depends on
 * their payload; passing it is always safe and never required for correctness
 * of the item default.
 */
export function classifyEvent(kind: string, data?: unknown): EventClass {
  const base = (EVENT_CLASS as Record<string, EventClass | undefined>)[kind];
  // An unknown kind is an item. It cannot come from `AgentEvent` — the table is
  // exhaustive over that union — so it is a raw passthrough from a provider we
  // have not mapped yet, and guessing "droppable" for something unrecognised is
  // how you lose the one event that explained a failure.
  if (base === undefined) return 'item';
  if (kind !== 'harness.session_info') return base;

  const infoType = (data as { infoType?: unknown } | undefined)?.infoType;
  return typeof infoType === 'string' && DELTA_SESSION_INFO_TYPES.has(infoType)
    ? 'delta'
    : 'item';
}

/** Convenience predicate. Reads better at call sites that only care about one. */
export function isDeltaEvent(kind: string, data?: unknown): boolean {
  return classifyEvent(kind, data) === 'delta';
}
