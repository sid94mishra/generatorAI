// ────────────────────────────────────────────────────────────────
// Types for ClaudeAgentProvider
// ────────────────────────────────────────────────────────────────

import type { PlanReviewRequestHandler, QuestionRequestHandler } from '@generatorai/core';
import type { AgentHostSupervisor } from '../../AgentHostSupervisor.js';

export interface ClaudeAgentProviderOptions {
  /**
   * W12 — optional AgentHostSupervisor that gates concurrent turns via the
   * execution semaphore. When provided, BOTH `sendPrompt` (chat) and
   * `sendPromptAndWait` (workflow stages) acquire one execution slot before a
   * turn starts and release it when the turn completes (including on abort or
   * error). Prevents unbounded concurrent process spawns (P0-14: "Claude
   * spawns one CLI per turn, uncapped"). A turn that has to wait for a slot
   * announces it with a `harness.session_info` / `infoType: 'queued'` event so
   * the user sees "Waiting for a free agent slot" instead of a silent hang.
   *
   * Omit in tests that don't need concurrency control. The default singleton
   * (`defaultAgentHostSupervisor`) is wired at the composition root.
   */
  supervisor?: AgentHostSupervisor;
  /**
   * Item 17 — keep one long-lived streaming-input `query()` per chat
   * conversation instead of spawning a CLI process per message.
   *
   * Default ON; `GENERATORAI_CLAUDE_PERSISTENT_SESSIONS=false` is the kill
   * switch back to one-shot string prompts. `sendPromptAndWait` (workflow
   * stages: single-message conversations in per-run directories) always uses
   * the one-shot path regardless of this flag.
   */
  persistentSessions?: boolean;
  /**
   * Item 16 — a conversation (its maps AND its live process) idle for longer
   * than this is evicted. Default 10 min (`GENERATORAI_CLAUDE_SESSION_IDLE_MINUTES`).
   * `0` disables the idle sweep.
   */
  sessionIdleMs?: number;
  /**
   * Item 16 — hard cap on conversations held live at once. When a NEW
   * conversation would exceed it the least-recently-used IDLE conversation is
   * evicted first. A conversation with a turn in flight is never evicted.
   * Default 8 (`GENERATORAI_CLAUDE_MAX_LIVE_SESSIONS`).
   */
  maxLiveConversations?: number;
  /** Item 16 — how often the idle sweep runs. Defaults to `min(idle/2, 60s)`. */
  sessionSweepIntervalMs?: number;
  /** Default model (e.g. 'claude-sonnet-4-6'). */
  defaultModel?: string;
  /**
   * Path to the Claude Code CLI executable.
   *
   * Omit to auto-detect the installed CLI (`CLAUDE_CLI_PATH` /
   * `CLAUDE_CODE_PATH` env vars, then `claude` on PATH), falling back to the
   * SDK's bundled copy. Prefer the installed CLI: the bundled one can be
   * several versions behind and has been observed advertising models that an
   * enterprise account is not entitled to use.
   */
  cliPath?: string;
  /** Default working directory. */
  defaultCwd?: string;
  /**
   * Idle-timeout guard for `sendPromptAndWait` (ms). Fires only when no
   * SDK message has arrived for this duration — NOT a wall-clock cap.
   * An agent that streams tokens or invokes tools continuously will not
   * trip this even on multi-hour runs.
   */
  defaultTimeoutMs?: number;
  /** Effort level for reasoning. */
  defaultEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Permission mode. Defaults to 'bypassPermissions' for workflow execution. */
  defaultPermissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk';
  /** Max turns per query. */
  defaultMaxTurns?: number;
  /** Max cost in USD per query. */
  defaultMaxBudgetUsd?: number;
  /** Whether to include streaming partial messages. */
  includePartialMessages?: boolean;
  /** Include hook lifecycle events. */
  includeHookEvents?: boolean;
  /** Enable verbose logging. */
  verbose?: boolean;
  /**
   * Isolated config/home directory for THIS harness instance, injected as
   * `CLAUDE_CONFIG_DIR`.
   *
   * Lets a work and a personal Claude account run side by side: without it
   * both would read and write the same `~/.claude` credential file and the
   * last login would silently win.
   */
  homeDir?: string;
  /** Additional env vars to pass to the SDK subprocess. */
  env?: Record<string, string | undefined>;
  /** Which settings sources to load. */
  settingSources?: Array<'user' | 'project' | 'local'>;
  /** Enable file checkpointing. */
  enableFileCheckpointing?: boolean;

  // ── W13 — provider hardening ──────────────────────────────────
  //
  // All three have working defaults inside the mechanisms themselves
  // (`ToolSemaphore`, `ByteCapper`, `cancelSemantically`), so leaving them
  // unset is the supported configuration. They exist so a deployment with an
  // unusual workload can widen a bound without editing the package — never so
  // a call site has to opt IN to being bounded.

  /**
   * W13 — per-tool-call budget in ms. A handler that exceeds it is abandoned
   * and reported as a timeout; the poison-pill ladder then downgrades and
   * eventually quarantines a tool that keeps doing it.
   * Defaults to `DEFAULT_TOOL_TIMEOUT_MS` (120 s). `0` disables.
   */
  toolTimeoutMs?: number;

  /**
   * W13 — per-record byte cap. A tool result larger than this is DROPPED and
   * replaced with model-legible guidance rather than truncated, because a
   * half-serialised result is corrupt rather than merely smaller.
   * Defaults to `DEFAULT_RECORD_BYTE_CAP` (1 MiB). `0` disables.
   */
  recordByteCapBytes?: number;

  /**
   * W13 — how long a cancel waits for the runtime to acknowledge an
   * `interrupt()` (by ending the turn with a `result`) before escalating.
   * Defaults to `DEFAULT_CANCEL_GRACE_MS` (2 s).
   *
   * The escalation here IS a process close, deliberately. `semanticCancel.ts`
   * forbids a kill because the runtimes it was written for are SHARED; a
   * persistent Claude session is one CLI process serving exactly one
   * conversation, so closing it takes nobody else down, and the next turn
   * simply reopens it with `resume`.
   */
  cancelGraceMs?: number;
}

export interface ActiveQuery {
  queryId: string;
  conversationId: string;
  abortController: AbortController;
  closeHandle?: () => void;
  status: 'running' | 'completed' | 'failed' | 'aborted';
  /**
   * W13 — the late-update guard's token for this turn, from
   * `GenerationGuard.begin(conversationId)`.
   *
   * Every update produced by this query carries it, and `GenerationGuard.accept`
   * discards anything stamped with an older one. Without it, a turn that was
   * cancelled or timed out can still deliver its trailing SDK messages — its
   * text, a re-opened tool call, or (worst) its own `harness.idle` — into the
   * REPLACEMENT turn, ending a running turn in the UI. Checking
   * `abortController.signal.aborted` does not catch this: the superseded turn's
   * last message can already be queued on the microtask queue behind the new
   * turn's first one.
   */
  generation?: number;
}

export interface StoredConversationConfig {
  conversationId: string;
  model?: string;
  systemPrompt?: string | { type: 'preset'; preset: 'claude_code'; append?: string };
  workingDirectory?: string;
  /**
   * Roots beyond `workingDirectory` the agent may read and write — the chat's
   * other mounts plus its managed workspace root. Maps 1:1 onto the SDK's
   * `Options.additionalDirectories`.
   *
   * Part of the session fingerprint: like `cwd`, the installed SDK (0.3.220)
   * has no live setter for it, so changing the mounts must rebuild the
   * session rather than silently leave the old roots in force.
   */
  additionalDirectories?: string[];
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  maxTurns?: number;
  maxBudgetUsd?: number;
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk';
  tools?: string[];
  allowedTools?: string[];
  disallowedTools?: string[];
  mcpServers?: Record<string, unknown>;
  agents?: Record<string, unknown>;
  /** Explicit skill allow-list by name. Claude's only way to turn skills on. */
  skills?: string[];
  /** Local plugin roots (`Options.plugins`) — where the session's skills live. */
  plugins?: Array<{ type: 'local'; path: string }>;
  /** Name of the agent to run on the main thread (replaces the base system prompt). */
  agent?: string;
  hooks?: unknown;
  sdkSessionId?: string;
  env?: Record<string, string | undefined>;
  /**
   * The `GENERATORAI_*` subset of `CreateConversationParams.env`, filtered at
   * conversation-creation time by `filterDelegatedHarnessEnv`. Merged into the
   * child environment BELOW `options.env` so a provider-level setting always
   * wins over one handed down per conversation.
   */
  delegatedEnv?: Record<string, string>;
  /**
   * Item 16 — last time this conversation was created, resumed, or had a
   * turn start or finish. The idle sweep and the LRU cap read it.
   */
  lastUsedAt?: number;
  /**
   * HITL-06 (Claude parity): Domain permission callback provided by the
   * caller (usually `StageExecutionService.buildPermissionHandler`). Bridged
   * to the Claude SDK's `canUseTool` in `buildQueryOptions`. When absent,
   * the SDK's own `permissionMode` decides.
   */
  onPermissionRequest?: (request: {
    type: 'file_write' | 'file_read' | 'shell_exec' | 'network' | 'other';
    description: string;
    details?: Record<string, unknown>;
  }) => Promise<{ granted: boolean; reason?: string }>;
  /**
   * PLN-01 — blocking gate invoked when the model calls `ExitPlanMode`.
   * Demultiplexed out of `canUseTool` by the adapter.
   */
  onPlanReviewRequest?: PlanReviewRequestHandler;
  /**
   * PLN-01 — blocking gate invoked when the model calls `AskUserQuestion`.
   * Demultiplexed out of `canUseTool` by the adapter.
   */
  onQuestionRequest?: QuestionRequestHandler;
  /** PLN-01 — Claude-native custom plan-mode workflow instructions. */
  planModeInstructions?: string;
}

/**
 * PLN-01 — per-conversation plan-mode phase.
 *
 * The "plan → implement" transition is realised inside our own `canUseTool`
 * rather than via `Query.setPermissionMode()`: while `permissionMode: 'plan'`
 * is active EVERY write lands on the callback by construction, so flipping to
 * implementation is simply "start returning allow". Doing it in the callback
 * keeps ONE mechanism for both runtime modes — the persistent streaming
 * session (where `setPermissionMode` would also work) and the one-shot
 * fallback (where it cannot).
 */
export interface PlanPhaseState {
  phase: 'planning' | 'implementing';
  /** Policy applied to non-plan tools once the plan is approved. */
  postApprovalPolicy: 'acceptEdits' | 'bypassPermissions';
  /**
   * Assistant text accumulated during the current turn. In plan mode the model
   * writes the plan as its message immediately before calling `ExitPlanMode`,
   * so this is the reliable fallback when `input.plan` is absent (the SDK's
   * `ExitPlanModeInput` does not declare a `plan` field).
   */
  planText: string;
}


