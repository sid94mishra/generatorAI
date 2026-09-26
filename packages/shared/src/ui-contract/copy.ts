// ────────────────────────────────────────────────────────────────
// Shared UI copy (08 M-13): the words gate cards and the transcript show, so
// web and (next pass) mobile say the same thing. Status labels live with the
// status map (`../status/states.ts`); empty states arrive with P5-01.
//
// Constants only, dependency-free. Functions here only interpolate.
// ────────────────────────────────────────────────────────────────

import type { ComputerConsentGateAction, PermissionGateAction, PlanGateAction, QuestionGateAction } from './gates.js';

/** Words of the tool-permission gate (B-20 PermissionCard). */
export const PERMISSION_GATE_COPY = {
  title: 'Allow this command?',
  titleAllowed: 'Tool call allowed',
  titleDenied: 'Tool call denied',
  titleExpired: 'Permission request expired',
  actions: {
    deny: 'Deny',
    allow_once: 'Allow once',
    confirm_deny: 'Confirm deny',
    cancel_deny: 'Cancel',
  } satisfies Record<PermissionGateAction, string>,
  /** Accessible names carry the tool so several open cards stay distinguishable. */
  actionLabel: (action: PermissionGateAction, toolName: string): string =>
    action === 'allow_once'
      ? `Allow ${toolName}`
      : action === 'deny'
        ? `Deny ${toolName}`
        : action === 'confirm_deny'
          ? `Confirm deny ${toolName}`
          : 'Cancel',
  denyReasonLabel: 'Reason for denying (optional)',
  denyReasonPlaceholder: 'Why deny this? (optional)',
  outcomeAllowed: 'Allowed',
  outcomeDenied: 'Denied',
  expired: 'This request is no longer answerable — the agent’s turn ended.',
} as const;

/** Words of the clarifying-question gate (B-20 QuestionCard). */
export const QUESTION_GATE_COPY = {
  title: 'The agent needs your input',
  titleAnswered: 'You answered',
  titleExpired: 'Question expired',
  actions: {
    submit_answers: 'Submit answers',
    skip_questions: 'Skip & let the agent decide',
    next_question: 'Next question',
  } satisfies Record<QuestionGateAction, string>,
  /** The answer the "skip" action sends in place of choices. */
  skipResponse: 'Skip the questions and use your best judgement.',
  other: 'Other…',
  otherPlaceholder: 'Type your own answer',
  leftToAgent: 'Left to the agent to decide.',
  previous: 'Previous question',
  next: 'Next question',
  pager: (current: number, total: number): string => `${current} / ${total}`,
  sent: 'Answers sent to the agent',
  expired: 'This question is no longer answerable — the agent’s turn ended.',
} as const;

/** Words of the plan-review gate (B-20 PlanReadyCard). */
export const PLAN_GATE_COPY = {
  title: 'Plan ready for review',
  actions: {
    open_plan: 'Review plan',
    approve: 'Approve & implement',
    approve_autopilot: 'Approve & run autonomously',
    request_changes: 'Request changes',
    send_feedback: 'Send feedback',
    cancel_feedback: 'Cancel',
  } satisfies Record<PlanGateAction, string>,
  autopilotHint: 'Skips per-action prompts while implementing.',
  moreApprovalOptions: 'More approval options',
  openPlan: (title: string): string => `Open plan ${title}`,
  revision: (n: number): string => `Revision ${n}`,
  feedbackLabel: 'What should change?',
  feedbackPlaceholder: 'Be specific — this goes straight to the agent.',
  status: {
    drafting: 'Drafting',
    recorded: 'Recorded',
    awaiting_review: 'Needs review',
    changes_requested: 'Changes requested',
    approved: 'Approved',
    rejected: 'Discarded',
    superseded: 'Superseded',
    expired: 'Expired',
  },
} as const;

/** Words of the computer-use consent gate (B-20 ComputerConsentCard; G-07). */
export const COMPUTER_CONSENT_GATE_COPY = {
  title: (agent: string): string => `Allow ${agent} to control this computer?`,
  reachSynthetic: 'Keyboard & mouse',
  reachAccessibility: 'Screen & accessibility',
  actions: {
    consent_deny: 'Deny',
    consent_allow_once: 'Allow once',
    consent_allow_run: 'Allow for this chat',
    consent_always_allow: 'Always allow',
  } satisfies Record<ComputerConsentGateAction, string>,
  scopeLabel: 'Scope',
  scopeApp: (app: string): string => `${app} only`,
  scopeAny: 'Any app',
  plannedActions: 'Planned actions',
} as const;

/** Transcript chrome words (B-14…B-24). */
export const TRANSCRIPT_COPY = {
  you: 'You',
  justNow: 'just now',
  thinking: 'Thinking…',
  thought: 'Thought',
  thoughtFor: (duration: string): string => `Thought for ${duration}`,
  generating: 'Generating',
  stoppedPartial: 'Stopped before the response finished.',
  stoppedEmpty: 'Stopped before the agent responded.',
  jumpToLatest: 'Jump to latest',
  loadEarlier: 'Load earlier messages',
  emptyTitle: 'Start the conversation',
  emptyBody: (agent: string | null): string =>
    agent ? `Type a message below to chat with ${agent}` : 'Type a message below to start chatting',
  agentThinking: (agent: string): string => `${agent} is thinking`,
  waitingForYou: 'Waiting for you',
  failed: 'Failed',
  openWorkerChat: 'Open worker chat',
  openFullDiff: 'Open full diff',
  showRawToolCall: 'Show raw tool call',
  hideRawToolCall: 'Hide raw tool call',
  showInChanges: (path: string): string => `Show ${path} in changes view`,
  openInTerminal: 'Open this command in the terminal view',
  openScreenshot: (label: string): string => `Open screenshot ${label}`,
  steps: (n: number): string => `${n} step${n === 1 ? '' : 's'}`,
  inBackground: 'in background',
  viewMode: 'Transcript view',
  viewModes: { normal: 'Normal', verbose: 'Verbose', summary: 'Summary' },
  delegated: (n: number): string => `Delegated ${n} task${n === 1 ? '' : 's'}`,
  find: 'Find in transcript',
} as const;

/** The three transcript view modes (G-06; client-only). */
export const TRANSCRIPT_VIEW_MODES = ['normal', 'verbose', 'summary'] as const;
export type TranscriptViewMode = (typeof TRANSCRIPT_VIEW_MODES)[number];
