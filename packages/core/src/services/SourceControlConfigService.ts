// ────────────────────────────────────────────────────────────────
// SourceControlConfigService — persisted provider selection + credentials
// ────────────────────────────────────────────────────────────────
//
// Persists the source-control configuration to a JSON file under the data
// directory (no DB migration needed) and applies it to the registry:
// registers/updates the GitHub provider and sets the active selection.
// Tokens are stored server-side only and never returned to clients.

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { ILogger } from '@generatorai/shared';
import {
  GitHubProvider,
  type SourceControlRegistry,
  type IScmHttpClient,
  type IScmProcessRunner,
  type ActiveProvider,
  type SourceControlConfig,
} from '@generatorai/source-control';

export interface SourceControlConfigDeps {
  http: IScmHttpClient;
  processRunner: IScmProcessRunner;
  logger: ILogger;
  /** Directory to persist the config file in (e.g. the data dir). */
  configDir: string;
  /** Initial config seeded from env at boot. */
  initial?: SourceControlConfig;
}

/** Public (client-safe) view of the source-control config — never exposes the token. */
export interface SafeSourceControlConfig {
  activeProvider: ActiveProvider;
  availableProviders: Array<'github'>;
  github: {
    configured: boolean;
    host?: string;
    defaultBase?: string;
  };
}

export class SourceControlConfigService {
  private config: SourceControlConfig;
  private readonly filePath: string;

  constructor(
    private readonly registry: SourceControlRegistry,
    private readonly deps: SourceControlConfigDeps,
  ) {
    this.filePath = path.join(deps.configDir, 'source-control.json');
    this.config = deps.initial ?? { activeProvider: 'none' };
  }

  /** Load persisted config (if any), else keep the seeded config, then apply. */
  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as SourceControlConfig;
      // Persisted config wins, but fall back to env token when persisted has none.
      this.config = {
        activeProvider: parsed.activeProvider ?? this.config.activeProvider,
        github: {
          token: parsed.github?.token ?? this.config.github?.token,
          host: parsed.github?.host ?? this.config.github?.host,
          defaultBase: parsed.github?.defaultBase ?? this.config.github?.defaultBase,
        },
      };
    } catch {
      // No persisted file — keep seeded config.
    }
    this.apply();
  }

  getConfig(): SafeSourceControlConfig {
    return {
      activeProvider: this.registry.getActive(),
      availableProviders: ['github'],
      github: {
        configured: Boolean(this.config.github?.token),
        host: this.config.github?.host,
        defaultBase: this.config.github?.defaultBase,
      },
    };
  }

  /** Update config (partial), persist, and re-apply to the registry. */
  async setConfig(update: {
    activeProvider?: ActiveProvider;
    github?: { token?: string | null; host?: string | null; defaultBase?: string | null };
  }): Promise<SafeSourceControlConfig> {
    if (update.activeProvider) {
      this.config.activeProvider = update.activeProvider;
    }
    if (update.github) {
      const g = this.config.github ?? {};
      if (update.github.token !== undefined) {
        g.token = update.github.token === null ? undefined : update.github.token;
      }
      if (update.github.host !== undefined) {
        g.host = update.github.host === null ? undefined : update.github.host;
      }
      if (update.github.defaultBase !== undefined) {
        g.defaultBase = update.github.defaultBase === null ? undefined : update.github.defaultBase;
      }
      this.config.github = g;
    }
    await this.persist();
    this.apply();
    return this.getConfig();
  }

  private apply(): void {
    // (Re)register the GitHub provider with the current token/host.
    this.registry.register(
      new GitHubProvider(
        this.deps.http,
        this.deps.logger,
        {
          token: this.config.github?.token,
          host: this.config.github?.host,
          allowCliFallback: true,
        },
        this.deps.processRunner,
      ),
    );
    this.registry.setActive(this.config.activeProvider);
    this.deps.logger.info(`[SCM] Config applied — active=${this.config.activeProvider}`);
  }

  private async persist(): Promise<void> {
    try {
      await fs.mkdir(this.deps.configDir, { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch (err) {
      this.deps.logger.warn(`[SCM] Failed to persist config: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
