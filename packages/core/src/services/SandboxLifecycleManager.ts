// ────────────────────────────────────────────────────────────────
// SandboxLifecycleManager — Per-run sandbox lifecycle management
// Creates sandbox → starts CLI → provides cliUrl → destroys on completion
// Falls back to host-process provider if Docker Sandbox unavailable
// ────────────────────────────────────────────────────────────────

import type { ISandboxProvider, SandboxConfig } from '../domain/ports/ISandboxProvider.js';
import type { ILogger } from '@generatorai/shared';

export interface SandboxSession {
  sandboxName: string;
  /** cliUrl for the SDK to connect to; undefined if CLI not started in sandbox */
  cliUrl?: string;
  cliPort: number;
  /** Whether this is using the Docker sandbox or the host fallback */
  isDockerSandbox: boolean;
}

export interface SandboxLifecycleConfig {
  image: string;
  cliPort: number;
  startupTimeoutMs: number;
  /** Whether Docker Sandbox was detected at startup */
  dockerAvailable: boolean;
}

/**
 * Tracks sandboxes whose `remove()` failed so we can retry the reap
 * later. Without this, a transient Docker outage during shutdown
 * would leak containers on the host indefinitely.
 */
interface OrphanRecord {
  sandboxName: string;
  discoveredAt: number;
  errorCount: number;
  lastError: string;
}

export class SandboxLifecycleManager {
  private activeSandboxes = new Map<string, { session: SandboxSession; createdAt: number }>();
  private readonly MAX_ACTIVE_SANDBOXES = 50;
  private readonly MIN_CREATION_INTERVAL_MS = 500;
  private readonly MAX_CREATE_QUEUE_SIZE = 200;
  private readonly SANDBOX_NAME_PREFIX = 'genai-run-';

  /** Creation queue (1.8). Replaces the old event-loop-blocking `sleep()`. */
  private createQueue: Array<{
    task: () => Promise<SandboxSession>;
    resolve: (s: SandboxSession) => void;
    reject: (e: Error) => void;
  }> = [];
  private createQueueActive = false;

  /** Orphan registry (1.9). */
  private orphans = new Map<string, OrphanRecord>();

  constructor(
    private readonly provider: ISandboxProvider,
    private readonly config: SandboxLifecycleConfig,
    private readonly logger: ILogger,
  ) {}

  /**
   * Create a sandbox for a workflow run.
   * If Docker Sandbox is available, creates a real microVM.
   * If not, creates a host-process sandbox (fallback).
   *
   * Creation is serialized behind a small FIFO queue with a configurable
   * minimum inter-creation gap. The old implementation slept on the event
   * loop inside the request handler; 100 concurrent starts blocked the
   * server for ~50s. The queue keeps the server responsive while still
   * respecting the rate limit.
   */
  async createForRun(
    runId: string,
    workspaceDir: string,
    env?: Record<string, string>,
  ): Promise<SandboxSession> {
    if (this.activeSandboxes.size >= this.MAX_ACTIVE_SANDBOXES) {
      throw new Error(
        `Maximum active sandboxes (${this.MAX_ACTIVE_SANDBOXES}) reached. ` +
        `Destroy existing sandboxes before creating new ones.`,
      );
    }
    if (this.createQueue.length >= this.MAX_CREATE_QUEUE_SIZE) {
      throw new Error(
        `Sandbox creation queue is full (${this.MAX_CREATE_QUEUE_SIZE}). ` +
        `Downstream sandbox provider is too slow; back off or scale horizontally.`,
      );
    }

    return new Promise<SandboxSession>((resolve, reject) => {
      this.createQueue.push({
        task: () => this.createSandboxImpl(runId, workspaceDir, env),
        resolve,
        reject,
      });
      void this.drainCreateQueue();
    });
  }

  private async drainCreateQueue(): Promise<void> {
    if (this.createQueueActive) return;
    this.createQueueActive = true;
    try {
      while (this.createQueue.length > 0) {
        const next = this.createQueue.shift()!;
        try {
          const session = await next.task();
          next.resolve(session);
        } catch (err) {
          next.reject(err instanceof Error ? err : new Error(String(err)));
        }
        // Space creations out without blocking callers.
        if (this.createQueue.length > 0) {
          await new Promise((r) => setTimeout(r, this.MIN_CREATION_INTERVAL_MS));
        }
      }
    } finally {
      this.createQueueActive = false;
    }
  }

  private async createSandboxImpl(
    runId: string,
    workspaceDir: string,
    env?: Record<string, string>,
  ): Promise<SandboxSession> {

    const sandboxName = `${this.SANDBOX_NAME_PREFIX}${runId}`;
    const cliPort = this.config.cliPort;

    const sandboxConfig: SandboxConfig = {
      name: sandboxName,
      image: this.config.image,
      mounts: [
        {
          source: workspaceDir,
          target: workspaceDir,
        },
      ],
      env: {
        ...env,
        COPILOT_CLI_PORT: String(cliPort),
      },
    };

    await this.provider.create(sandboxConfig);

    const session: SandboxSession = {
      sandboxName,
      cliPort,
      isDockerSandbox: this.config.dockerAvailable,
    };

    // For Docker Sandbox, we would start the CLI inside and set cliUrl.
    // For now, we record the session and the orchestrator handles CLI startup.
    if (this.config.dockerAvailable) {
      // Start Copilot CLI in headless mode in the sandbox
      try {
        // First verify that copilot CLI is installed in the sandbox image
        const whichResult = await this.provider.exec(sandboxName, [
          'sh', '-c', 'command -v copilot',
        ], { timeout: 5_000 });

        if (whichResult.exitCode !== 0) {
          throw new Error('copilot CLI not found in sandbox image. Ensure the image has @github/copilot installed.');
        }

        // Launch CLI in background using nohup in a single exec call to avoid race condition
        await this.provider.exec(sandboxName, [
          'sh', '-c',
          `nohup copilot --headless --port ${cliPort} > /tmp/copilot-cli.log 2>&1 &`,
        ], { timeout: 10_000 });

        // Wait for CLI to be ready
        await this.waitForCli(sandboxName, cliPort);
        session.cliUrl = `localhost:${cliPort}`;
        this.logger.info(`[SandboxLifecycle] CLI started in sandbox at ${session.cliUrl}`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `[SandboxLifecycle] CLI startup in sandbox failed, sandbox still usable for scripts: ${errMsg}`,
        );
        // Try to capture CLI logs for diagnostics
        try {
          const logResult = await this.provider.exec(sandboxName, [
            'cat', '/tmp/copilot-cli.log',
          ], { timeout: 3_000 });
          if (logResult.stdout) {
            this.logger.debug(`[SandboxLifecycle] CLI startup log: ${logResult.stdout.slice(0, 500)}`);
          }
        } catch { /* best-effort diagnostics */ }
      }
    }

    this.activeSandboxes.set(runId, { session, createdAt: Date.now() });
    this.logger.info(
      `[SandboxLifecycle] Sandbox ready for run ${runId}: ${sandboxName} ` +
      `(docker=${session.isDockerSandbox}, cliUrl=${session.cliUrl ?? 'n/a'})`,
    );
    return session;
  }

  async destroyForRun(runId: string): Promise<void> {
    const entry = this.activeSandboxes.get(runId);
    if (!entry) return;

    const sandboxName = entry.session.sandboxName;
    try {
      await this.provider.remove(sandboxName);
      this.logger.info(`[SandboxLifecycle] Sandbox destroyed for run ${runId}`);
      // Clear any prior orphan record — container is gone.
      this.orphans.delete(sandboxName);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[SandboxLifecycle] Failed to destroy sandbox for run ${runId} (${sandboxName}): ${msg}`,
      );
      // Record so `cleanupOrphans` retries at boot or periodically.
      const prev = this.orphans.get(sandboxName);
      this.orphans.set(sandboxName, {
        sandboxName,
        discoveredAt: prev?.discoveredAt ?? Date.now(),
        errorCount: (prev?.errorCount ?? 0) + 1,
        lastError: msg,
      });
    } finally {
      this.activeSandboxes.delete(runId);
    }
  }

  /** Expose the registry so `/health` and ops tooling can surface it. */
  getOrphanedContainers(): OrphanRecord[] {
    return [...this.orphans.values()];
  }

  /**
   * Boot-time reaper (1.7 / 1.9). Enumerates every sandbox matching the
   * `genai-run-` prefix, retries `remove()` on any previously-failed
   * orphan, and best-effort destroys containers not known to the current
   * process (which implies a previous crash).
   *
   * Returns a summary the StartupRecoveryService can log.
   */
  async cleanupOrphans(): Promise<{ destroyed: string[]; failed: string[] }> {
    const destroyed: string[] = [];
    const failed: string[] = [];

    let existing: Awaited<ReturnType<ISandboxProvider['list']>> = [];
    try {
      existing = await this.provider.list(this.SANDBOX_NAME_PREFIX);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[SandboxLifecycle] Orphan enumeration failed: ${msg}`);
      // Still try recorded orphans below.
    }

    const candidateNames = new Set<string>(existing.map((s) => s.name));
    for (const name of this.orphans.keys()) candidateNames.add(name);

    for (const sandboxName of candidateNames) {
      // Skip containers we're currently managing.
      const managed = [...this.activeSandboxes.values()].some(
        (e) => e.session.sandboxName === sandboxName,
      );
      if (managed) continue;

      try {
        await this.provider.remove(sandboxName);
        destroyed.push(sandboxName);
        this.orphans.delete(sandboxName);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failed.push(sandboxName);
        const prev = this.orphans.get(sandboxName);
        this.orphans.set(sandboxName, {
          sandboxName,
          discoveredAt: prev?.discoveredAt ?? Date.now(),
          errorCount: (prev?.errorCount ?? 0) + 1,
          lastError: msg,
        });
      }
    }

    if (destroyed.length > 0) {
      this.logger.info(
        `[SandboxLifecycle] Reaped ${destroyed.length} orphan(s): ${destroyed.join(', ')}`,
      );
    }
    if (failed.length > 0) {
      this.logger.warn(
        `[SandboxLifecycle] ${failed.length} orphan(s) failed to reap: ${failed.join(', ')}`,
      );
    }
    return { destroyed, failed };
  }

  getSession(runId: string): SandboxSession | undefined {
    return this.activeSandboxes.get(runId)?.session;
  }

  async destroyAll(): Promise<void> {
    const entries = [...this.activeSandboxes.entries()];
    if (entries.length > 0) {
      this.logger.info(`[SandboxLifecycle] Destroying ${entries.length} active sandbox(es)...`);
    }
    await Promise.allSettled(
      entries.map(([runId]) => this.destroyForRun(runId)),
    );
  }

  private async waitForCli(sandboxName: string, port: number): Promise<void> {
    const maxAttempts = Math.ceil(this.config.startupTimeoutMs / 1000);
    let lastError = '';
    for (let i = 0; i < maxAttempts; i++) {
      try {
        // Use bash /dev/tcp builtin — works without requiring curl/nc
        const result = await this.provider.exec(
          sandboxName,
          ['bash', '-c', `echo > /dev/tcp/localhost/${port}`],
          { timeout: 3_000 },
        );
        if (result.exitCode === 0) {
          this.logger.debug(`[SandboxLifecycle] CLI ready on port ${port} after ${i + 1} attempts`);
          return;
        }
        lastError = result.stderr || `exit code ${result.exitCode}`;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(
      `Copilot CLI failed to start in sandbox ${sandboxName} within ${this.config.startupTimeoutMs}ms. ` +
      `Last check error: ${lastError}. ` +
      `Check logs with: docker sandbox exec ${sandboxName} cat /tmp/copilot-cli.log`,
    );
  }
}
