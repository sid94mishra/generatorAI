// ────────────────────────────────────────────────────────────────
// Agent Harness Provider types
// ────────────────────────────────────────────────────────────────

import type { ILogger } from '@generatorai/shared';
import type { AgentHostSupervisor } from './AgentHostSupervisor.js';

/**
 * Discriminator for provider selection. Extend this union when adding
 * a new provider — TypeScript exhaustiveness checks in the factory
 * will force you to handle the new case.
 *
 * W37: 'codex'    — Codex app-server (JSON-RPC over stdio).
 * W38: 'opencode' — OpenCode serve (HTTP + SSE).
 * W39: 'acp'      — ACP breadth client (long-tail agents, @agentclientprotocol/sdk).
 */
export type HarnessType = 'copilot' | 'claude-agent' | 'codex' | 'opencode' | 'acp';

/**
 * Union of all provider-specific configuration options.
 * The factory reads `type` to select the correct provider and passes
 * the matching config section.
 */
export interface HarnessProviderConfig {
  type: HarnessType;
  copilot?: CopilotProviderOptions;
  claudeAgent?: ClaudeAgentProviderOptions;
  /** W37 — Codex app-server provider options. */
  codex?: CodexProviderOptions;
  /** W38 — OpenCode serve provider options. */
  opencode?: OpenCodeProviderOptions;
  /** W39 — ACP breadth client options. */
  acp?: AcpProviderOptions;
}

export interface CopilotProviderOptions {
  useStdio?: boolean;
  cliUrl?: string;
  defaultCwd?: string;
  autoRestart?: boolean;
  defaultModel?: string;
  /**
   * Idle-timeout guard for `sendPromptAndWait` — fires when no SDK event
   * arrives for this many milliseconds. NOT a wall-clock cap: an agent
   * that streams tokens or invokes tools continuously will never trip
   * this even on multi-hour runs. Set to 0 or omit to disable.
   */
  defaultTimeoutMs?: number;
  cliPath?: string;
  verbose?: boolean;
  githubToken?: string;
  githubHost?: string;
  /**
   * Isolated config/home directory for THIS harness instance.
   *
   * Injected as the CLI's home so two accounts of the same provider never
   * share a credential file, race on writes, or leak one account's session
   * into the other's conversations.
   */
  homeDir?: string;
  /**
   * W36 / P0-13 — supervisor for cold-start gating per workspace.
   * When provided, the WorkspacedCopilotPool holds one cold-start permit
   * during each new workspace provider's `initialize()` call, preventing
   * thundering-herd CLI starts when many workspaces are opened at once.
   */
  supervisor?: AgentHostSupervisor;
  /**
   * W36 — maximum number of workspace CLI processes to keep alive.
   * LRU-evicts the oldest workspace when this limit is reached.
   * Default: unlimited.
   */
  maxWorkspaces?: number;
}

export interface ClaudeAgentProviderOptions {
  defaultModel?: string;
  defaultCwd?: string;
  defaultTimeoutMs?: number;
  defaultEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  defaultPermissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk';
  defaultMaxTurns?: number;
  defaultMaxBudgetUsd?: number;
  includePartialMessages?: boolean;
  includeHookEvents?: boolean;
  verbose?: boolean;
  env?: Record<string, string | undefined>;
  settingSources?: Array<'user' | 'project' | 'local'>;
  enableFileCheckpointing?: boolean;
  /**
   * Isolated config/home directory for THIS harness instance, injected as
   * `CLAUDE_CONFIG_DIR`. Lets a work and a personal Claude account run side
   * by side without sharing credentials.
   */
  homeDir?: string;
  /**
   * W12 / P0-14 — optional supervisor bounding concurrent turns.
   * When provided, each `sendPromptAndWait` acquires one execution slot
   * before spawning a new `query()` process. Prevents the "24 orphaned
   * claude.exe" pattern where uncapped concurrent spawns exhaust memory.
   */
  supervisor?: AgentHostSupervisor;
}

export interface HarnessFactoryOptions {
  logger?: ILogger;
}

// ── W37 — Codex provider options ─────────────────────────────────────────────

export interface CodexProviderOptions {
  /**
   * Path to the `codex` binary (default: resolved from PATH).
   * The provider spawns `codex app-server` and speaks JSON-RPC over stdio.
   */
  binaryPath?: string;
  /** Default model to use when `createConversation` omits `model`. */
  defaultModel?: string;
  /** Working directory for the spawned process (default: process.cwd()). */
  defaultCwd?: string;
  /**
   * Base delay (ms) for exponential backoff on `-32001` rate-limit errors.
   * The actual delay is `baseBackoffMs * 2^attempt + jitter`. Default 1000.
   */
  baseBackoffMs?: number;
  /**
   * Maximum number of retry attempts on `-32001` before the turn fails.
   * Default 4.
   */
  maxBackoffRetries?: number;
  /** Injected environment variables for the spawned process. */
  env?: Record<string, string | undefined>;
  logger?: ILogger;
}

// ── W38 — OpenCode provider options ──────────────────────────────────────────

export interface OpenCodeProviderOptions {
  /**
   * Base URL of the running `opencode serve` instance.
   * Default: `http://localhost:4096` (opencode's default port).
   */
  baseUrl?: string;
  /**
   * Path to the `opencode` binary used to start the server if `baseUrl`
   * is not reachable and `autoStart` is true.
   */
  binaryPath?: string;
  /**
   * When true, the provider starts `opencode serve` itself if the baseUrl
   * is not reachable. Default false (connect to an already-running instance).
   */
  autoStart?: boolean;
  /** Default model (e.g. `'claude-opus-5'`). */
  defaultModel?: string;
  /** SSE event timeout in ms. Default 30_000. */
  sseTimeoutMs?: number;
  /** Authorization header value (e.g. `'Bearer <token>'`). */
  authToken?: string;
  logger?: ILogger;
}

// ── W39 — ACP breadth client options ─────────────────────────────────────────

export interface AcpProviderOptions {
  /**
   * Transport address for the ACP agent (e.g. `stdio://path/to/binary`,
   * `http://localhost:8080`, `ws://localhost:8080/ws`).
   * Required — there is no default address for a generic ACP agent.
   */
  address: string;
  /**
   * ACP protocol version to negotiate first.
   * Default: `'0.2'` (v2 draft — negotiates down to `'0.1'` on failure).
   */
  preferredVersion?: string;
  /**
   * Whether this agent runs at Tier-B (untrusted / constrained).
   * When true the host gate denies `computer-use` and unrestricted shell
   * capabilities regardless of what the agent's own permission model says.
   * Default: true (fail-closed).
   */
  tierB?: boolean;
  logger?: ILogger;
}
