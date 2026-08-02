// ────────────────────────────────────────────────────────────────
// SandboxScriptRunner — IScriptRunner adapter that routes
// commands through a sandbox instance via ISandboxProvider
// ────────────────────────────────────────────────────────────────

import type { IScriptRunner, ScriptRunOptions, ScriptRunResult } from '../domain/ports/IScriptRunner.js';
import type { ISandboxProvider, SandboxExecOptions } from '../domain/ports/ISandboxProvider.js';
import type { ILogger } from '@generatorai/shared';

export class SandboxScriptRunner implements IScriptRunner {
  constructor(
    private readonly sandboxProvider: ISandboxProvider,
    private readonly sandboxName: string,
    private readonly logger: ILogger,
  ) {}

  async run(command: string, args: string[], options: ScriptRunOptions): Promise<ScriptRunResult> {
    const startTime = Date.now();

    const execOptions: SandboxExecOptions = {
      cwd: options.cwd,
      env: options.env,
      timeout: options.timeout,
      streamTo: options.streamTo,
    };

    this.logger.debug(
      `[SandboxScriptRunner] Executing in sandbox "${this.sandboxName}": ${command} ${args.join(' ')}`,
    );

    const result = await this.sandboxProvider.exec(
      this.sandboxName,
      [command, ...args],
      execOptions,
    );

    const durationMs = Date.now() - startTime;

    if (result.exitCode !== 0) {
      this.logger.debug(
        `[SandboxScriptRunner] Command failed (exit ${result.exitCode}) in ${durationMs}ms: ${command} ${args.join(' ')}`,
      );
    }

    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs,
    };
  }

  async isAvailable(command: string): Promise<boolean> {
    try {
      const result = await this.sandboxProvider.exec(
        this.sandboxName,
        ['which', command],
        { timeout: 5_000 },
      );
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }
}
