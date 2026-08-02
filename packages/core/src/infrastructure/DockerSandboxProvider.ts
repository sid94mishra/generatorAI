// ────────────────────────────────────────────────────────────────
// DockerSandboxProvider — ISandboxProvider via `docker sandbox` CLI
// Uses microVM-based isolation (Docker Desktop Sandbox feature)
// ────────────────────────────────────────────────────────────────

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import type {
  ISandboxProvider,
  SandboxConfig,
  SandboxExecOptions,
  SandboxExecResult,
  SandboxInfo,
} from '../domain/ports/ISandboxProvider.js';
import type { ILogger } from '@generatorai/shared';

const execFileAsync = promisify(execFile);

export class DockerSandboxProvider implements ISandboxProvider {
  constructor(private readonly logger: ILogger) {}

  async create(config: SandboxConfig): Promise<void> {
    // Docker Sandbox CLI syntax:
    //   docker sandbox create [--name NAME] [--template IMAGE] AGENT WORKSPACE
    // The workspace (first mount source) is auto-mounted at the same host path.
    const workspaceDir = config.mounts?.[0]?.source;
    if (!workspaceDir) {
      throw new Error('SandboxConfig must have at least one mount (workspace directory)');
    }

    // Validate workspace path exists
    try {
      await fs.access(workspaceDir);
    } catch {
      throw new Error(`Workspace directory "${workspaceDir}" does not exist or is not accessible`);
    }

    const args = ['sandbox', 'create', '--name', config.name];

    if (config.image && config.image !== 'default') {
      args.push('--template', config.image);
    }

    // Agent type defaults to 'copilot'
    args.push('copilot', workspaceDir);

    this.logger.info(`[DockerSandbox] Creating sandbox: ${config.name} (workspace: ${workspaceDir})`);
    try {
      await execFileAsync('docker', args, { timeout: 120_000 });
      this.logger.info(`[DockerSandbox] Sandbox created: ${config.name}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[DockerSandbox] Failed to create sandbox ${config.name}: ${msg}`);
      throw new Error(`Failed to create sandbox ${config.name}: ${msg}`);
    }
  }

  async exec(
    name: string,
    command: string[],
    options?: SandboxExecOptions,
  ): Promise<SandboxExecResult> {
    const args = ['sandbox', 'exec'];

    if (options?.cwd) {
      args.push('-w', options.cwd);
    }

    for (const [key, value] of Object.entries(options?.env ?? {})) {
      args.push('-e', `${key}=${value}`);
    }

    args.push(name, '--', ...command);

    const timeout = options?.timeout ?? 300_000;

    try {
      const { stdout, stderr } = await execFileAsync('docker', args, {
        timeout,
        maxBuffer: 10 * 1024 * 1024, // 10 MB
      });

      // Stream output if handler provided
      if (options?.streamTo) {
        for (const line of stdout.split('\n')) {
          if (line) options.streamTo(line, 'stdout');
        }
        for (const line of stderr.split('\n')) {
          if (line) options.streamTo(line, 'stderr');
        }
      }

      return { exitCode: 0, stdout, stderr };
    } catch (err: unknown) {
      const e = err as { code?: number; stdout?: string; stderr?: string; killed?: boolean };
      if (e.killed) {
        return {
          exitCode: 137,
          stdout: e.stdout ?? '',
          stderr: (e.stderr ?? '') + `\n[Docker sandbox exec timed out after ${timeout}ms]`,
        };
      }
      return {
        exitCode: typeof e.code === 'number' ? e.code : 1,
        stdout: e.stdout ?? '',
        stderr: e.stderr ?? (err instanceof Error ? err.message : String(err)),
      };
    }
  }

  async stop(name: string): Promise<void> {
    this.logger.info(`[DockerSandbox] Stopping sandbox: ${name}`);
    try {
      await execFileAsync('docker', ['sandbox', 'stop', name], { timeout: 30_000 });
    } catch {
      this.logger.warn(`[DockerSandbox] Stop failed for ${name} (may already be stopped)`);
    }
  }

  async remove(name: string): Promise<void> {
    this.logger.info(`[DockerSandbox] Removing sandbox: ${name}`);
    try {
      // Try stop first, then remove
      await this.stop(name);
      await execFileAsync('docker', ['sandbox', 'rm', name], { timeout: 30_000 });
      this.logger.info(`[DockerSandbox] Sandbox removed: ${name}`);
    } catch {
      this.logger.warn(`[DockerSandbox] Sandbox ${name} removal failed (may already be removed)`);
    }
  }

  async inspect(name: string): Promise<SandboxInfo> {
    try {
      // Docker Sandbox has no direct inspect — use `ls` and find by name
      const { stdout } = await execFileAsync(
        'docker',
        ['sandbox', 'ls'],
        { timeout: 10_000 },
      );
      // Parse table output: SANDBOX  AGENT  STATUS  WORKSPACE
      const lines = stdout.split('\n');
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts[0] === name) {
          const status = (parts[2] ?? '').toLowerCase();
          return {
            name,
            status: status === 'running' ? 'running' : 'stopped',
          };
        }
      }
      return { name, status: 'unknown' };
    } catch {
      return { name, status: 'unknown' };
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync('docker', ['sandbox', 'ls'], { timeout: 10_000 });
      return true;
    } catch {
      this.logger.debug('[DockerSandbox] docker sandbox not available');
      return false;
    }
  }

  async list(prefix?: string): Promise<SandboxInfo[]> {
    try {
      // `docker sandbox ls --format '{{.Name}}\t{{.State}}'` — tab-separated
      // machine-readable output. Fall back gracefully on parse errors.
      const { stdout } = await execFileAsync(
        'docker',
        ['sandbox', 'ls', '--format', '{{.Name}}\t{{.State}}'],
        { timeout: 10_000 },
      );
      const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
      const rows: SandboxInfo[] = [];
      for (const line of lines) {
        const [name, state = ''] = line.split('\t');
        if (!name) continue;
        if (prefix && !name.startsWith(prefix)) continue;
        const lower = state.toLowerCase();
        const status: SandboxInfo['status'] =
          lower.includes('run') ? 'running'
          : lower.includes('stop') ? 'stopped'
          : 'unknown';
        rows.push({ name, status });
      }
      return rows;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[DockerSandbox] list failed: ${msg}`);
      return [];
    }
  }
}
