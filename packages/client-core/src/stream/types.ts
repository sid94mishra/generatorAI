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

export interface ToolCallBlock {
  type: 'tool_call';
  blockId: number;
  callId: string;
  tool: string;
  args: unknown;
  result?: unknown;
  status: 'running' | 'complete';
}

export type SystemCategory = 'system' | 'subagent' | 'error';

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

export type StreamBlock =
  | ThinkingBlock
  | TextBlock
  | ToolCallBlock
  | SystemBlock
  | WidgetBlock
  | PlanBlock
  | QuestionBlock;

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
  pendingUserMessage: null,
  turnUserMessage: null,
  turnId: 0,
  serverTurnId: null,
  usage: null,
  contextUsage: null,
});
