// ────────────────────────────────────────────────────────────────
// GeneratorAI SDK Configuration
// ────────────────────────────────────────────────────────────────

import type { IAgentHarness } from '@generatorai/core';
import type { DatabaseConfig } from '@generatorai/db';

export interface LoggerConfig {
  level?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  pretty?: boolean;
}

export interface SandboxConfig {
  enabled?: boolean;
  preferDocker?: boolean;
}

export interface GeneratorAIConfig {
  /** AI provider — string shorthand or pre-built harness instance */
  provider: 'copilot' | 'claude-agent' | IAgentHarness;

  /** Provider-specific options (when using string shorthand) */
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

  /** Max concurrent AI sessions. Defaults to 10 */
  maxConcurrentSessions?: number;

  /**
   * Max stages executing concurrently across all runs — bounds how many harness
   * subprocesses spawn at once so a small host isn't overwhelmed by a wide DAG
   * fan-out. `0` (or negative) means unlimited. Defaults to 8.
   */
  maxConcurrentStages?: number;

  /** Logger configuration. Set to false to disable. */
  logger?: LoggerConfig | false;

  /** Sandbox configuration */
  sandbox?: SandboxConfig;

  /** Project root for workspace resolution. Defaults to process.cwd() */
  projectRoot?: string;

  /** Webhook configuration */
  webhooks?: {
    enabled?: boolean;
    githubSecret?: string;
    webhookToken?: string;
  };
}

export interface ResolvedConfig {
  provider: 'copilot' | 'claude-agent' | IAgentHarness;
  providerOptions: Record<string, unknown>;
  database: string | DatabaseConfig;
  artifactsDir: string;
  scriptsDir: string;
  templatesDir: string;
  maxConcurrentSessions: number;
  maxConcurrentStages: number;
  logger: LoggerConfig | false;
  sandbox: SandboxConfig;
  projectRoot: string;
  webhooks: {
    enabled: boolean;
    githubSecret?: string;
    webhookToken?: string;
  };
}

export function resolveConfig(config: GeneratorAIConfig): ResolvedConfig {
  return {
    provider: config.provider,
    providerOptions: config.providerOptions ?? {},
    database: config.database ?? './generatorai.db',
    artifactsDir: config.artifactsDir ?? './artifacts',
    scriptsDir: config.scriptsDir ?? './workflows',
    templatesDir: config.templatesDir ?? './templates',
    maxConcurrentSessions: config.maxConcurrentSessions ?? 10,
    maxConcurrentStages: config.maxConcurrentStages ?? 8,
    logger: config.logger ?? { level: 'info' },
    sandbox: config.sandbox ?? { enabled: false },
    projectRoot: config.projectRoot ?? process.cwd(),
    webhooks: {
      enabled: config.webhooks?.enabled ?? false,
      githubSecret: config.webhooks?.githubSecret,
      webhookToken: config.webhooks?.webhookToken,
    },
  };
}
