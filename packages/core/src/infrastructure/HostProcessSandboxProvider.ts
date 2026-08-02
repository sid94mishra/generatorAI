// ────────────────────────────────────────────────────────────────
// HostProcessSandboxProvider — Fallback ISandboxProvider when
// Docker Sandbox is not available. Executes commands directly
// on the host in isolated working directories. Provides NO
// hypervisor isolation but keeps the same API surface so the
// rest of the system works identically.
// ────────────────────────────────────────────────────────────────

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  ISandboxProvider,
  SandboxConfig,
  SandboxExecOptions,
  SandboxExecResult,
  SandboxInfo,
} from '../domain/ports/ISandboxProvider.js';
import type { ILogger } from '@generatorai/shared';

const execFileAsync = promisify(execFile);

/** Allowlist of safe environment variables inherited from the host process */
const SAFE_ENV_VARS = new Set([
  'PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'TERM',
  'NODE_ENV', 'TMPDIR', 'TEMP', 'TMP',
  'SHELL', 'EDITOR', 'VISUAL',
  'SYSTEMROOT', 'WINDIR', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
  'ProgramFiles', 'ProgramFiles(x86)', 'ProgramData', 'ComSpec',
]);

/**
 * Fallback sandbox provider that runs commands on the host.
 * Used when Docker Sandbox is not available.
 * Provides process-level isolation only (not hypervisor).
 */
export class HostProcessSandboxProvider implements ISandboxProvider {
  private activeSandboxes = new Map<string, { config: SandboxConfig; workDir?: string }>();

  constructor(private readonly logger: ILogger) {}

  async create(config: SandboxConfig): Promise<void> {
    this.logger.warn(
      `[HostFallback] Creating host-process sandbox "${config.name}" (NO hypervisor isolation — fallback mode)`,
    );

    // Ensure all mount source directories exist
    for (const mount of config.mounts ?? []) {
      try {
        await fs.access(mount.source);
      } catch {
        await fs.mkdir(mount.source, { recursive: true });
      }
    }

    const workDir = config.mounts?.[0]?.source;
    this.activeSandboxes.set(config.name, { config, workDir });
    this.logger.info(`[HostFallback] Host sandbox ready: ${config.name}`);
  }

  async exec(
    name: string,
    command: string[],
    options?: SandboxExecOptions,
  ): Promise<SandboxExecResult> {
    const sandbox = this.activeSandboxes.get(name);
    if (!sandbox) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `Sandbox "${name}" does not exist`,
      };
    }

    // Validate command array before destructuring
    if (!command || command.length === 0) {
      return { exitCode: 1, stdout: '', stderr: 'No command specified' };
    }

    const [cmd, ...args] = command;
    if (typeof cmd !== 'string' || cmd.length === 0) {
      return { exitCode: 1, stdout: '', stderr: 'Command must be a non-empty string' };
    }

    // Validate cwd stays within the sandbox workspace to prevent path traversal
    const baseDir = sandbox.workDir ?? process.cwd();
    let cwd = options?.cwd ?? baseDir;
    if (options?.cwd) {
      const resolvedCwd = path.resolve(baseDir, options.cwd);
      const resolvedBase = path.resolve(baseDir);
      const relative = path.relative(resolvedBase, resolvedCwd);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `Working directory "${options.cwd}" resolves outside sandbox workspace`,
        };
      }
      cwd = resolvedCwd;
    }
    const timeout = options?.timeout ?? 300_000;

    // Build environment: only inherit safe host env vars + sandbox env + exec env
    const safeHostEnv: Record<string, string> = {};
    for (const key of SAFE_ENV_VARS) {
      if (process.env[key]) {
        safeHostEnv[key] = process.env[key]!;
      }
    }
    const env: Record<string, string> = {
      ...safeHostEnv,
      ...(sandbox.config.env ?? {}),
      ...(options?.env ?? {}),
    };

    try {
      if (options?.streamTo) {
        // Streaming mode — use spawn
        return await this.execWithStreaming(cmd, args, cwd, env, timeout, options.streamTo);
      }

      const { stdout, stderr } = await execFileAsync(cmd, args, {
        cwd,
        env,
        timeout,
        maxBuffer: 10 * 1024 * 1024,
      });
      return { exitCode: 0, stdout, stderr };
    } catch (err: unknown) {
      const e = err as { code?: number; stdout?: string; stderr?: string; killed?: boolean };
      if (e.killed) {
        return {
          exitCode: 137,
          stdout: e.stdout ?? '',
          stderr: (e.stderr ?? '') + '\n[Process timed out]',
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
    this.logger.debug(`[HostFallback] Stop called for ${name} (no-op in host mode)`);
  }

  async remove(name: string): Promise<void> {
    this.activeSandboxes.delete(name);
    this.logger.info(`[HostFallback] Sandbox removed: ${name}`);
  }

  async inspect(name: string): Promise<SandboxInfo> {
    const exists = this.activeSandboxes.has(name);
    return {
      name,
      status: exists ? 'running' : 'unknown',
    };
  }

  async isAvailable(): Promise<boolean> {
    // Host fallback is always available
    return true;
  }

  async list(_prefix?: string): Promise<SandboxInfo[]> {
    // Host-process fallback owns no cross-process state — there's nothing
    // to enumerate. Returning empty means the orphan reaper no-ops on this
    // provider, which is the correct behaviour (a host-mode crash leaves
    // no external resources to reclaim beyond the already-dead process).
    return [];
  }

  private execWithStreaming(
    cmd: string,
    args: string[],
    cwd: string,
    env: Record<string, string>,
    timeout: number,
    streamTo: (line: string, stream: 'stdout' | 'stderr') => void,
  ): Promise<SandboxExecResult> {
    return new Promise((resolve) => {
      const proc = spawn(cmd, args, {
        cwd,
        env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let killed = false;

      const timer = setTimeout(() => {
        killed = true;
        proc.kill('SIGKILL');
      }, timeout);

      proc.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        for (const line of text.split('\n')) {
          if (line) streamTo(line, 'stdout');
        }
      });

      proc.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        for (const line of text.split('\n')) {
          if (line) streamTo(line, 'stderr');
        }
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          exitCode: killed ? 137 : (code ?? 1),
          stdout,
          stderr: killed ? stderr + '\n[Process timed out]' : stderr,
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          exitCode: 1,
          stdout,
          stderr: err.message,
        });
      });
    });
  }
}
