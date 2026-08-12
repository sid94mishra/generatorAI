// ────────────────────────────────────────────────────────────────
// Types for ClaudeAgentProvider
// ────────────────────────────────────────────────────────────────

import type { PlanReviewRequestHandler, QuestionRequestHandler } from '@generatorai/core';

export interface ClaudeAgentProviderOptions {
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
}

export interface ActiveQuery {
  queryId: string;
  conversationId: string;
  abortController: AbortController;
  closeHandle?: () => void;
  status: 'running' | 'completed' | 'failed' | 'aborted';
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


