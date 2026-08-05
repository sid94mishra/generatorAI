// ────────────────────────────────────────────────────────────────
// Redesign sample — shared types
// This is a *proposal preview* only. Nothing in this folder is wired
// into the production chat / workflow pages. Feed it mock data and
// eyeball it at /__redesign/chat.
// ────────────────────────────────────────────────────────────────

/** `waiting` = the call is still open but blocked on the human, not the model. */
export type StepStatus = 'pending' | 'running' | 'waiting' | 'done' | 'failed';

export type StepKind =
  | 'read'
  | 'search'
  | 'edit'
  | 'run'
  | 'tool'
  | 'think'
  | 'subagent'
  | 'memory'
  | 'note'
  | 'error';

export interface TimelineStep {
  id: string;
  kind: StepKind;
  /** Short verb, e.g. "Read", "Searched", "Explore". */
  verb: string;
  /** The target of the verb, rendered mono if `mono` is true. */
  target: string;
  mono?: boolean;
  status: StepStatus;
  /** Short right-aligned metadata: "500 lines", "1 match", "1.2s". */
  meta?: string;
  /** Duration in ms (optional). */
  durationMs?: number;
  /**
   * Details revealed on expand — free markdown/text or child steps.
   * May be a thunk so expensive serialisation (pretty-printing multi-MB tool
   * args/results) is deferred until the row is actually expanded.
   */
  detail?: string | (() => string);
  children?: TimelineStep[];
}

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}

export interface UsageInfo {
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  /** Tokens read from the prompt cache (Anthropic prompt caching). Still
   *  occupy the context window even though they're billed separately. */
  cacheReadTokens?: number;
  /** Tokens written to the prompt cache this turn. */
  cacheWriteTokens?: number;
  /** Turn cost — semantics depend on `provider`: for copilot it's a billing
   *  multiplier (premium-request weight), for claude-agent it's USD. */
  cost?: number;
  /** Harness provider that produced this usage ('copilot' | 'claude-agent'). */
  provider?: string;
}

export type TurnStatus = 'streaming' | 'complete' | 'failed';

export interface TurnData {
  id: string;
  userPrompt: string;
  /** Optional auto-derived title, e.g. "Pipeline Analysis and Stage Handoff". */
  title?: string;
  status: TurnStatus;
  /** Steps rendered in temporal order. */
  steps: TimelineStep[];
  /** Progress numerator (steps done). */
  stepsDone?: number;
  stepsTotal?: number;
  /** Optional todo list emitted by the agent. */
  todos?: TodoItem[];
  /** The assistant's final markdown answer. Streams while status='streaming'. */
  answer: string;
  usage?: UsageInfo;
  /** Timestamp (ms). */
  startedAt: number;
}
