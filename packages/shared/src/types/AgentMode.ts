/**
 * Agent modes — how the agent is allowed to behave for a turn.
 *
 * ## Why a registry and not a union of `if` branches
 *
 * A mode is not a label; it is a *bundle of behaviours*: which permission
 * policy applies, whether a produced plan blocks for approval, whether the
 * agent may open a blocking question gate, and what extra instructions it
 * receives. Encoding those as scattered `if (mode === 'plan')` checks means
 * every new mode is a cross-cutting edit across the server, both provider
 * adapters, and the web client.
 *
 * Instead every behavioural decision reads {@link AGENT_MODE_REGISTRY}. Adding
 * a mode is a single entry here plus a UI label — no call site changes.
 *
 * ## Provider mapping
 * - Copilot SDK: `session.rpc.mode.set` + `onExitPlanModeRequest` / `onUserInputRequest`
 * - Claude Agent SDK: `permissionMode: 'plan'` + `ExitPlanMode` / `AskUserQuestion`
 *   routed through `canUseTool`
 *
 * See docs/PLAN_MODE_RESEARCH_AND_ARCHITECTURE.md
 */

// ────────────────────────────────────────────────────────────────
// Agent mode
// ────────────────────────────────────────────────────────────────

/**
 * How the agent should behave for a turn.
 *
 * - `auto` — the agent works and edits directly, approving its own tool use.
 *   If asked for a plan it still produces one (recorded, non-blocking) and
 *   then implements it without waiting.
 * - `plan` — the agent researches and proposes a plan, then BLOCKS for human
 *   approval. Writes are structurally impossible until approved.
 *
 * Extend by adding a member here plus an {@link AGENT_MODE_REGISTRY} entry.
 */
export type AgentMode = 'auto' | 'plan';

/**
 * Permission policy handed to the harness for a turn.
 *
 * Mirrors the union in `IAgentHarness.HarnessPermissionMode`; duplicated here
 * because `@generatorai/shared` must not depend on `@generatorai/core`.
 */
export type AgentPermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'plan'
  | 'dontAsk';

/**
 * How a plan produced during this mode is handled.
 *
 * - `blocking`     — open a durable gate and suspend the agent until a human decides.
 * - `non_blocking` — record the plan, surface it in the UI, let the agent continue.
 * - `none`         — no plan capture at all.
 */
export type PlanGateBehaviour = 'blocking' | 'non_blocking' | 'none';

/** The complete behavioural contract for a mode. */
export interface AgentModeDescriptor {
  mode: AgentMode;
  /** Short UI label. */
  label: string;
  /** One-line UI description. */
  description: string;
  /** Permission policy forced for turns in this mode. */
  permissionMode: AgentPermissionMode;
  /** What happens when the agent produces a plan. */
  planGate: PlanGateBehaviour;
  /**
   * Whether the agent may open a BLOCKING clarifying-question gate.
   * Off for unattended modes, where nobody is watching to answer.
   */
  questionGate: boolean;
  /**
   * Whether the agent is expected to call the host-provided `record_plan`
   * tool. Only meaningful when `planGate === 'non_blocking'`: the native
   * exit-plan-mode tool is not registered outside plan mode, so a
   * non-blocking plan needs its own capture path.
   */
  usesRecordPlanTool: boolean;
}

export const AGENT_MODE_REGISTRY: Readonly<Record<AgentMode, AgentModeDescriptor>> = {
  auto: {
    mode: 'auto',
    label: 'Auto',
    description: 'Works autonomously and applies changes directly.',
    // A labelled mode the user selects explicitly. The fallback for chats that
    // never chose one is set by the server from its deployment posture — see
    // core/services/agentModePolicy.setDefaultChatPermissionMode.
    permissionMode: 'bypassPermissions', // security-ok: explicit user-selected mode, not a silent default
    planGate: 'non_blocking',
    questionGate: false,
    usesRecordPlanTool: true,
  },
  plan: {
    mode: 'plan',
    label: 'Plan',
    description: 'Proposes a plan and waits for your approval before implementing.',
    // Forcing 'plan' is what makes writes structurally un-auto-approvable
    // while planning — it is not advisory.
    permissionMode: 'plan',
    planGate: 'blocking',
    questionGate: true,
    usesRecordPlanTool: false,
  },
} as const;

export const DEFAULT_AGENT_MODE: AgentMode = 'auto';

export const AGENT_MODES: readonly AgentMode[] = ['auto', 'plan'] as const;

export function isAgentMode(value: unknown): value is AgentMode {
  return value === 'auto' || value === 'plan';
}


/** The behavioural contract for a mode. Unknown input falls back to the default. */
export function agentModeDescriptor(mode: AgentMode | undefined): AgentModeDescriptor {
  return AGENT_MODE_REGISTRY[mode ?? DEFAULT_AGENT_MODE] ?? AGENT_MODE_REGISTRY[DEFAULT_AGENT_MODE];
}

// ────────────────────────────────────────────────────────────────
// Plan documents
// ────────────────────────────────────────────────────────────────

/** What the user may choose to do once a plan is ready. */
export type PlanAction = 'exit_only' | 'implement_interactive' | 'implement_autopilot';

export const PLAN_ACTIONS: readonly PlanAction[] = [
  'exit_only',
  'implement_interactive',
  'implement_autopilot',
] as const;

export function isPlanAction(value: unknown): value is PlanAction {
  return (
    value === 'exit_only' || value === 'implement_interactive' || value === 'implement_autopilot'
  );
}

export type PlanStatus =
  /** The agent is planning; no plan submitted yet. */
  | 'drafting'
  /** Captured in a non-blocking mode — informational, never gated. */
  | 'recorded'
  /** Gate is open and blocking the agent. */
  | 'awaiting_review'
  /** The user sent feedback; the agent is revising. */
  | 'changes_requested'
  /** Approved — implementation authorised. */
  | 'approved'
  /** Declined — the agent exits plan mode without implementing. */
  | 'rejected'
  /** A newer plan replaced this one. */
  | 'superseded'
  /** Server restarted / turn cancelled while the gate was pending. */
  | 'expired';

export interface PlanRevision {
  /** 1-based. */
  revision: number;
  content: string;
  summary: string;
  authoredBy: 'agent' | 'user';
  createdAt: Date;
}

/**
 * Anchor for an inline review comment.
 *
 * Line numbers alone drift between revisions, so we also persist the quoted
 * text and a content hash (same approach as the v19 review-thread migration).
 */
export interface PlanCommentAnchor {
  startLine: number;
  endLine: number;
  quotedText: string;
  contentHash: string;
}

export interface PlanComment {
  id: string;
  planId: string;
  revision: number;
  anchor?: PlanCommentAnchor;
  body: string;
  resolved: boolean;
  createdAt: Date;
}

export interface PlanDecision {
  approved: boolean;
  action?: PlanAction;
  feedback?: string;
  /** Present when the user edited the plan before approving. */
  editedContent?: string;
  decidedAt: Date;
}

/** Where a plan came from — a chat turn or a workflow stage run. */
export interface PlanScope {
  kind: 'chat' | 'stage_run';
  /** chatId for `chat`, stageRunId for `stage_run`. */
  id: string;
}

export interface PlanDocument {
  id: string;
  chatId: string;
  sessionId: string;
  /** The turn (chat) or stage run that produced the current revision. */
  turnId: string;
  /** Set when the plan belongs to a workflow stage rather than a chat turn. */
  stageRunId?: string;
  workflowRunId?: string;
  title: string;
  /** Server-generated, e.g. `2026-07-29-add-oauth-login.md`. Never provider-supplied. */
  fileName: string;
  /** Absolute path of the workspace projection, when materialised. */
  filePath?: string;
  status: PlanStatus;
  currentRevision: number;
  revisions: PlanRevision[];
  harnessType: string;
  availableActions: PlanAction[];
  recommendedAction?: PlanAction;
  decision?: PlanDecision;
  comments: PlanComment[];
  createdAt: Date;
  updatedAt: Date;
}

/** Compact projection embedded in the chat transcript. */
export interface PlanCardSummary {
  planId: string;
  revision: number;
  title: string;
  fileName: string;
  summary: string;
  status: PlanStatus;
  /**
   * Position of this card among the turn's ordered items (tool calls and
   * cards share one counter). Replay sorts on it so a rebuilt transcript
   * reads in the order the user lived through, instead of appending every
   * card after the final answer. Absent on messages persisted before the
   * ordinal existed.
   */
  sequence?: number;
}

// ────────────────────────────────────────────────────────────────
// Interactive questions
// ────────────────────────────────────────────────────────────────

export interface AgentQuestionOption {
  /** Display text (1-5 words). */
  label: string;
  /** What choosing this means / its trade-offs. */
  description?: string;
  /** Optional markdown preview rendered when the option is focused. */
  preview?: string;
}

export interface AgentQuestion {
  id: string;
  /** Short chip label — Claude caps this at 12 characters. */
  header: string;
  question: string;
  /** 2-4 options for Claude; may be empty for a freeform-only Copilot question. */
  options: AgentQuestionOption[];
  multiSelect: boolean;
  /**
   * Whether the UI should offer an "Other…" free-text row. Claude's contract
   * says the host must provide it (the model is told not to emit one).
   */
  allowFreeform: boolean;
}

export interface AgentQuestionResponse {
  /** questionId → selected label(s), or the user's free text. */
  answers: Record<string, string[]>;
  /**
   * Set when the user dismissed the card and replied generally instead of
   * answering the structured questions.
   */
  freeformResponse?: string;
}

/** Compact projection embedded in the chat transcript. */
export interface QuestionCardSummary {
  interactionId: string;
  questions: AgentQuestion[];
  response?: AgentQuestionResponse;
  status: 'pending' | 'answered' | 'expired';
  /** See {@link PlanCardSummary.sequence}. */
  sequence?: number;
}

// ────────────────────────────────────────────────────────────────
// Human-interaction gates
// ────────────────────────────────────────────────────────────────

export type AgentInteractionKind = 'plan_review' | 'question' | 'tool_permission';

export type AgentInteractionStatus =
  | 'pending'
  | 'approved'
  | 'changes_requested'
  | 'answered'
  | 'rejected'
  | 'cancelled'
  | 'expired'
  | 'failed';

export const TERMINAL_INTERACTION_STATUSES: readonly AgentInteractionStatus[] = [
  'approved',
  'changes_requested',
  'answered',
  'rejected',
  'cancelled',
  'expired',
  'failed',
] as const;

export interface AgentInteraction {
  id: string;
  scopeKind: 'chat' | 'stage_run';
  scopeId: string;
  chatId?: string;
  sessionId?: string;
  turnId?: string;
  kind: AgentInteractionKind;
  status: AgentInteractionStatus;
  payload: unknown;
  resolution?: unknown;
  createdAt: Date;
  resolvedAt?: Date;
  expiresAt?: Date;
}

// ────────────────────────────────────────────────────────────────
// Tool permission gates (chat)
//
// The `tool_permission` interaction kind. For chats it is opened by
// `ChatManagementService.buildPermissionHandler` whenever the harness asks
// `onPermissionRequest` and the turn's permission mode does not auto-allow the
// call; the durable row is what lets a phone, the TUI and a second browser tab
// all render (and any one of them answer) the same prompt.
// ────────────────────────────────────────────────────────────────

/** Domain classification of what a tool call does — mirrors `PermissionRequest.type` in core. */
export type ToolPermissionType = 'file_write' | 'file_read' | 'shell_exec' | 'network' | 'other';

/** Payload persisted on a `tool_permission` interaction and carried by `chat.permission.requested`. */
export interface ToolPermissionRequestPayload {
  /** Harness tool name (`Bash`, `WebFetch`, Copilot `shell`, …). */
  toolName: string;
  type: ToolPermissionType;
  /** Human-readable description supplied by the harness. */
  description: string;
  /** Bounded, display-safe rendering of the tool input (never the raw object). */
  inputSummary: string;
  /** Effective permission mode of the turn that raised the prompt. */
  permissionMode: AgentPermissionMode;
}

/** What the user posts back to `POST /chats/:id/interactions/:interactionId/permission`. */
export interface ToolPermissionResolution {
  behavior: 'allow' | 'deny';
  /** Optional reason relayed to the agent when denying. */
  message?: string;
}

/** Compact projection embedded in the chat transcript. */
export interface PermissionCardSummary {
  interactionId: string;
  toolName: string;
  type: ToolPermissionType;
  description: string;
  inputSummary: string;
  status: 'pending' | 'allowed' | 'denied' | 'expired';
  message?: string;
  /** See {@link PlanCardSummary.sequence}. */
  sequence?: number;
}

/** Resolution the UI posts back for a plan review gate. */
export interface PlanReviewResolution {
  approved: boolean;
  action?: PlanAction;
  feedback?: string;
  editedContent?: string;
  reason?: string;
}

// ────────────────────────────────────────────────────────────────
// Workflow stage review
// ────────────────────────────────────────────────────────────────

/**
 * Outcome of a workflow stage completion review.
 *
 * `approved`/`changes_requested` map onto the pre-existing boolean
 * `InterruptResolution.approved`; `rejected` is the new terminal verdict that
 * fails the stage and blocks every downstream stage.
 */
export type StageReviewOutcome = 'approved' | 'changes_requested' | 'rejected';

export const STAGE_REVIEW_OUTCOMES: readonly StageReviewOutcome[] = [
  'approved',
  'changes_requested',
  'rejected',
] as const;

export function isStageReviewOutcome(value: unknown): value is StageReviewOutcome {
  return value === 'approved' || value === 'changes_requested' || value === 'rejected';
}
