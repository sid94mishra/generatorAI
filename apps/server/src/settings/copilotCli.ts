// ────────────────────────────────────────────────────────────────
// CopilotCliService — the Copilot CLI downloaded on first use (evaluation:
// the bundled binary added ~308 MB to every download).
//
// At boot it points the provider at a CLI downloaded earlier
// (`COPILOT_CLI_PATH`, which `resolveCopilotCliPath` reads before the
// loader). `install()` starts the download in the background; the providers
// route reports it (`installable`, `installing`, or the error) and the
// Settings page polls until the CLI is there, then the provider is re-probed.
// A development checkout has the platform package in node_modules: never
// installable, nothing to download.
// ────────────────────────────────────────────────────────────────

import { existsSync } from 'node:fs';
import {
  bundledCopilotCliVersion,
  downloadedCopilotCliPath,
  installCopilotCli,
  installedCopilotPlatformBinary,
} from '@generatorai/agent-harness-providers';

export interface CopilotCliState {
  /** The CLI is runnable (bundled, configured, or downloaded). */
  available: boolean;
  /** It can be downloaded here (a pinned version is known and it is missing). */
  installable: boolean;
  installing?: { receivedBytes: number; totalBytes?: number };
  error?: string;
}

export class CopilotCliService {
  private progress: { receivedBytes: number; totalBytes?: number } | null = null;
  private error: string | undefined;
  private readonly version = bundledCopilotCliVersion();

  constructor(
    private readonly dir: string,
    private readonly onInstalled: () => void,
    private readonly logger?: { info: (m: string) => void; warn: (m: string) => void },
  ) {
    const downloaded = this.version ? downloadedCopilotCliPath(dir, this.version) : undefined;
    if (downloaded && !this.configured() && !installedCopilotPlatformBinary()) process.env['COPILOT_CLI_PATH'] = downloaded;
  }

  private configured(): boolean {
    const p = process.env['COPILOT_CLI_PATH'];
    return !!p && existsSync(p);
  }

  state(): CopilotCliState {
    const available = this.configured() || !!installedCopilotPlatformBinary();
    return {
      available,
      installable: !available && !!this.version,
      ...(this.progress ? { installing: { ...this.progress } } : {}),
      ...(this.error ? { error: this.error } : {}),
    };
  }

  /** Starts the download (no-op while one runs or when the CLI is already there). */
  install(): CopilotCliState {
    const now = this.state();
    if (now.available || this.progress || !this.version) return now;
    const version = this.version;
    this.error = undefined;
    this.progress = { receivedBytes: 0 };
    this.logger?.info(`[CopilotCli] downloading the Copilot CLI ${version} into ${this.dir}`);
    void installCopilotCli({
      dir: this.dir,
      version,
      onProgress: (p) => {
        this.progress = { receivedBytes: p.receivedBytes, ...(p.totalBytes ? { totalBytes: p.totalBytes } : {}) };
      },
    })
      .then((entry) => {
        process.env['COPILOT_CLI_PATH'] = entry;
        this.logger?.info(`[CopilotCli] installed the Copilot CLI ${version} at ${entry}`);
        this.onInstalled();
      })
      .catch((err: unknown) => {
        this.error = err instanceof Error ? err.message : String(err);
        this.logger?.warn(`[CopilotCli] download failed: ${this.error}`);
      })
      .finally(() => {
        this.progress = null;
      });
    return this.state();
  }
}
