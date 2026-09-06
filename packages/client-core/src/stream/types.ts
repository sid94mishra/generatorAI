// ────────────────────────────────────────────────────────────────
// The stream block model.
//
// A turn is an ORDERED list of blocks, not a set of parallel buffers.
// That ordering is the whole point: thinking, text and tool calls must
// render in the sequence the model produced them, and any representation
// that keeps them in separate arrays loses that permanently.
//
// Every client (web, desktop, mobile) renders exactly this model.
// ────────────────────────────────────────────────────────────────

import type { PlanStatus } from '@generatorai/shared';

import type { ContextUsageSnapshot } from './contextUsage.js';

export type StreamStatus = 'idle' | 'pending' | 'streaming' | 'thinking' | 'complete' | 'error';

export interface ThinkingBlock {
  type: 'thinking';
  blockId: number;
  text: string;
  isComplete: boolean;
}

export interface TextBlock {
  type: 'text';
  blockId: number;
  content: string;
}

/** Per-operation file-change stats (from `harness.tool_complete.fileOp`). */
export interface ToolFileOp {
  kind: 'create' | 'update' | 'edit' | 'delete';
  filePath: string;
  additions: number;
  deletions: number;
}

export interface ToolCallBlock {
  type: 'tool_call';
  blockId: number;
  callId: string;
  tool: string;
  args: unknown;
  result?: unknown;
  status: 'running' | 'complete';
  /** +/− line stats for file write/edit tools, set on completion. */
  fileOp?: ToolFileOp;
  /** callId of the Agent tool call this ran inside (SDK subagent nesting). */
  parentCallId?: string;
}

/**
 * `warning` is distinct from `error` on purpose: the turn continues. It marks
 * something the user has to act on — an MCP server that failed to start or
 * needs credentials — which previously had nowhere to surface at all.
 */
export type SystemCategory = 'system' | 'subagent' | 'error' | 'warning';

export interface SystemBlock {
  type: 'system';
  blockId: number;
  message: string;
  category: SystemCategory;
}

/**
 * Widget block — an interactive UI rendered by an extension.
 *
 * The block carries only the identity, surface and props needed to mount
 * the sandboxed frame. Runtime state lives on the server (`WidgetInstance`)
 * and is kept current via `harness.widget.state` events.
 *
 * `surface` is `'inline'` (in the transcript) or `'widget'` (full-page).
 * Legacy values (`chat` / `canvas` / `right-pane`) are normalized at ingress.
 */
export interface WidgetBlock {
  type: 'widget';
  blockId: number;
  instanceId: string;
  descriptorId: string;
  extensionId: string;
  component: string;
  title?: string;
  surface: 'inline' | 'widget';
  assetsBase: string;
  entry: string;
  /** Initial props snapshot (from the render event). */
  props: unknown;
  /** Latest state received from a `harness.widget.state` event. */
  state?: unknown;
  status: 'active' | 'closed' | 'error';
  /** Optional error message when status='error'. */
  error?: string;
}

/**
 * Plan card, rendered inline in the transcript as a file-like chip.
 *
 * Carries identity and display data only; the full markdown is fetched over
 * REST so a long plan never bloats stream state.
 */
export interface PlanBlock {
  type: 'plan';
  blockId: number;
  planId: string;
  revision: number;
  title: string;
  /**
   * Server-generated plan file name. Optional because `chat.plan.created`
   * carries it but a later `review_requested` for the same plan may not —
   * `upsertPlan` merges, so the first value survives.
   */
  fileName?: string;
  summary: string;
  status: PlanStatus;
  actions: string[];
  recommendedAction?: string;
  /** Set once the gate opens; needed to post the decision. */
  interactionId?: string;
  /**
   * Client clock reading for when this card entered a blocking state.
   *
   * Reconciliation against the polled pending-gate list compares this with
   * the poll's fetch time, so a poll fired BEFORE the card existed can never
   * expire it. Removing this reintroduces a race that silently drops gates.
   */
  openedAt?: number;
}

/** An agent-authored clarifying question card. */
export interface QuestionBlock {
  type: 'question';
  blockId: number;
  interactionId: string;
  questions: Array<{
    id: string;
    header: string;
    question: string;
    options: Array<{ label: string; description?: string; preview?: string }>;
    multiSelect: boolean;
    allowFreeform: boolean;
  }>;
  status: 'pending' | 'answered' | 'expired';
  answers?: Record<string, string[]>;
  freeformResponse?: string;
  /** See {@link PlanBlock.openedAt}. */
  openedAt?: number;
}

/**
 * A blocking tool-permission prompt (review finding 5.1) — the agent
 * cannot proceed past this tool call until the user allows or denies it.
 *
 * Mirrors {@link QuestionBlock} deliberately: same card lifecycle
 * (pending → answered/expired), same replay story, same `openedAt`
 * reconciliation rule (see `PlanBlock.openedAt`).
 */
export interface PermissionBlock {
  type: 'permission';
  blockId: number;
  interactionId: string;
  toolName: string;
  /** `ToolPermissionType` from `@generatorai/shared` — kept as `string` here
   *  so client-core does not need to import shared's enum just to pass it
   *  through unchanged. */
  permissionType: string;
  description: string;
  /** Bounded, secret-redacted rendering of the tool input. Render verbatim
   *  as preformatted text — already safe for display. */
  inputSummary: string;
  /** Effective permission mode of the turn that raised the prompt. */
  permissionMode: string;
  status: 'pending' | 'allowed' | 'denied' | 'expired';
  /** Optional reason the user gave when denying. */
  message?: string;
  /** See {@link PlanBlock.openedAt}. */
  openedAt?: number;
}

export type StreamBlock =
  | ThinkingBlock
  | TextBlock
  | ToolCallBlock
  | SystemBlock
  | WidgetBlock
  | PlanBlock
  | QuestionBlock
  | PermissionBlock;

export interface StreamUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cost?: number;
  provider?: string;
}

export interface StreamToolCall {
  id: string;
  tool: string;
  args: unknown;
  result?: unknown;
  status: 'running' | 'complete';
  fileOp?: ToolFileOp;
  parentCallId?: string;
}

/**
 * One hook invocation, built from `hook.started`/`hook.completed`/
 * `hook.failed`. Feeds the run inspector's Hooks tab — previously these
 * events were narrated as system-message text and nothing else, so the tab
 * had no data to show and stayed permanently empty.
 */
export interface StreamHookInvocation {
  id: string;
  hookName: string;
  phase: string;
  hookType?: string;
  /** Present when the event carried one — lets consumers attribute the
   *  invocation to a stage rather than the run as a whole. */
  stageRunId?: string;
  status: 'running' | 'ok' | 'failed';
  durationMs?: number;
}

/** Everything known about one session's in-flight turn. */
export interface StreamState {
  /** Accumulated response text (all text blocks combined). */
  text: string;
  /** Accumulated thinking text. */
  thinkingText: string;
  status: StreamStatus;
  /** Flat tool-call list (kept for consumers that predate `blocks`). */
  toolCalls: StreamToolCall[];
  /** Flat system-message list (kept for consumers that predate `blocks`). */
  systemMessages: string[];
  /** Ordered blocks preserving temporal sequence — the source of truth. */
  blocks: StreamBlock[];
  /** Monotonically increasing; never reset on a new turn (React key safety). */
  _nextBlockId: number;
  /** Internal counter for synthesising tool-call ids. */
  _toolCallCounter: number;
  /** Hook invocations observed on this stream (see `StreamHookInvocation`). */
  hooks: StreamHookInvocation[];
  /** Internal counter for synthesising hook ids when `hookId` is absent. */
  _hookCounter: number;
  /** Optimistic user message, shown before the history refetch lands. */
  pendingUserMessage: string | null;
  /**
   * The user message that started the current turn. Consumers use it to
   * detect stale history during de-duplication: when history does not yet
   * contain this message, skip filtering so earlier turns stay visible.
   */
  turnUserMessage: string | null;
  /** Incremented on each `startPending`. Distinguishes turn ownership. */
  turnId: number;
  /**
   * Server-generated stable turn id from `copilot.turn_start`. When present,
   * consumers de-dup by matching message `metadata.turnId` (O(1),
   * collision-free) instead of comparing content. Null until it arrives.
   */
  serverTurnId: string | null;
  usage: StreamUsage | null;
  /**
   * Latest `harness.context_usage` snapshot — the provider's own view of how
   * full the context window is. Provider-reported snapshots take precedence
   * over derived ones; see `contextUsage.ts`.
   */
  contextUsage: ContextUsageSnapshot | null;
  /**
   * The user pressed Stop. Aborting is a round trip — the provider keeps
   * emitting for a moment — so this latches the turn out of its live statuses
   * while still accepting the content that is already on the wire. Cleared by
   * the next `startPending`.
   */
  cancelRequested: boolean;
  /**
   * W30-d — the agent is producing text that is deliberately not on screen yet.
   *
   * Only ever true on a surface whose `TransportCapabilities` declares
   * `highLatencyBlockDelivery`: there, `StreamEventRouter` holds partial text
   * back to the last markdown block boundary, because editing the message once
   * per chunk over a phone's link reads as a stutter rather than as typing.
   * The renderer shows a typing indicator for exactly as long as this is true.
   *
   * On every other surface this stays false and text lands per chunk, which is
   * what makes the mode observable rather than a constant.
   */
  typing: boolean;
  /**
   * Monotonic recency stamp, bumped by every reducer write to this entry.
   *
   * Exists so the record can be BOUNDED: `pruneStreams` evicts the
   * least-recently-touched entries once the cap is exceeded. It is a counter,
   * not a clock — see `reducer.ts` for why a millisecond timestamp is the
   * wrong ordering key here.
   */
  lastActivityAt: number;
}

/** All sessions, keyed by session id. */
export type StreamsRecord = Record<string, StreamState>;

export const DEFAULT_STREAM: Readonly<StreamState> = Object.freeze({
  text: '',
  thinkingText: '',
  status: 'idle' as const,
  toolCalls: [] as StreamToolCall[],
  systemMessages: [] as string[],
  blocks: [] as StreamBlock[],
  _nextBlockId: 0,
  _toolCallCounter: 0,
  hooks: [] as StreamHookInvocation[],
  _hookCounter: 0,
  pendingUserMessage: null,
  turnUserMessage: null,
  turnId: 0,
  serverTurnId: null,
  usage: null,
  contextUsage: null,
  cancelRequested: false,
  typing: false,
  lastActivityAt: 0,
});
