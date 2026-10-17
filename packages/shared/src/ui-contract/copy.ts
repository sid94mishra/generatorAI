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
  /** Fallback only: a card names its action with `permissionWording` (D-107). */
  title: 'Allow this tool call?',
  titleAllowed: 'Tool call allowed',
  titleDenied: 'Tool call denied',
  titleExpired: 'Permission request expired',
  /** MG-04 — the server marked the gate risky (a phone must sign the answer). */
  risky: 'Risky',
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
  /** U-16 (D-147): the secondary action that remembers the gate's rules for its owner. */
  allowForOwner: (summary: string, scope: PermissionRuleScope): string => `Allow ${summary} for this ${scope}`,
  allowForOwnerLabel: (rules: string, scope: PermissionRuleScope): string => `Always allow ${rules} in this ${scope}`,
  /** The settled card of a remembered answer. */
  outcomeRemembered: (rules: string, scope: PermissionRuleScope): string => `Allowed for this ${scope}: ${rules}`,
  /** The transcript note of a request a remembered rule allowed. */
  autoAllowed: (rules: string, scope: PermissionRuleScope): string => `Allowed by a rule for this ${scope}: ${rules}`,
  /** The menus that list an owner's rules. */
  rulesCount: (n: number): string => (n === 1 ? '1 rule' : `${n} rules`),
  clearRules: 'Clear',
} as const;

/** Who remembered permission rules belong to (U-16): a chat for its lifetime, a workflow run for all its stages. */
export type PermissionRuleScope = 'chat' | 'run';

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
  /** The label over the person's reply to a revision, shown in the transcript where they sent it. */
  note: { changes_requested: 'Changes requested', approved: 'Approved with notes' },
  /** A decision that carried only inline comments. */
  commentsNote: (n: number): string => `${n} comment${n === 1 ? '' : 's'} on the plan`,
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
  /** Provider-neutral (D-90): the empty chat never names the harness. */
  emptyBody: 'Type a message below to start.',
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
  /** Summary mode's line under a live turn: "Working · 7 steps". */
  workingSteps: (n: number): string => (n > 0 ? `Working · ${n} step${n === 1 ? '' : 's'}` : 'Working'),
  inBackground: 'in background',
  viewMode: 'Transcript view',
  viewModes: { normal: 'Normal', verbose: 'Verbose', summary: 'Summary' },
  delegated: (n: number): string => `Delegated ${n} task${n === 1 ? '' : 's'}`,
  find: 'Find in transcript',
  showMore: 'Show more',
  showLess: 'Show less',
} as const;

/**
 * Workflow conversation turns (`chat_messages.turn_role`) the transcript labels: a stage
 * session's user rows are the engine's prompts, not something a person typed. `icon` is an
 * `IconConcept` id kept as a plain string (see EMPTY_STATE_COPY).
 */
export const TURN_ROLE_LABELS: Readonly<Record<string, { label: string; icon: string }>> = {
  prompt: { label: 'Stage prompt', icon: 'user' },
  iteration_input: { label: 'Iteration input', icon: 'download' },
  operator: { label: 'Operator message', icon: 'message' },
  digest: { label: 'Conversation digest', icon: 'layers' },
  wrap_up: { label: 'Wrap-up prompt', icon: 'archive' },
};

/** The three transcript view modes (G-06; client-only). */
export const TRANSCRIPT_VIEW_MODES = ['normal', 'verbose', 'summary'] as const;
export type TranscriptViewMode = (typeof TRANSCRIPT_VIEW_MODES)[number];

// ── Empty-state copy (M-13, P5-01) ─────────────────────────────────────────
// ────────────────────────────────────────────────────────────────
// Shared empty-state copy (M-13, `08-mobile-readiness.md`). One icon/title/
// description per "nothing here" state, so web (P-41 EmptyState) and, next
// pass, mobile show the exact same sentence for the exact same reason
// instead of each inventing its own (D-40). Status labels live with the
// status map (`packages/shared/src/status`, P1-T10) and gate-card action
// copy lands with the transcript kit (P4-07); this file is P5-01's slice:
// the list/grid empty states the kit's EntityRow, EntityCard/CardGrid, and
// the Home sections (L-01 Dashboard) need.
//
// `icon` is an `IconConcept` id (`packages/design-tokens`) kept as a plain
// string — this module stays free of that package's dependency, the same
// reason `StatusStateDef.glyph` (status/states.ts) is `status-${string}`
// rather than a typed import.
// ────────────────────────────────────────────────────────────────

export interface EmptyStateCopy {
  icon: string;
  title: string;
  description: string;
}

export const EMPTY_STATE_COPY = {
  chats: { icon: 'chats', title: 'No chats yet', description: 'Start a chat to see it here.' },
  projects: { icon: 'projects', title: 'No projects yet', description: 'Create a project to group codebases and chats.' },
  codebases: { icon: 'projects', title: 'No codebases yet', description: 'Add a codebase to give agents something to work on.' },
  agents: { icon: 'agents', title: 'No agents yet', description: 'Create an agent to give it a name, a model and a job.' },
  workflows: { icon: 'workflows', title: 'No workflows yet', description: 'Build a workflow to automate a repeatable task.' },
  automations: { icon: 'automations', title: 'No automations yet', description: 'Schedule a workflow to run automatically.' },
  scripts: { icon: 'scripts', title: 'No scripts yet', description: 'Add a script to run repeatable commands.' },
  runs: { icon: 'activity', title: 'No runs yet', description: 'Runs appear here once a workflow starts.' },
  pullRequests: { icon: 'pr', title: 'No pull requests yet', description: 'Pull requests opened from a chat appear here.' },
  needsYou: { icon: 'hand', title: 'Nothing needs you', description: 'You are all caught up.' },
  running: { icon: 'status-running', title: 'Nothing running', description: 'Started chats and runs appear here.' },
  recentlyFinished: { icon: 'status-succeeded', title: 'Nothing finished yet', description: 'Completed chats and runs appear here.' },
  searchResults: { icon: 'search', title: 'No results', description: 'Try a different search.' },
  // Mobile states (mobile 10-design-feedback MDF-136, added additively in M4-09).
  archivedChats: { icon: 'archive', title: 'No archived chats', description: 'Chats you archive appear here.' },
  changes: { icon: 'changes', title: 'No changes', description: 'Files the agent changes appear here.' },
  backgroundTasks: { icon: 'tasks', title: 'No background tasks', description: 'Work the orchestrator delegates appears here.' },
  plan: { icon: 'plan', title: 'No plan yet', description: 'Plans the agent writes appear here.' },
  worktrees: { icon: 'branch', title: 'No worktrees', description: 'Worktrees appear when a chat or run starts here.' },
  executions: { icon: 'activity', title: 'No executions yet', description: 'Each run of this automation appears here.' },
  skills: { icon: 'skills', title: 'No skills', description: 'Upload a skill to teach agents a task.' },
  prompts: { icon: 'message', title: 'No prompts', description: 'Saved prompts appear here.' },
  mcpServers: { icon: 'mcp', title: 'No MCP servers', description: 'Add a server to give agents more tools.' },
  templates: { icon: 'layout', title: 'No templates', description: 'Templates appear here.' },
  extensions: { icon: 'layers', title: 'No extensions', description: 'Installed extensions appear here.' },
  accessRequests: { icon: 'key', title: 'No access requests', description: 'Requests from other devices appear here.' },
  versions: { icon: 'history', title: 'No earlier versions', description: 'Published versions appear here.' },
  builderEmpty: { icon: 'workflows', title: 'No stages yet', description: 'Add the first stage to start.' },
} as const satisfies Record<string, EmptyStateCopy>;

export type EmptyStateKey = keyof typeof EMPTY_STATE_COPY;
