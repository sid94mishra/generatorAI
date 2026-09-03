// ────────────────────────────────────────────────────────────────
// IAgentHarness — Domain-level abstraction over AI agent harness SDKs
//
// This is the canonical harness-agnostic interface. All services in
// packages/core consume this interface without knowledge of the
// underlying provider (Copilot SDK, Claude Agent SDK, etc.).
//
// Providers implement this interface in packages/agent-harness-providers.
// No SDK types leak here. Pure interface.
// ────────────────────────────────────────────────────────────────

import type { AgentEvent } from '@generatorai/shared';
import type { Permission } from '../../permissions/Permission.js';
import type { ProviderCapabilities, ProviderInstanceId } from './IProviderInstance.js';

export type HarnessClientState = 'starting' | 'running' | 'stopped' | 'error';

/** Discriminator for runtime harness provider selection. */
export type HarnessType = 'copilot' | 'claude-agent';

/**
 * Common options every harness adapter accepts.
 * Provider-specific options live in each adapter package.
 */
export interface HarnessAdapterCommonOptions {
  logger?: {
    debug?: (msg: string, meta?: Record<string, unknown>) => void;
    info?: (msg: string, meta?: Record<string, unknown>) => void;
    warn?: (msg: string, meta?: Record<string, unknown>) => void;
    error?: (msg: string, meta?: Record<string, unknown>) => void;
  };
}

export interface HarnessClientEvent {
  type: 'client.started' | 'client.stopped' | 'client.error' | 'client.restarting';
  data?: { message?: string };
}

export interface HarnessModel {
  id: string;
  name: string;
  provider?: string;
  /** Provider-supplied blurb describing the model's strengths. */
  description?: string;
  /** Capability grouping for the model picker: 'lightweight' | 'versatile' | 'powerful'. */
  category?: string;
  /**
   * Maximum PROMPT tokens for the default tier — the number the context gauge
   * divides by, and the same quantity providers report at runtime as
   * `usage_info.tokenLimit` / `SessionContextInfo.promptTokenLimit`.
   *
   * This is deliberately NOT the model's advertised "context window": that
   * figure (`totalContextWindow`) also covers the completion, so using it as
   * the gauge denominator understates how full the window really is and
   * disagrees with what the provider reports mid-turn.
   */
  promptTokenLimit?: number;
  /** Advertised total window = promptTokenLimit + maxOutputTokens. Display only. */
  totalContextWindow?: number;
  /** Long-context tier limits, when the model offers one. */
  longContext?: {
    promptTokenLimit?: number;
    totalContextWindow?: number;
  };
  /**
   * @deprecated Use `totalContextWindow` (display) or `promptTokenLimit`
   * (gauge denominator). Retained so older clients keep rendering.
   */
  contextWindow?: number;
  /** @deprecated Use `promptTokenLimit`. */
  standardContextWindow?: number;
  /** Maximum number of output/completion tokens. */
  maxOutputTokens?: number;
  /** Whether the model accepts image/vision input. */
  supportsVision?: boolean;
  /** Whether the model supports reasoning-effort configuration. */
  supportsReasoning?: boolean;
  /** Supported reasoning-effort levels (only present when supportsReasoning is true). */
  reasoningEfforts?: string[];
  /** Default reasoning-effort level (only present when supportsReasoning is true). */
  defaultReasoningEffort?: string;
  /** Relative token-cost tier: 'low' | 'medium' | 'high' | 'very_high'. */
  priceCategory?: string;
  /** Billing cost multiplier relative to the base rate. */
  billingMultiplier?: number;
  /** AI-credit token pricing (per billing batch). */
  pricing?: {
    input?: number;
    output?: number;
    cached?: number;
    batchSize?: number;
  };
  /** Whether the model exposes an extended (long) context tier. */
  supportsLongContext?: boolean;
}

export interface ConversationResponse {
  content: string;
  toolCalls?: { tool: string; args: unknown; result: unknown }[];
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp?: Date;
}

export interface SystemMessageConfig {
  mode: 'append' | 'replace';
  content: string;
}

/**
 * A named agent the harness can address. Superset of what both SDKs accept;
 * each provider maps the subset it supports and reports the rest as a
 * {@link ConversationWarning}.
 */
export interface CustomAgentConfig {
  name: string;
  displayName?: string;
  description: string;
  instructions: string;
  /** Allow-list of tool names. Omit for "inherit everything". */
  tools?: string[];
  /** Deny-list. Claude native; Copilot folds it into the session exclusions. */
  disallowedTools?: string[];
  /** Per-agent model override. Falls back to the parent session model. */
  model?: string;
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
  /** Skill names to eagerly inject into this agent's context. */
  skills?: string[];
  /** Per-agent MCP servers, keyed by server name. */
  mcpServers?: Record<string, McpServerConfig>;
  permissionMode?: HarnessPermissionMode;
  maxTurns?: number;
  /** Run as a non-blocking background task when invoked (Claude native). */
  background?: boolean;
  /** Whether the model may pick this agent itself. Copilot native; default true. */
  infer?: boolean;
}

/**
 * Machine-readable notice raised while translating domain params to a
 * provider's native shape. Codes, never user-facing English — the
 * presentation layer maps them to copy.
 */
export interface ConversationWarning {
  code:
    | 'FIELD_UNSUPPORTED_BY_PROVIDER'
    | 'FIELD_COERCED'
    | 'AGENT_NOT_REGISTERED';
  params: Record<string, string | number>;
}

/** What a provider reports back about a created/resumed conversation. */
export interface ConversationResult {
  conversationId: string;
  warnings: ConversationWarning[];
}

/** A named agent the provider actually registered. */
export interface HarnessAgentInfo {
  name: string;
  description?: string;
  model?: string;
  source?: string;
}

export interface BYOKProviderConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  model?: string;
}

export type PermissionRequestHandler = (
  request: PermissionRequest,
) => Promise<PermissionResponse>;

export interface PermissionRequest {
  type: 'file_write' | 'file_read' | 'shell_exec' | 'network' | 'other';
  description: string;
  details?: Record<string, unknown>;
}

export interface PermissionResponse {
  granted: boolean;
  reason?: string;
}

// ────────────────────────────────────────────────────────────────
// Plan mode (PLN-01)
//
// Both supported harnesses implement plan mode natively:
//   Copilot  — `MessageOptions.agentMode` + `SessionConfig.onExitPlanModeRequest`
//              + `SessionConfig.onUserInputRequest`
//   Claude   — `permissionMode: 'plan'` + the `ExitPlanMode` / `AskUserQuestion`
//              tools routed through `canUseTool`
// The two handlers below are deliberately distinct from `onPermissionRequest`
// because Copilot exposes them as first-class callbacks; the Claude adapter
// demultiplexes them out of `canUseTool`.
// ────────────────────────────────────────────────────────────────

/** Vendor-neutral permission modes. Superset supported by both adapters. */
export type HarnessPermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'plan'
  | 'dontAsk';

/** Per-turn options. Additive — omitting the bag preserves legacy behaviour. */
export interface SendPromptOptions {
  /**
   * Agent operating mode for THIS turn.
   * Copilot maps it to `MessageOptions.agentMode`; Claude maps `plan` to
   * `permissionMode: 'plan'` on the turn's query.
   */
  agentMode?: AgentMode;
  /**
   * Explicit permission-mode override for this turn. Takes precedence over the
   * mode derived from `agentMode` and over the stored conversation default.
   */
  permissionMode?: HarnessPermissionMode;
}

/** What the adapter hands the host when the agent finishes planning. */
export interface PlanReviewRequest {
  /** Short human summary of the plan. */
  summary: string;
  /** Full plan markdown. Never empty — adapters fail loudly rather than send ''. */
  planContent: string;
  /** Normalised actions the user may pick. */
  actions: PlanAction[];
  recommendedAction?: PlanAction;
  /** Provider-side plan file path, when the provider materialised one. */
  filePath?: string;
  /** Provider request id (Copilot). Used only for correlation/telemetry. */
  requestId?: string;
}

export interface PlanReviewDecision {
  approved: boolean;
  action?: PlanAction;
  /** Free-form “request changes” text handed back to the model. */
  feedback?: string;
  /** User-edited plan content, when the user edited before approving. */
  editedContent?: string;
}

/**
 * Blocking gate. Resolves only once a human decides (or the host cancels /
 * expires the interaction). Adapters keep their idle watchdog paused for the
 * whole duration.
 */
export type PlanReviewRequestHandler = (
  request: PlanReviewRequest,
) => Promise<PlanReviewDecision>;

export interface QuestionRequest {
  questions: AgentQuestion[];
}

/** Blocking gate for agent-authored clarifying questions. */
export type QuestionRequestHandler = (
  request: QuestionRequest,
) => Promise<AgentQuestionResponse>;

/**
 * Harness-agnostic custom tool definition. Adapters compile these to their
 * vendor's native tool schema at session-create time. See
 * `packages/agent-harness-providers/src/providers/copilot/tool-factory.ts`
 * for the Copilot mapping.
 *
 * TOL-01/02 additions (`skipPermission`, `requiredPermissions`, `owner`)
 * are purely metadata — adapters that don't know about them (or vendors
 * that don't expose an equivalent) simply ignore the extras and compile
 * the core `{name, description, parametersSchema, handler}` as before.
 */
/**
 * A binary payload a tool wants the MODEL to see, not just the user.
 *
 * Returned under `TOOL_BINARY_KEY` on a tool result. Kept vendor-neutral here
 * (INV-1) and mapped by each provider: Copilot has `binaryResultsForLlm`, and
 * adapters without an equivalent strip it rather than dumping base64 into the
 * text channel.
 */
export interface ToolBinaryAttachment {
  /** Base64, no `data:` prefix. */
  data: string;
  mimeType: string;
  description?: string;
}

/** Property under which a tool result carries `ToolBinaryAttachment[]`. */
export const TOOL_BINARY_KEY = '__binary';

/** Splits a tool result into its text payload and any binary attachments. */
export function takeToolBinaries(result: unknown): { text: unknown; binaries: ToolBinaryAttachment[] } {
  if (result === null || typeof result !== 'object' || Array.isArray(result)) {
    return { text: result, binaries: [] };
  }
  const record = result as Record<string, unknown>;
  const raw = record[TOOL_BINARY_KEY];
  if (!Array.isArray(raw)) return { text: result, binaries: [] };
  const rest = { ...record };
  delete rest[TOOL_BINARY_KEY];
  return { text: rest, binaries: raw as ToolBinaryAttachment[] };
}

export interface ToolDefinition {
  name: string;
  description: string;
  parametersSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
  /**
   * TOL-02 — if true, the harness skips its permission prompt for this
   * tool (use for inherently safe tools). Copilot SDK honours this
   * natively via `Tool.skipPermission`; adapters without native support
   * should still skip the domain-side gate (`evaluateToolPermissions`).
   */
  skipPermission?: boolean;
  /**
   * TOL-02 — declarative list of permissions the tool may exercise.
   * Evaluated by the domain `PermissionPolicy` before execution; also
   * surfaced in docs / MCP metadata. Empty/omitted means "no declared
   * permissions" — the policy decides via its mode (see PermissionPolicy).
   */
  requiredPermissions?: Permission[];
  /**
   * TOL-01 — free-form ownership tag for telemetry / logs (e.g. the
   * package or workflow that registered the tool). Not passed to the
   * harness.
   */
  owner?: string;
}

// McpServerConfig is imported from @generatorai/shared
import type { McpServerConfig } from '@generatorai/shared';
import type {
  AgentMode,
  AgentQuestion,
  AgentQuestionResponse,
  PlanAction,
} from '@generatorai/shared';
export type { McpServerConfig };

import type { HookBridge } from './IHookBridge.js';

export interface AttachmentRef {
  type: 'file';
  path: string;
  displayName?: string;
}

export interface CreateConversationParams {
  conversationId: string;
  model?: string;
  /**
   * Which agent provider should run this conversation ('copilot' |
   * 'claude-agent'). Omit to let the router pick the provider that owns
   * `model`, falling back to the primary provider.
   *
   * Providers are addressed per conversation, so one chat can run on Claude
   * while another runs on Copilot in the same process.
   */
  harnessType?: string;

  /**
   * W34 / L17 — the persisted ProviderInstanceId to use for this
   * conversation. When present it takes precedence over `harnessType` and
   * model-catalog resolution. Restored from DB on boot so Claude-owned
   * conversations never re-route to Copilot after a restart (P1-42 fix).
   */
  providerInstanceId?: ProviderInstanceId;

  /**
   * W12 — the provider's OWN session id to resume this conversation from,
   * rather than starting a cold one.
   *
   * `conversationId` is OUR id; every provider also keeps an id of its own
   * (Claude's `sdkSessionId`, Codex's thread id) and that is the one that
   * carries the message history. An adapter instance normally remembers it
   * across a create, so a rebind keeps the context — but a *different* instance
   * has never heard of the conversation, and without this field it silently
   * starts the model over with no memory of the chat. That is exactly what a
   * runtime recycle does: it hands the same params to a brand-new adapter.
   *
   * Read from the outgoing runtime with `getProviderSessionId()` and passed
   * here. Only honoured when the receiving adapter has no state of its own for
   * the conversation; a live adapter's own session always wins.
   */
  resumeProviderSessionId?: string;

  // ── System Message ──
  systemMessage?: SystemMessageConfig;
  /** @deprecated use systemMessage instead */
  systemPromptAppend?: string;

  // ── Tools ──
  tools?: ToolDefinition[];
  availableTools?: string[];
  excludedTools?: string[];

  // ── Skills & Agents ──
  /**
   * Agents addressable by name inside this conversation. On Copilot these
   * become `SessionConfig.customAgents`; on Claude, `Options.agents`.
   */
  customAgents?: CustomAgentConfig[];
  /**
   * Name of the agent to activate as the conversation's MAIN agent.
   * Both SDKs replace their base system prompt when this is set, so callers
   * that rely on injected capability instructions should compose the agent
   * instructions into `systemMessage` instead and leave this unset.
   */
  defaultAgent?: string;
  /** How the caller composed the agent instructions. Informational for the adapter. */
  agentProjection?: 'append' | 'replace' | 'native';
  skillDirectories?: string[];
  disabledSkills?: string[];
  /**
   * Explicit skill allow-list by name. Claude's `Options.skills` is the only
   * way to turn skills on there; Copilot derives `disabledSkills` from it.
   */
  skills?: string[];
  /**
   * Tool names hidden from the DEFAULT agent while staying available to
   * sub-agents that name them. Copilot `defaultAgent.excludedTools`.
   */
  excludedBuiltinTools?: string[];

  // ── MCP Servers ──
  mcpServers?: Record<string, McpServerConfig>;

  // ── BYOK Provider ──
  provider?: BYOKProviderConfig;

  // ── Behavior ──
  streaming?: boolean;
  workingDirectory?: string;
  configDir?: string;
  /** Reasoning effort for models that support it (low/medium/high/xhigh) */
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
  /** Context window tier — 'long_context' pins the long-context tier for models that support it. */
  contextTier?: 'default' | 'long_context';
  /** Maximum number of agent turns before stopping */
  maxTurns?: number;

  // ── Permissions ──
  onPermissionRequest?: PermissionRequestHandler;

  // ── Plan mode (PLN-01) ──
  /**
   * Session-level permission mode. Per-turn `SendPromptOptions.permissionMode`
   * (or the mode derived from `agentMode`) overrides this for a single turn.
   */
  permissionMode?: HarnessPermissionMode;
  /**
   * Custom workflow instructions used while planning. Claude passes this to
   * `planModeInstructions`; other adapters may fold it into the system message.
   */
  planModeInstructions?: string;
  /** Blocking gate invoked when the agent finishes planning. */
  onPlanReviewRequest?: PlanReviewRequestHandler;
  /** Blocking gate invoked when the agent asks the user clarifying questions. */
  onQuestionRequest?: QuestionRequestHandler;

  // ── Hook Bridge (HKS-01) ──
  /**
   * Harness-agnostic hook bridge. The adapter translates each handler to
   * its vendor's native hook surface (Copilot → `SessionConfig.hooks`,
   * Claude → Agent SDK hooks, OpenAI → manual pre/post gates). Omit the
   * whole field if you don't need synchronous intercepts — the adapter
   * will still emit passive `AgentEvent`s through the EventBus, which
   * `HookInterceptor` routes through `HookExecutor.executePhase` for
   * post-hoc observability. This field is for the synchronous case where
   * you need to block, modify args, or inject context **before** the
   * harness proceeds.
   */
  hooks?: HookBridge;
}

// ────────────────────────────────────────────────────────────────
// Capability ports (P1#6).
//
// IAgentHarness is composed from focused capability interfaces below. The
// composition is purely organizational — `IAgentHarness` still has exactly the
// same 18 methods, so existing implementations and consumers are unchanged. The
// split documents what a harness must provide and lets a bring-your-own-harness
// author reason about (and unit-test) one capability at a time.
// ────────────────────────────────────────────────────────────────

/** Process/connection lifecycle of the underlying harness client. */
export interface IHarnessClientLifecycle {
  initialize(): Promise<void>;
  stop(): Promise<void>;
  forceStop(): Promise<void>;
  getClientState(): HarnessClientState;
  ping(): Promise<boolean>;
  shutdown(): Promise<void>;
  onClientEvent(handler: (event: HarnessClientEvent) => void): () => void;
  /**
   * W42 / N-2 — declared capabilities for this adapter.
   *
   * L9: Every capability is declared, never discovered by throwing. Callers
   * branch on the returned struct rather than attempting a feature and
   * catching the error. All fields default closed (false/undefined).
   */
  capabilities(): ProviderCapabilities;
}

/** Model discovery. */
export interface IHarnessModelDiscovery {
  getModels(): Promise<HarnessModel[]>;
}

/** Create / resume / list / delete conversations. */
export interface IHarnessConversationLifecycle {
  createConversation(params: CreateConversationParams): Promise<string>;
  /**
   * Rehydrate a previously-created conversation by id.
   *
   * `params` is optional but SHOULD be supplied when resuming a conversation
   * that may have fallen out of memory (e.g. after a server restart). The
   * runtime tool *handlers* (browser / widget / custom tools) cannot be
   * serialized into the SDK's persisted session store, so a bare resume
   * restores the message history WITHOUT any tools — the SDK then tells the
   * model those tools "are no longer available" and it refuses tool-using
   * tasks for the rest of the chat. Passing `params` lets the adapter
   * re-register the tool handlers on the resumed session while keeping the
   * persisted history intact.
   */
  resumeConversation(conversationId: string, params?: CreateConversationParams): Promise<void>;
  /**
   * Whether the conversation is currently live in the adapter's memory (its
   * tool handlers are registered). `false` after a server restart or eviction,
   * signalling the caller to resume WITH `params` so tools are re-registered.
   */
  hasLiveConversation(conversationId: string): boolean;
  /**
   * W12 — the provider-side session id backing `conversationId`, when the
   * provider has one and it is known.
   *
   * The counterpart of `CreateConversationParams.resumeProviderSessionId`: read
   * it from the runtime that is going away, pass it to the one taking over, and
   * the conversation keeps its history. Optional because not every provider has
   * such an id; returning `undefined` means "cannot be resumed elsewhere", and
   * callers must treat the move as a cold start rather than assume continuity.
   */
  getProviderSessionId?(conversationId: string): string | undefined;
  listConversations(): Promise<string[]>;
  getLastConversationId(): Promise<string | null>;
  deleteConversation(conversationId: string): Promise<void>;
  destroyConversation(conversationId: string): Promise<void>;
  /**
   * Warnings raised the last time this conversation was created or resumed.
   * Empty when the provider honoured every field. Read by services to surface
   * silently-dropped configuration instead of losing it.
   */
  getConversationWarnings(conversationId: string): ConversationWarning[];
  /**
   * Switch the conversation's active agent in place, when the provider
   * supports it. Providers that cannot do this record a warning and no-op.
   */
  selectAgent(conversationId: string, agentName: string): Promise<void>;
  /** Agents the provider actually registered for this conversation. */
  listAgents(conversationId: string): Promise<HarnessAgentInfo[]>;
}

/** Send prompts and read/abort the in-flight turn. */
export interface IHarnessMessaging {
  sendPrompt(
    conversationId: string,
    prompt: string,
    attachments?: AttachmentRef[],
    options?: SendPromptOptions,
  ): Promise<void>;
  sendPromptAndWait(
    conversationId: string,
    prompt: string,
    attachments?: AttachmentRef[],
    signal?: AbortSignal,
    options?: SendPromptOptions,
  ): Promise<ConversationResponse>;
  getMessages(conversationId: string): Promise<ConversationMessage[]>;
  abortConversation(conversationId: string): Promise<void>;
}

/** Per-conversation streaming event subscription. */
export interface IHarnessEvents {
  onConversationEvent(
    conversationId: string,
    handler: (event: AgentEvent) => void,
  ): () => void;
}

/**
 * Harness-agnostic domain port. All core services consume this interface.
 * Concrete implementations live in `packages/agent-harness-providers`.
 *
 * Composed from the capability ports above — identical surface to before, just
 * organized so a custom harness (bring-your-own) can be reasoned about per
 * capability. Implement this (or extend a built-in provider) and pass the
 * instance as `config.provider` to `createGeneratorAI`.
 */
export interface IAgentHarness
  extends IHarnessClientLifecycle,
    IHarnessModelDiscovery,
    IHarnessConversationLifecycle,
    IHarnessMessaging,
    IHarnessEvents {}

