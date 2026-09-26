// ────────────────────────────────────────────────────────────────
// GeneratorAI SDK Configuration
// ────────────────────────────────────────────────────────────────

import type { HarnessType } from '@generatorai/agent-harness-providers';
import type { IAgentHarness } from '@generatorai/core';
import type { DatabaseConfig } from '@generatorai/db';
import { ValidationError } from '@generatorai/shared';

export interface LoggerConfig {
  level?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  pretty?: boolean;
}

export interface SandboxConfig {
  enabled?: boolean;
  preferDocker?: boolean;
}

/**
 * Which harness runs the agents: the same `HarnessType` the server reads from
 * `HARNESS_TYPE` / `HarnessConfig` (`'copilot'`, `'claude-agent'`, …), or a
 * pre-built `IAgentHarness` for bring-your-own-harness.
 */
export type HarnessSelection = HarnessType | IAgentHarness;

export interface GeneratorAIConfig {
  /**
   * Harness selection. Mirrors the server's `HarnessConfig.type` naming so an
   * SDK example and a server `.env` describe the same thing with the same word.
   * Either this or the deprecated `provider` alias must be set.
   */
  harness?: HarnessSelection;

  /**
   * @deprecated Renamed to `harness` when the server moved from
   * `CopilotConfig` to `HarnessConfig` (June 2026). Still honoured; `harness`
   * wins when both are given.
   */
  provider?: HarnessSelection;

  /** Harness-specific options (when using a string `harness`). */
  providerOptions?: Record<string, unknown>;

  /**
   * Database. A SQLite file path (default, e.g. './generatorai.db') or an
   * explicit `{ driver, url }` config. Only `sqlite` is wired today; `libsql` /
   * `postgres` are recognized by the seam and throw until an adapter is added.
   */
  database?: string | DatabaseConfig;

  /** Directory for artifacts (code output, logs). Defaults to './artifacts' */
  artifactsDir?: string;

  /** Directory for workflow scripts (.workflow.mjs). Defaults to './workflows' */
  scriptsDir?: string;

  /**
   * Directory for workflow/stage templates + system artifacts. `initialize()`
   * loads `<templatesDir>` and `<templatesDir>/system` workflow templates and
   * `<templatesDir>/system/artifacts` skills/prompts/agents. Defaults to
   * './templates'. Missing directory is tolerated (nothing loaded).
   */
  templatesDir?: string;

  /**
   * Max stages executing concurrently across all runs — bounds how many harness
   * subprocesses spawn at once so a small host isn't overwhelmed by a wide DAG
   * fan-out: the admission controller's `global` flow key. `0` (or negative)
   * means the highest limit the key takes (256). Defaults to 8.
   */
  maxConcurrentStages?: number;

  /** Logger configuration. Set to false to disable. */
  logger?: LoggerConfig | false;

  /** Sandbox configuration */
  sandbox?: SandboxConfig;


}

export interface ResolvedConfig {
  harness: HarnessSelection;
  providerOptions: Record<string, unknown>;
  database: string | DatabaseConfig;
  artifactsDir: string;
  scriptsDir: string;
  templatesDir: string;
  maxConcurrentStages: number;
  logger: LoggerConfig | false;
  sandbox: SandboxConfig;
}

export function resolveConfig(config: GeneratorAIConfig): ResolvedConfig {
  const harness = config.harness ?? config.provider;
  if (harness === undefined) {
    throw new ValidationError(
      "GeneratorAI config needs `harness` (e.g. 'copilot', 'claude-agent', or an IAgentHarness instance).",
    );
  }
  return {
    harness,
    providerOptions: config.providerOptions ?? {},
    database: config.database ?? './generatorai.db',
    artifactsDir: config.artifactsDir ?? './artifacts',
    scriptsDir: config.scriptsDir ?? './workflows',
    templatesDir: config.templatesDir ?? './templates',
    maxConcurrentStages: config.maxConcurrentStages ?? 8,
    logger: config.logger ?? { level: 'info' },
    sandbox: config.sandbox ?? { enabled: false },
  };
}
