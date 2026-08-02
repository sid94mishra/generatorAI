// ────────────────────────────────────────────────────────────────
// Agent Harness Provider types
// ────────────────────────────────────────────────────────────────

import type { ILogger } from '@generatorai/shared';

/**
 * Discriminator for provider selection. Extend this union when adding
 * a new provider — TypeScript exhaustiveness checks in the factory
 * will force you to handle the new case.
 */
export type HarnessType = 'copilot' | 'claude-agent';

/**
 * Union of all provider-specific configuration options.
 * The factory reads `type` to select the correct provider and passes
 * the matching config section.
 */
export interface HarnessProviderConfig {
  type: HarnessType;
  copilot?: CopilotProviderOptions;
  claudeAgent?: ClaudeAgentProviderOptions;
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
}

export interface HarnessFactoryOptions {
  logger?: ILogger;
}
