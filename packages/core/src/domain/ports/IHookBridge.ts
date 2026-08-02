// ────────────────────────────────────────────────────────────────
// IHookBridge — HKS-01 harness-agnostic hook-bridge port.
//
// The SDK's native "session hooks" (onPreToolUse, onPostToolUse, etc.)
// give the harness a synchronous intercept point: the returned value tells
// the harness whether to run the tool, with what args, and what context to
// add. That is strictly more powerful than observing AgentEvents after the
// fact — it lets a hook actually block a tool call, mutate its arguments,
// or add system context before execution.
//
// This file defines the **domain** shape of those intercepts. Every harness
// adapter (Copilot today, Claude/OpenAI tomorrow) accepts a `HookBridge`
// object in `CreateConversationParams.hooks` and translates it to its
// vendor's native surface:
//
//   Copilot  →  `SessionConfig.hooks` (SDK `SessionHooks`)
//   Claude   →  Claude Agent SDK's equivalent hook config
//   OpenAI   →  adapter-owned pre/post gates around tool execution
//
// The domain field names mirror the Copilot SDK shape because we already
// use that vendor today; they are not copied verbatim — `permissionDecision`
// becomes `decision`, `sessionId` is passed via `invocation`, etc. Other
// adapters translate the same shape to their own types.
//
// Design rules
// -------------
// - Every handler returns `void | Output` so a minimal bridge can `return;`
//   and mean "no override — continue as the harness would".
// - Outputs are strictly additive; fields are optional so adding a new
//   capability later (e.g. `toolCallTelemetry`) doesn't break existing
//   bridges.
// - No vendor-specific types leak in. `toolArgs` is `unknown` rather than
//   the SDK's `Record<string, unknown>` so adapters that wrap JSON-Schema
//   vs Zod vs their own type system don't have to lie about the shape.
// ────────────────────────────────────────────────────────────────

/** Invocation context threaded through every hook callback. */
export interface HookBridgeInvocation {
  /** Harness-provided session / conversation id. */
  sessionId: string;
}

/** Base fields every hook input carries. */
export interface HookInputBase {
  /** Epoch-ms timestamp at which the harness invoked the hook. */
  timestamp: number;
  /** Current working directory the harness is executing against. */
  cwd: string;
}

// ── pre_tool_use ──

export interface PreToolUseHookInput extends HookInputBase {
  toolName: string;
  toolArgs: unknown;
}

export interface PreToolUseHookOutput {
  /** `allow` proceeds, `deny` blocks, `ask` surfaces a permission prompt. */
  decision?: 'allow' | 'deny' | 'ask';
  /** Human-readable reason shown in logs / permission UI. */
  reason?: string;
  /** If present, replaces the model-supplied `toolArgs` before execution. */
  modifiedArgs?: unknown;
  /** System-visible text injected into the conversation before the tool runs. */
  additionalContext?: string;
  /** Suppress the harness's default user-facing output for this event. */
  suppressOutput?: boolean;
}

// ── post_tool_use ──

export interface PostToolUseHookInput extends HookInputBase {
  toolName: string;
  toolArgs: unknown;
  toolResult: unknown;
}

export interface PostToolUseHookOutput {
  /** Replace the tool's returned value before it lands back in the model's context. */
  modifiedResult?: unknown;
  additionalContext?: string;
  suppressOutput?: boolean;
}

// ── user_prompt_submit ──

export interface UserPromptSubmittedHookInput extends HookInputBase {
  prompt: string;
}

export interface UserPromptSubmittedHookOutput {
  modifiedPrompt?: string;
  additionalContext?: string;
  suppressOutput?: boolean;
}

// ── session_start ──

export interface SessionStartHookInput extends HookInputBase {
  /**
   * Why the session started. `startup`=fresh server boot with an auto-resume,
   * `resume`=explicit resumeConversation call, `new`=createConversation.
   */
  source: 'startup' | 'resume' | 'new';
  initialPrompt?: string;
}

export interface SessionStartHookOutput {
  additionalContext?: string;
  modifiedConfig?: Record<string, unknown>;
}

// ── session_end ──

export interface SessionEndHookInput extends HookInputBase {
  reason: 'complete' | 'error' | 'abort' | 'timeout' | 'user_exit';
  finalMessage?: string;
  error?: string;
}

export interface SessionEndHookOutput {
  suppressOutput?: boolean;
  cleanupActions?: string[];
  sessionSummary?: string;
}

// ── on_error ──

export interface ErrorOccurredHookInput extends HookInputBase {
  error: string;
  /** Where in the agent loop the error originated. */
  errorContext: 'model_call' | 'tool_execution' | 'system' | 'user_input';
  recoverable: boolean;
}

export interface ErrorOccurredHookOutput {
  suppressOutput?: boolean;
  /** Tell the harness how to proceed from the error. */
  errorHandling?: 'retry' | 'skip' | 'abort';
  retryCount?: number;
  userNotification?: string;
}

// ── Bridge handlers ──

export type PreToolUseBridgeHandler = (
  input: PreToolUseHookInput,
  invocation: HookBridgeInvocation,
) => Promise<PreToolUseHookOutput | void> | PreToolUseHookOutput | void;

export type PostToolUseBridgeHandler = (
  input: PostToolUseHookInput,
  invocation: HookBridgeInvocation,
) => Promise<PostToolUseHookOutput | void> | PostToolUseHookOutput | void;

export type UserPromptSubmittedBridgeHandler = (
  input: UserPromptSubmittedHookInput,
  invocation: HookBridgeInvocation,
) => Promise<UserPromptSubmittedHookOutput | void> | UserPromptSubmittedHookOutput | void;

export type SessionStartBridgeHandler = (
  input: SessionStartHookInput,
  invocation: HookBridgeInvocation,
) => Promise<SessionStartHookOutput | void> | SessionStartHookOutput | void;

export type SessionEndBridgeHandler = (
  input: SessionEndHookInput,
  invocation: HookBridgeInvocation,
) => Promise<SessionEndHookOutput | void> | SessionEndHookOutput | void;

export type ErrorOccurredBridgeHandler = (
  input: ErrorOccurredHookInput,
  invocation: HookBridgeInvocation,
) => Promise<ErrorOccurredHookOutput | void> | ErrorOccurredHookOutput | void;

/**
 * A domain bridge a harness adapter accepts in `CreateConversationParams.hooks`.
 * All handlers are optional — omit the ones you don't care about.
 */
export interface HookBridge {
  onPreToolUse?: PreToolUseBridgeHandler;
  onPostToolUse?: PostToolUseBridgeHandler;
  onUserPromptSubmitted?: UserPromptSubmittedBridgeHandler;
  onSessionStart?: SessionStartBridgeHandler;
  onSessionEnd?: SessionEndBridgeHandler;
  onErrorOccurred?: ErrorOccurredBridgeHandler;
}
