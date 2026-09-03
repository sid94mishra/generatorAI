// ────────────────────────────────────────────────────────────────
// SandboxedScriptRunner — secure script execution with sandboxing
// ────────────────────────────────────────────────────────────────

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import type { IScriptRunner, ScriptRunOptions, ScriptRunResult } from '../domain/ports/IScriptRunner.js';
import type { ILogger } from '@generatorai/shared';
import { SecurityError, buildChildEnv } from '@generatorai/shared';

/**
 * Allowed commands that may be spawned. Any command not on this list
 * is rejected before the process is created.
 */
const COMMAND_ALLOWLIST = new Set([
  'node',
  'npm',
  'npx',
  'pnpm',
  'git',
  'sh',
  'bash',
  'python',
  'python3',
  'pip',
  'pip3',
  'curl',
  'wget',
  'cat',
  'echo',
  'ls',
  'dir',
  'mkdir',
  'cp',
  'mv',
  'rm',
  'touch',
  'chmod',
  'grep',
  'find',
  'sed',
  'awk',
  'jq',
  'tar',
  'unzip',
  'zip',
  'tsc',
  'eslint',
  'prettier',
  'vitest',
  'jest',
  'gh',
  'which',
  'where',
]);

/**
 * Patterns that should never appear in arguments (basic injection prevention).
 */
const DANGEROUS_PATTERNS = [
  /;\s*rm\s+-rf/i,
  /\$\(/,
  /`/,
  />\s*\/dev\//,
  /\|\s*sh/,
  /\|\s*bash/,
  /eval\s/i,
];

export interface SandboxedScriptRunnerOptions {
  defaultTimeoutMs?: number;
  maxOutputBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT = 1024 * 1024; // 1 MB

export class SandboxedScriptRunner implements IScriptRunner {
  private readonly defaultTimeout: number;
  private readonly maxOutput: number;
  private activeProcesses = new Map<string, ReturnType<typeof spawn>>();

  constructor(
    private readonly logger: ILogger,
    options?: SandboxedScriptRunnerOptions,
  ) {
    this.defaultTimeout = options?.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxOutput = options?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
  }

  async run(command: string, args: string[], options: ScriptRunOptions): Promise<ScriptRunResult> {
    // ── Security checks ──
    this.validateCommand(command);
    this.validateArgs(args);

    const timeout = options.timeout ?? this.defaultTimeout;
    const processId = randomUUID();
    const startTime = Date.now();

    // On Windows, shell builtins (echo, dir, cd, type) cannot be spawned
    // without a shell. Wrap them in cmd.exe /c for safe execution.
    let spawnCmd = command;
    let spawnArgs = args;
    const WINDOWS_BUILTINS = new Set(['echo', 'dir', 'cd', 'type', 'copy', 'del', 'set', 'cls']);
    if (process.platform === 'win32' && WINDOWS_BUILTINS.has(command)) {
      spawnCmd = 'cmd.exe';
      spawnArgs = ['/c', command, ...args];
    }

    this.logger.info(`[ScriptRunner] Executing: ${spawnCmd} ${spawnArgs.join(' ')} (pid=${processId})`);

    return new Promise<ScriptRunResult>((resolve) => {
      const proc = spawn(spawnCmd, spawnArgs, {
        cwd: options.cwd ? path.resolve(options.cwd) : undefined,
        // Workflow scripts are model-authorable, so this child gets an
        // allowlisted environment rather than a clone of the server's — a
        // clone would hand a generated `.workflow.mjs` the vault key, the
        // desktop admin token, DATABASE_URL and every provider credential.
        env: buildChildEnv(options.env ? { extra: options.env } : {}),
        shell: false, // Never use shell to prevent injection
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout,
      });

      this.activeProcesses.set(processId, proc);

      let stdout = '';
      let stderr = '';
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let killed = false;

      proc.stdout?.on('data', (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes <= this.maxOutput) {
          stdout += chunk.toString();
        }
        options.streamTo?.(chunk.toString(), 'stdout');
      });

      proc.stderr?.on('data', (chunk: Buffer) => {
        stderrBytes += chunk.length;
        if (stderrBytes <= this.maxOutput) {
          stderr += chunk.toString();
        }
        options.streamTo?.(chunk.toString(), 'stderr');
      });

      const timer = setTimeout(() => {
        killed = true;
        proc.kill('SIGKILL');
        this.logger.warn(`[ScriptRunner] Process ${processId} timed out after ${timeout}ms`);
      }, timeout);

      // Handle abort signal
      if (options.abortSignal) {
        options.abortSignal.addEventListener('abort', () => {
          killed = true;
          proc.kill('SIGKILL');
        }, { once: true });
      }

      proc.on('close', (code) => {
        clearTimeout(timer);
        this.activeProcesses.delete(processId);

        resolve({
          exitCode: killed ? -1 : (code ?? -1),
          stdout: stdout.trimEnd(),
          stderr: killed
            ? `Process timed out after ${timeout}ms\n${stderr}`.trimEnd()
            : stderr.trimEnd(),
          durationMs: Date.now() - startTime,
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        this.activeProcesses.delete(processId);
        resolve({
          exitCode: -1,
          stdout: '',
          stderr: err.message,
          durationMs: Date.now() - startTime,
        });
      });
    });
  }

  async isAvailable(command: string): Promise<boolean> {
    try {
      const base = path.basename(command);
      if (!COMMAND_ALLOWLIST.has(base)) return false;

      const result = await this.run(
        process.platform === 'win32' ? 'where' : 'which',
        [command],
        { cwd: '.' },
      );
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  /** Kill all active child processes during graceful shutdown. */
  async shutdown(): Promise<void> {
    for (const [id, proc] of this.activeProcesses) {
      proc.kill('SIGKILL');
      this.logger.warn(`[ScriptRunner] Killed leftover process ${id}`);
    }
    this.activeProcesses.clear();
  }

  // ── Validation ──

  private validateCommand(command: string): void {
    const base = path.basename(command);
    if (!COMMAND_ALLOWLIST.has(base)) {
      throw new SecurityError(
        `Command "${base}" is not in the allowlist. Allowed: ${[...COMMAND_ALLOWLIST].join(', ')}`,
      );
    }
  }

  private validateArgs(args: string[]): void {
    const joined = args.join(' ');
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(joined)) {
        throw new SecurityError(`Potentially dangerous argument pattern detected: ${pattern}`);
      }
    }
  }
}
