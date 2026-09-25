// ────────────────────────────────────────────────────────────────
// IProviderInstance — W34 provider port.
//
// L17: Provider identity is persisted and is the ONLY routing key.
// A ProviderInstanceId uniquely identifies one account/credential
// set of one driver. It is persisted to the DB (harness_instances
// table) and restored on boot, so conversation→provider ownership
// survives restarts (fixing P1-42).
//
// N-3 fix: N instances of the same driver are supported by the
// instance registry — two Copilot accounts or two Claude accounts
// are now representable.
//
// N-4 fix: Driver (e.g. 'copilot') and wire protocol (e.g.
// 'copilot-sdk' vs 'acp') are separate axes. A credential that
// serves multiple protocols has one instance with multiple valid
// protocols, not one instance per protocol.
// ────────────────────────────────────────────────────────────────

/** Branded type — never just a plain string. */
export type ProviderInstanceId = string & { readonly __brand: 'ProviderInstanceId' };

/** Cast a raw string to a ProviderInstanceId. */
export function makeProviderInstanceId(raw: string): ProviderInstanceId {
  return raw as ProviderInstanceId;
}

/**
 * What wire protocol this instance uses to talk to the provider.
 * A credential can serve multiple protocols; the instance declares which
 * one it is CURRENTLY using — the N-4 fix.
 */
export type ProviderWireProtocol =
  | 'claude-agent-sdk'
  | 'copilot-sdk'
  | 'codex-rpc'      // W37 — future
  | 'opencode-http'  // W38 — future
  | 'acp';           // W39 — future

export type ApprovalGatingLevel = 'per_call' | 'exec_and_patch' | 'none';
export type HostToolsLevel = 'full' | 'start_only' | 'none';
export type StructuredOutputLevel = 'native' | 'tool' | 'none';
export type SkillsLevel = 'plugin' | 'directories' | 'none';

/**
 * Declared capabilities for a provider instance.
 *
 * L9: Every capability is DECLARED, never discovered by throwing.
 * All fields default to false/undefined — membership is opt-in.
 *
 * W42 — capability declarations (N-2 fix).
 */
export interface ProviderCapabilities {
  /** Whether this provider supports vision (image tool results). */
  vision: boolean;
  /** Whether this provider supports extended reasoning / thinking. */
  reasoning: boolean;
  /** Supported reasoning effort levels. Empty array if reasoning=false. */
  reasoningEfforts: ReadonlyArray<'low' | 'medium' | 'high' | 'xhigh' | 'max'>;
  /**
   * Maximum parallel tool calls this provider can handle safely.
   * Absent means "use the process-wide MAX_PARALLEL_TOOLS default (8)."
   */
  maxParallelTools?: number;
  /** Whether this provider supports plan mode (structured planning before execution). */
  planMode: boolean;
  /** Whether this provider supports reading MCP server configuration. */
  mcpServers: boolean;
  /**
   * How the provider asks before acting (RV-6, PD-17):
   * - `per_call`: every tool call the provider does not auto-allow reaches
   *   the session's permission gate (Copilot, ACP, claude-agent);
   * - `exec_and_patch`: only command executions and patch applications ask
   *   (Codex); other tools run under the sandbox policy;
   * - `none`: the provider never asks (opencode).
   */
  approvalGating: ApprovalGatingLevel;
  /**
   * Whether host tools (the platform's own tool handlers) reach the model
   * (RV-9): `full` on every turn, `start_only` only when the conversation is
   * started (Codex `dynamicTools` on `thread/start`), `none` never.
   */
  hostTools: HostToolsLevel;
  /**
   * How the provider can return structured output: `native` (claude-agent
   * `outputFormat`, Codex `outputSchema`), `tool` (a host tool the model
   * calls), `none`.
   */
  structuredOutput: StructuredOutputLevel;
  /**
   * How skills reach the model (RV-7, RV-8): `plugin` (a local plugin root,
   * claude-agent), `directories` (skill directories, Copilot and Codex),
   * `none`.
   */
  skills: SkillsLevel;
  /** Whether the provider supports session persistence across restarts. */
  sessionPersistence: boolean;
  /** Whether the provider supports cost/budget tracking (maxBudgetUsd). */
  budgetTracking: boolean;
  /**
   * Whether the provider can execute computer-use (mouse/keyboard/screenshot)
   * tool calls. L9 — capabilities declared, not inferred from model name.
   */
  computerUse?: boolean;
  /** Maximum token context window in tokens. Absent if not known statically. */
  maxContextTokens?: number;
  /**
   * Whether this provider can bring a conversation to readiness BEFORE a
   * prompt arrives, via `prewarmConversation`.
   *
   * Every provider measured pays a per-conversation cold start — the process
   * or session backing a brand-new conversation is built on the first prompt,
   * while the user waits. On this machine that was 12.8 s for `claude-agent`
   * and 7.1 s for `copilot`, against warm turns of 2.2 s and 3.9 s. Declaring
   * the capability lets the harness-neutral layer move that cost off the
   * user's critical path without knowing anything about the provider.
   *
   * Defaults false like every other capability: a provider that cannot warm
   * simply does not claim it, and behaves exactly as it does today.
   */
  prewarm?: boolean;
  /**
   * Whether `forkConversation` is implemented natively — a new provider
   * session whose history is a copy of the source up to a chosen anchor
   * (Claude `forkSession`, Codex `thread/fork`). Without it the chat service
   * forks synthetically: a fresh session seeded with a transcript digest.
   */
  conversationFork?: boolean;
  /**
   * Whether `rewindConversation` is implemented natively — the provider's
   * own history is truncated back to a chosen anchor (Claude: fork-and-rebind,
   * Codex `thread/revert`). Without it the chat service rewinds synthetically.
   */
  conversationRewind?: boolean;
  /**
   * Whether `startLogin` / `logout` are implemented — the provider can sign
   * the user in from the app (Codex's ChatGPT browser flow) instead of
   * requiring a terminal command.
   */
  accountLogin?: boolean;
}

/**
 * One concrete provider instance — one account, one credential set, one
 * wire protocol. L17: The only routing key. Never infer provider from model
 * name.
 *
 * Persisted to `harness_instances` table via `HarnessInstanceRepository`.
 */
export interface IProviderInstance {
  /** Globally unique, persisted. The routing key (L17). */
  id: ProviderInstanceId;
  /** Which driver family handles this instance. */
  driverType: 'copilot' | 'claude-agent' | 'codex' | 'opencode' | 'acp';
  /** Which wire protocol is currently in use. */
  protocol: ProviderWireProtocol;
  /** Human-readable name shown in the UI. */
  displayName: string;
  /** Declared capabilities for this instance. L9 compliance. */
  capabilities: ProviderCapabilities;
  /** Whether this instance is currently enabled. */
  enabled: boolean;
}

/**
 * Registry port — manages N instances of any driver.
 * L17 + N-3 compliance.
 *
 * Implemented by ProviderInstanceRegistry in agent-harness-providers.
 */
export interface IProviderInstanceRegistry {
  /** Returns all known provider instances, including disabled ones. */
  listAll(): ReadonlyArray<IProviderInstance>;

  /** Returns only enabled instances. */
  listEnabled(): ReadonlyArray<IProviderInstance>;

  /**
   * Finds the instance that owns a conversation.
   * Returns undefined if the conversation has no assigned instance (new
   * conversation or ownership lost after restart without a store).
   */
  resolveForConversation(conversationId: string): IProviderInstance | undefined;

  /**
   * Assigns a provider instance to a conversation. Persisted.
   * L17: This is the ONLY routing write path.
   */
  assignConversation(conversationId: string, instanceId: ProviderInstanceId): Promise<void>;

  /**
   * Looks up an instance by its persisted id.
   * Returns undefined when the id is not known to this registry.
   */
  findById(id: ProviderInstanceId): IProviderInstance | undefined;

  /**
   * Returns the primary (default) instance to use for new conversations when
   * no explicit instance is requested.
   */
  primary(): IProviderInstance | undefined;
}
