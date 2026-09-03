// ────────────────────────────────────────────────────────────────
// Types for ClaudeAgentProvider
// ────────────────────────────────────────────────────────────────

import type { PlanReviewRequestHandler, QuestionRequestHandler } from '@generatorai/core';
import type { AgentHostSupervisor } from '../../AgentHostSupervisor.js';

export interface ClaudeAgentProviderOptions {
  /**
   * W12 — optional AgentHostSupervisor that gates concurrent turns via the
   * execution semaphore. When provided, each `sendPromptAndWait` acquires one
   * execution slot before spawning a `query()` and releases it when the turn
   * completes (including on abort or error). Prevents unbounded concurrent
   * process spawns (P0-14: "Claude spawns one CLI per turn, uncapped").
   *
   * Omit in tests that don't need concurrency control. The default singleton
   * (`defaultAgentHostSupervisor`) is wired at the composition root.
   */
  supervisor?: AgentHostSupervisor;
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
   * W13 — how long a cancel waits for the runtime's own terminal event before
   * synthesising one. Never a process kill: the runtime may be shared, and
   * killing it would take every co-tenant session with it.
   * Defaults to `DEFAULT_CANCEL_GRACE_MS` (2 s).
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
  /** Name of the agent to run on the main thread (replaces the base system prompt). */
  agent?: string;
  hooks?: unknown;
  sdkSessionId?: string;
  env?: Record<string, string | undefined>;
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
 * The Claude SDK's `Query.setPermissionMode()` is only available in streaming
 * input mode, and this adapter drives single-shot `query({ prompt: string })`
 * per turn. We therefore realise the "plan → implement" transition inside our
 * own `canUseTool`: while `permissionMode: 'plan'` is active EVERY write lands
 * on the callback by construction, so flipping to implementation is simply
 * "start returning allow".
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


