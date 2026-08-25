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
  /** Whether this provider supports skill/prompt directories. */
  skillDirectories: boolean;
  /**
   * Whether per-tool permission gates fire on EVERY tool call (not just
   * fall-through). Required for security compliance (L16, N-5).
   *
   * true  = the security gate is wired to PreToolUse, so every tool is gated.
   * false = the gate fires only on fall-through (canUseTool) — NOT a security
   *         boundary. The caller must treat this provider as lower-trust.
   */
  fullToolGating: boolean;
  /** Whether the provider supports session persistence across restarts. */
  sessionPersistence: boolean;
  /** Whether the provider supports cost/budget tracking (maxBudgetUsd). */
  budgetTracking: boolean;
  /** Maximum token context window in tokens. Absent if not known statically. */
  maxContextTokens?: number;
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
