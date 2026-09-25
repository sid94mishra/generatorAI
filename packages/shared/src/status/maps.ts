// ────────────────────────────────────────────────────────────────
// Server/client status value → visual state (D-18, 02 §7.3).
//
// Every domain map is `satisfies Record<Union, StatusMapping | null>`, so a new
// status added to a server or client union is a TYPE ERROR here until it is
// mapped. That is intended: the Workflow Overhaul adds its engine statuses by
// editing this file (07-phases.md §"Running in parallel").
//
// `null` means "not a run status": render it as plain metadata, not a badge.
// ────────────────────────────────────────────────────────────────

import type { StageRunStatus } from '../types/WorkflowRun.js';
import type { WorkflowStatus } from '../types/WorkflowStateMachine.js';
import type { AutomationExecutionStatus, AutomationRunItemStatus } from '../types/Automation.js';
import type { BackgroundTaskStatus, ChatStatus } from '../types/Chat.js';
import type { SessionStatus } from '../types/Session.js';
import type { PlanStatus, AgentInteractionStatus } from '../types/AgentMode.js';
import type { CheckConclusion, DeviceLoginStatus, ScmFlowResult, ScmFlowStep } from '../types/SourceControl.js';
import type { WidgetInstanceStatus } from '../types/Widget.js';
import type { BrowserSessionStatus } from '../types/Workspace.js';
import { STATUS_STATE_DEFS, type StatusState, type StatusStateDef } from './states.js';
import type {
  HookInvocationStatus,
  PermissionStatus,
  QuestionStatus,
  ReviewThreadStatus,
  RunStatus,
  StreamStatus,
  ToolCallStatus,
} from './unions.js';

export interface StatusMapping {
  state: StatusState;
  /** Overrides the state's default word ("Cancelled" is shown as Skipped's glyph). */
  label?: string;
}

const m = (state: StatusState, label?: string): StatusMapping => (label ? { state, label } : { state });

export const STATUS_MAPS = {
  workflowRun: {
    created: m('queued'),
    pending: m('queued'),
    starting: m('running', 'Starting'),
    running: m('running'),
    paused: m('paused'),
    cancelling: m('running', 'Cancelling'),
    completed: m('succeeded'),
    failed: m('failed'),
    cancelled: m('skipped', 'Cancelled'),
  } satisfies Record<RunStatus, StatusMapping | null>,

  stageRun: {
    pending: m('queued'),
    queued: m('queued'),
    running: m('running'),
    paused: m('paused'),
    completed: m('succeeded'),
    failed: m('failed'),
    cancelled: m('skipped', 'Cancelled'),
    skipped: m('skipped'),
    sleeping: m('waiting'),
    awaiting_input: m('needs_you'),
  } satisfies Record<StageRunStatus, StatusMapping | null>,

  legacyWorkflow: {
    pending: m('queued'),
    queued: m('queued'),
    running: m('running'),
    paused: m('paused'),
    completed: m('succeeded'),
    failed: m('failed'),
    cancelled: m('skipped', 'Cancelled'),
  } satisfies Record<WorkflowStatus, StatusMapping | null>,

  automationExecution: {
    pending: m('queued'),
    running: m('running'),
    completed: m('succeeded'),
    partial: m('failed', 'Partly failed'),
    failed: m('failed'),
    cancelled: m('skipped', 'Cancelled'),
  } satisfies Record<AutomationExecutionStatus, StatusMapping | null>,

  automationRunItem: {
    pending: m('queued'),
    running: m('running'),
    completed: m('succeeded'),
    failed: m('failed'),
    cancelled: m('skipped', 'Cancelled'),
  } satisfies Record<AutomationRunItemStatus, StatusMapping | null>,

  backgroundTask: {
    spawned: m('queued', 'Starting'),
    running: m('running'),
    needs_review: m('needs_you', 'Needs review'),
    completed: m('succeeded', 'Done'),
    failed: m('failed'),
    cancelled: m('skipped', 'Cancelled'),
  } satisfies Record<BackgroundTaskStatus, StatusMapping | null>,

  /** Lifecycle only; "Archived" renders as a neutral chip, not a status badge. */
  chat: {
    active: null,
    archived: null,
  } satisfies Record<ChatStatus, StatusMapping | null>,

  stream: {
    idle: null,
    pending: m('running', 'Starting'),
    streaming: m('running'),
    thinking: m('running', 'Thinking'),
    complete: m('succeeded', 'Done'),
    error: m('failed'),
  } satisfies Record<StreamStatus, StatusMapping | null>,

  session: {
    created: m('queued'),
    active: null,
    paused: m('paused'),
    closing: m('running', 'Closing'),
    closed: null,
    error: m('failed'),
  } satisfies Record<SessionStatus, StatusMapping | null>,

  /** Use `toolCallStatus(block)`: a completed call with `error: true` is failed. */
  toolCall: {
    running: m('running'),
    complete: m('succeeded'),
  } satisfies Record<ToolCallStatus, StatusMapping | null>,

  hook: {
    running: m('running'),
    ok: m('succeeded'),
    failed: m('failed'),
  } satisfies Record<HookInvocationStatus, StatusMapping | null>,

  question: {
    pending: m('needs_you'),
    answered: m('succeeded', 'Answered'),
    expired: m('skipped', 'Expired'),
  } satisfies Record<QuestionStatus, StatusMapping | null>,

  permission: {
    pending: m('needs_you'),
    allowed: m('succeeded', 'Allowed'),
    denied: m('skipped', 'Denied'),
    expired: m('skipped', 'Expired'),
  } satisfies Record<PermissionStatus, StatusMapping | null>,

  plan: {
    drafting: m('running', 'Drafting'),
    recorded: m('succeeded', 'Recorded'),
    awaiting_review: m('needs_you', 'Review'),
    changes_requested: m('running', 'Revising'),
    approved: m('succeeded', 'Approved'),
    rejected: m('skipped', 'Rejected'),
    superseded: m('skipped', 'Superseded'),
    expired: m('skipped', 'Expired'),
  } satisfies Record<PlanStatus, StatusMapping | null>,

  interaction: {
    pending: m('needs_you'),
    approved: m('succeeded', 'Approved'),
    changes_requested: m('succeeded', 'Changes requested'),
    answered: m('succeeded', 'Answered'),
    rejected: m('skipped', 'Rejected'),
    cancelled: m('skipped', 'Cancelled'),
    expired: m('skipped', 'Expired'),
    failed: m('failed'),
  } satisfies Record<AgentInteractionStatus, StatusMapping | null>,

  reviewThread: {
    draft: m('queued', 'Draft'),
    pending: m('queued', 'Pending'),
    submitted: m('running', 'Sent'),
    addressed: m('succeeded', 'Addressed'),
    resolved: m('succeeded', 'Resolved'),
    outdated: m('skipped', 'Outdated'),
  } satisfies Record<ReviewThreadStatus, StatusMapping | null>,

  ciCheck: {
    pending: m('running'),
    success: m('succeeded'),
    failure: m('failed'),
    neutral: m('skipped', 'Neutral'),
    cancelled: m('skipped', 'Cancelled'),
    unknown: null,
  } satisfies Record<CheckConclusion, StatusMapping | null>,

  scmStep: {
    done: m('succeeded'),
    skipped: m('skipped'),
    failed: m('failed'),
    blocked: m('needs_you', 'Blocked'),
  } satisfies Record<ScmFlowStep['status'], StatusMapping | null>,

  scmResult: {
    ok: m('succeeded'),
    conflicts: m('needs_you', 'Conflicts'),
    blocked: m('needs_you', 'Blocked'),
    failed: m('failed'),
  } satisfies Record<ScmFlowResult['status'], StatusMapping | null>,

  deviceLogin: {
    pending: m('needs_you', 'Enter code'),
    complete: m('succeeded', 'Connected'),
    expired: m('skipped', 'Expired'),
    error: m('failed'),
  } satisfies Record<DeviceLoginStatus['status'], StatusMapping | null>,

  /** Covers `WidgetInstanceStatus` and the transcript's `WidgetBlockStatus` (a subset). */
  widget: {
    active: null,
    suspended: m('paused', 'Suspended'),
    closed: null,
    error: m('failed'),
  } satisfies Record<WidgetInstanceStatus, StatusMapping | null>,

  browserSession: {
    off: null,
    starting: m('running', 'Starting'),
    active: null,
    idle: null,
    terminated: m('skipped', 'Closed'),
    error: m('failed'),
  } satisfies Record<BrowserSessionStatus, StatusMapping | null>,
} as const;

export type StatusDomain = keyof typeof STATUS_MAPS;
export type StatusValue<D extends StatusDomain> = keyof (typeof STATUS_MAPS)[D] & string;

/** Default-word overrides per domain (chats say "Done", not "Succeeded"). */
export const STATUS_DOMAIN_LABELS: Partial<Record<StatusDomain, Partial<Record<StatusState, string>>>> = {
  chat: { succeeded: 'Done' },
  stream: { succeeded: 'Done' },
  backgroundTask: { succeeded: 'Done' },
};

/** The raw mapping for one value, or null when the value is not a run status. */
export function toStatus<D extends StatusDomain>(domain: D, value: StatusValue<D>): StatusMapping | null {
  const map = STATUS_MAPS[domain] as Record<string, StatusMapping | null>;
  return map[value] ?? null;
}

export interface ResolvedStatus {
  state: StatusState;
  /** The word to render: mapping label, else the domain's word, else the state's default. */
  label: string;
  def: StatusStateDef;
}

/** Applies the label precedence to a mapping. */
export function resolveMapping(mapping: StatusMapping, domain?: StatusDomain): ResolvedStatus {
  const def = STATUS_STATE_DEFS[mapping.state];
  const domainLabel = domain ? STATUS_DOMAIN_LABELS[domain]?.[mapping.state] : undefined;
  return { state: mapping.state, label: mapping.label ?? domainLabel ?? def.label, def };
}

/** Everything a badge needs for one value, or null for "not a status". */
export function resolveStatus<D extends StatusDomain>(domain: D, value: StatusValue<D>): ResolvedStatus | null {
  const mapping = toStatus(domain, value);
  return mapping ? resolveMapping(mapping, domain) : null;
}

/** Tool calls carry failure as `error: true` on a completed block. */
export function toolCallStatus(block: { status: ToolCallStatus; error?: boolean }): StatusMapping {
  if (block.status === 'complete' && block.error === true) return m('failed');
  return STATUS_MAPS.toolCall[block.status];
}

/**
 * A chat's activity badge: Needs you whenever a plan/question/permission gate is
 * pending (it outranks the stream), else the stream's state. Null when idle.
 */
export function chatActivity(input: { stream: StreamStatus; pendingInteraction: boolean }): StatusMapping | null {
  if (input.pendingInteraction) return m('needs_you');
  return STATUS_MAPS.stream[input.stream];
}
