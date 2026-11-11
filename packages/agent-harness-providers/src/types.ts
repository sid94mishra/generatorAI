// ────────────────────────────────────────────────────────────────
// Agent Harness Provider types
// ────────────────────────────────────────────────────────────────

import type { ILogger, HarnessProviderId, ProviderMark } from '@generatorai/shared';
import type { AgentHostSupervisor } from './AgentHostSupervisor.js';

/**
 * Discriminator for provider selection. Extend this union when adding
 * a new provider — TypeScript exhaustiveness checks in the factory
 * will force you to handle the new case.
 *
 * W37: 'codex'    — Codex app-server (JSON-RPC over stdio).
 * W38: 'opencode' — OpenCode serve (HTTP + SSE).
 * W39: 'acp'      — ACP breadth client (long-tail agents, @agentclientprotocol/sdk).
 *
 * P2-00: 'faux' — registry-only synthetic type for `HarnessRegistry`'s
 * `GENERATORAI_TEST_FAUX_HARNESS` status entry. Deliberately NOT part of
 * `HarnessProviderId` (`@generatorai/shared`) — that union is persisted in
 * chat/workflow/agent configs in production and must stay real-provider-only.
 * `createHarnessProvider` never constructs a 'faux' adapter (see
 * `HarnessFactory.ts`); the actual FauxProvider instance conversations run
 * on is wired directly in `apps/server/src/composition-root.ts`, entirely
 * outside `HarnessRegistry`.
 */
export type HarnessType = HarnessProviderId | 'faux';

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

/**
 * How the host answers a server-initiated approval request.
 *
 * `codex app-server` BLOCKS the turn until an approval request is answered, so
 * a host that supplies no handler still gets a definite answer — `decline` —
 * rather than a turn that hangs until the RPC deadline.
 */
export type CodexApprovalRequest = { method: string; params: unknown };
export type CodexApprovalDecision = 'accept' | 'decline';

export interface CodexProviderOptions {
  /**
   * Path to the `codex` binary (default: resolved from PATH).
   * The provider spawns `codex app-server` and speaks JSON-RPC over stdio.
   */
  binaryPath?: string;
  /**
   * Argument vector for the spawned binary. Default `['app-server']`.
   *
   * Override to pass `codex app-server --config …`, or to point the provider
   * at a wrapper/stand-in that does not take `app-server` as its first
   * argument (this is what the test fixture does).
   */
  args?: string[];
  /**
   * Model for new threads when `createConversation` omits one.
   *
   * Deliberately has no default: the previous `'codex-mini'` was not a model
   * the binary offers, and an unknown name fails the thread start outright.
   * Omitting it lets the server use its own configured default.
   */
  defaultModel?: string;
  /** Working directory for the spawned process AND new threads (default: process.cwd()). */
  defaultCwd?: string;
  /**
   * Approval policy for new threads. Default `'never'`.
   *
   * `'never'` keeps the model inside its sandbox without prompting. Anything
   * else means the server will send approval REQUESTS mid-turn, which the
   * provider answers using `onApproval` (declining when none is supplied).
   */
  approvalPolicy?: 'untrusted' | 'on-request' | 'never';
  /**
   * Sandbox for new threads. Default `'workspace-write'` — the model may edit
   * inside its working directory but not the wider filesystem.
   */
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
  /**
   * Whether commands in a `workspace-write` / `read-only` sandbox may use the network. Default `true`: a test that
   * starts a server on localhost needs it, and Codex's sandbox has no loopback-only setting (an agent that may not
   * write files — a reviewer — could otherwise not run the HTTP tests it reviews). Network access never widens what
   * may be written; the bound agent's tool groups still gate network requests the provider asks about.
   */
  networkAccess?: boolean;
  /**
   * Decides server-initiated approvals (command execution, file changes, MCP
   * elicitations). Omit to decline everything, which is the fail-closed
   * default and the correct behaviour for an unattended host.
   */
  onApproval?: (request: CodexApprovalRequest) => Promise<CodexApprovalDecision> | CodexApprovalDecision;
  /** Client name sent in the `initialize` handshake. Default `'generatorai'`. */
  clientName?: string;
  /** Client version sent in the `initialize` handshake. */
  clientVersion?: string;
  /**
   * Base delay (ms) for exponential backoff when the server reports
   * backpressure (`rateLimitExceeded`, `usageLimitExceeded`, `serverOverloaded`).
   * The actual delay is `baseBackoffMs * 2^attempt` plus jitter. Default 1000.
   */
  baseBackoffMs?: number;
  /** Maximum retry attempts under backpressure before the turn fails. Default 4. */
  maxBackoffRetries?: number;
  /**
   * Deadline for a single JSON-RPC request/response round trip. Ms.
   *
   * Without this every caller of a dead or wedged `codex app-server` waits
   * forever — including `ping()`, whose whole contract is to answer `false`
   * for exactly that condition. Default 30_000. Turn STREAMING is not bounded
   * by this: only the request that starts the turn is.
   */
  rpcTimeoutMs?: number;
  /**
   * How long `shutdown()` waits for the child to exit after `SIGTERM` before
   * escalating to `SIGKILL`. Ms. Default 5_000.
   */
  shutdownGraceMs?: number;
  /**
   * Bytes of the child's stderr retained for attachment to spawn/exit errors.
   * W12 requires the last N KB be captured; a Codex binary that dies on a bad
   * config prints the reason there and nowhere else. Default 8_192.
   */
  stderrCaptureBytes?: number;
  /** Injected environment variables for the spawned process. */
  env?: Record<string, string | undefined>;
  logger?: ILogger;
}

// ── W38 — OpenCode provider options ──────────────────────────────────────────

/**
 * OpenCode 2 (`@opencode/cli` ≥ 2.0.0) over its HTTP API. Either the provider
 * starts a private server itself (`autoStart` + `binaryPath`, the default
 * wiring) or it talks to a running one (`baseUrl` + `password`).
 */
export interface OpenCodeProviderOptions {
  /** A running OpenCode 2 server to use instead of starting one. Needs `password`. */
  baseUrl?: string;
  /** The external server's password (OpenCode 2 always authenticates; HTTP Basic, user `opencode`). */
  password?: string;
  /**
   * Start a private `opencode serve --stdio --port 0` (lease-owned: it exits when this process does).
   * Needs `binaryPath`; see `resolveOpenCodeCommand`.
   */
  autoStart?: boolean;
  /** The executable to spawn (a native OpenCode binary, as `resolveOpenCodeCommand` returns). */
  binaryPath?: string;
  /** Arguments before `serve …` (a launcher script, when the resolved command is an interpreter). */
  binaryArgs?: string[];
  /** Default model, `providerID/modelID` — the form `getModels()` returns. */
  defaultModel?: string;
  /** The app's auto-compaction setting at start-up; a conversation's own setting replaces it. */
  autoCompact?: { enabled: boolean; thresholdPct?: number };
  /**
   * The config file GeneratorAI owns for the server it starts (`OPENCODE_CONFIG`): compaction and skill
   * directories. Default: a file of this provider instance's own under the OS temp directory.
   */
  configFile?: string;
  /** Idle deadline on the event stream (the server sends a heartbeat every 15 s). Default 60_000; 0 disables. */
  sseTimeoutMs?: number;
  /** Deadline for one HTTP call. Default 30_000. */
  requestTimeoutMs?: number;
  /** Wall-clock ceiling on one turn. Default 0 (none). */
  turnTimeoutMs?: number;
  /** How long a started server gets to announce its address. Default 30_000. */
  startupTimeoutMs?: number;
  /**
   * Environment for the started server and every session's shell commands, on top of the `childEnv.ts`
   * allowlist. OpenCode runs model-authored commands, so it never inherits the full parent environment.
   */
  env?: Record<string, string | undefined>;
  /** The server's working directory, and the project directory of a conversation that names none. */
  defaultCwd?: string;
  logger?: ILogger;
}

// ── W39 — ACP agents (docs/acp) ──────────────────────────────────────────────
//
// Real ACP (the Agent Client Protocol, `@agentclientprotocol/sdk`) is JSON-RPC
// 2.0 over the stdio of a spawned agent process. `AcpProvider` (the `acp`
// provider) multiplexes: one `AcpAgentConnection` (one agent process) per
// enabled agent, a conversation bound to the agent its model names
// (`<agentId>/<value>`, ACP-1/ACP-2).

/** One enabled agent: how to launch it and how to present it. Built by the server from its install. */
export interface AcpAgentLaunch {
  /** Registry id (`gemini`, `goose`, …) or a custom agent's `custom-…` id. No `/`. */
  id: string;
  /** Display name (the registry `name`). */
  label: string;
  /** Executable: an absolute path inside the agent's install directory, `node`, or a custom command. */
  command: string;
  args: string[];
  /** Distribution env + the user's per-agent variables. */
  env?: Record<string, string>;
  /** Directory the agent process starts in (its install directory). */
  cwd?: string;
  /** Installed version, for the status. */
  version?: string;
  /** Sanitised mark (shared `ProviderMark`), passed through to the sub-provider status. */
  mark?: ProviderMark;
  /** Tier-B host gate (L16). Default true. */
  tierB?: boolean;
}

/** Options of one agent connection (`AcpAgentConnection`). */
export interface AcpAgentConnectionOptions {
  /** The ACP agent binary to spawn (resolved against PATH like any spawned command). */
  command: string;
  /** Arguments passed to the spawned binary. */
  args?: string[];
  /**
   * Fallback directory for sessions whose conversation names none (`session/new.cwd`), and the spawn
   * directory when `cwd` is not given. Default: `process.cwd()`.
   */
  defaultCwd?: string;
  /** Directory the agent process starts in. Default `defaultCwd`. */
  cwd?: string;
  /** Environment for the spawned process, on top of the harness allowlist (`childEnv.ts`). */
  env?: Record<string, string | undefined>;
  /** The agent id inside a multiplexing provider. */
  agentId?: string;
  /** Display name (for the "agent's default model" entry and messages). */
  label?: string;
  /**
   * Whether this agent runs at Tier-B (untrusted / constrained): the host gate denies every tool kind but
   * read/search/think regardless of the agent's own permission model. Default: true (fail-closed).
   */
  tierB?: boolean;
  /** Deadline for `initialize`, `session/*` setup requests and `session/close`, in ms. Default 30_000; 0 disables. */
  requestTimeoutMs?: number;
  /** Deadline for a domain `onPermissionRequest` decision, in ms. Default 300_000; 0 disables. On expiry the gate DENIES. */
  permissionTimeoutMs?: number;
  /** Deadline for `authenticate` (a browser sign-in may take a while), in ms. Default 600_000. */
  authTimeoutMs?: number;
  /** Sign-in state, catalog or process state changed (the provider re-reports its status). */
  onStateChange?: () => void;
  logger?: ILogger;
}

/** Options of the `acp` provider. */
export interface AcpProviderOptions {
  /** The enabled agents at construction; `AcpProvider.setAgents` replaces them live. */
  agents?: AcpAgentLaunch[];
  /** Session directory fallback (see `AcpAgentConnectionOptions.defaultCwd`). */
  defaultCwd?: string;
  requestTimeoutMs?: number;
  permissionTimeoutMs?: number;
  authTimeoutMs?: number;
  /** An agent's state changed (signed in, models listed, process died): re-probe the provider. */
  onChange?: () => void;
  logger?: ILogger;
}
