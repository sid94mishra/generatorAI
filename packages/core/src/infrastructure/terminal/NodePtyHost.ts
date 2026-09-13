// ────────────────────────────────────────────────────────────────
// NodePtyHost — default `ITerminalHost` backed by `node-pty` (ConPTY on
// Windows, forkpty on POSIX). The native module is loaded via a dynamic
// require so a missing / broken build degrades gracefully to
// `FallbackChildProcessHost` (the composition root probes `isAvailable`).
//
// Sanitised env — strips secrets + preload variables. PowerShell profile
// is skipped by default for fast startup (~2 s → ~200 ms). Both toggles
// are exposed via GENERATORAI_TERMINAL_* envs so Settings UI can flip
// them without redeploying.
// ────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildChildEnv } from '@generatorai/shared';
import type { ILogger, TerminalHostKind } from '@generatorai/shared';
import type {
  ITerminalHandle,
  ITerminalHost,
  TerminalSpawnOptions,
} from '../../domain/ports/ITerminalHost.js';

/**
 * Parent variables an interactive shell needs beyond the base allowlist.
 *
 * The base list in `@generatorai/shared` is deliberately minimal and shared
 * with harness children; a shell additionally wants the user's editor and
 * pager preferences, and (on Unix) agent-forwarding sockets so `git push`
 * over SSH still works from an integrated terminal.
 *
 * `stripSensitiveSecrets` removes the SSH pair — the agent socket is a live
 * credential, so the toggle is what decides whether a model-driven terminal
 * may authenticate as the user.
 */
const SHELL_PASSTHROUGH: readonly string[] = ['EDITOR', 'VISUAL', 'PAGER', 'LESS'];
const SHELL_SSH_PASSTHROUGH: readonly string[] = ['SSH_AUTH_SOCK', 'SSH_AGENT_PID'];

/**
 * Minimal `node-pty` shape we need. Kept local so we can `require()` the
 * module lazily without pulling its types into the build graph — the
 * downstream server bundles `node-pty` and installs it as a native dep.
 */
interface NodePtyModule {
  spawn(
    file: string,
    args: string[] | string,
    options: {
      name: string;
      cols: number;
      rows: number;
      cwd: string;
      env: Record<string, string>;
      handleFlowControl?: boolean;
    },
  ): NodePtyProcess;
}
interface NodePtyProcess {
  pid: number;
  onData(cb: (data: string) => void): { dispose(): void };
  onExit(cb: (info: { exitCode: number; signal?: number }) => void): { dispose(): void };
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  pause(): void;
  resume(): void;
}

export interface NodePtyHostOptions {
  /** Skip PowerShell profile loading (`-NoProfile`). Default true. */
  skipPowerShellProfile?: boolean;
  /** Strip SSH_AUTH_SOCK / AWS_SESSION_TOKEN / … . Default true. */
  stripSensitiveSecrets?: boolean;
}

export class NodePtyHost implements ITerminalHost {
  readonly kind: TerminalHostKind = 'node-pty';
  private mod: NodePtyModule | null = null;
  private loadTried = false;
  private loadError: Error | null = null;
  private readonly opts: Required<NodePtyHostOptions>;

  constructor(private readonly logger: ILogger, opts?: NodePtyHostOptions) {
    this.opts = {
      skipPowerShellProfile:
        opts?.skipPowerShellProfile ?? (process.env['GENERATORAI_TERMINAL_PWSH_PROFILE'] !== '1'),
      stripSensitiveSecrets:
        opts?.stripSensitiveSecrets ?? (process.env['GENERATORAI_TERMINAL_ALLOW_SECRETS'] !== '1'),
    };
  }

  isAvailable(): boolean {
    if (!this.loadTried) this.tryLoad();
    return this.mod !== null;
  }

  async spawn(options: TerminalSpawnOptions): Promise<ITerminalHandle> {
    if (!this.mod) this.tryLoad();
    if (!this.mod) {
      const msg = this.loadError?.message ?? 'unknown';
      throw new Error(`[NodePtyHost] node-pty not available: ${msg}`);
    }

    const shell = options.shell ?? resolveDefaultShell();
    const args = this.buildShellArgs(shell, options.shellArgs);
    const env = this.buildEnv(options.workspaceId, options.env);

    let proc: NodePtyProcess;
    try {
      proc = this.mod.spawn(shell, args, {
        name: 'xterm-256color',
        cols: options.cols,
        rows: options.rows,
        cwd: options.cwd,
        env,
        handleFlowControl: true,
      });
    } catch (err) {
      const detail = (err as Error).message;
      // On POSIX, node-pty exec's a prebuilt `spawn-helper` to set up the
      // controlling terminal. Package managers routinely drop that file's
      // exec bit, and the addon then reports only `posix_spawnp failed` —
      // which reads like a bad shell or a missing cwd and sends people
      // chasing the wrong thing. Name the real cause and the fix.
      const looksLikePermission =
        process.platform !== 'win32' && /posix_spawnp|EACCES|permission denied/i.test(detail);
      throw new Error(
        `[NodePtyHost] spawn failed shell=${shell} cwd=${options.cwd}: ${detail}` +
          (looksLikePermission
            ? " — node-pty's spawn-helper is likely missing its executable bit;" +
              ' run `node scripts/fix-native-exec-bits.mjs` (or reinstall dependencies) to restore it.'
            : ''),
      );
    }

    return new NodePtyHandle(
      options.workspaceId,
      proc,
      shell,
      options.cwd,
      options.cols,
      options.rows,
      this.logger,
    );
  }

  private tryLoad(): void {
    this.loadTried = true;
    try {
      const req = createRequire(import.meta.url);
      this.mod = req('node-pty') as NodePtyModule;
      this.logger.info?.('[NodePtyHost] node-pty loaded');
    } catch (err) {
      this.loadError = err instanceof Error ? err : new Error(String(err));
      this.mod = null;
      this.logger.warn?.(
        `[NodePtyHost] node-pty unavailable — will fall back to child_process host: ${this.loadError.message}`,
      );
    }
  }

  private buildShellArgs(shell: string, extra?: string[]): string[] {
    const base = extra ?? [];
    if (process.platform === 'win32' && this.opts.skipPowerShellProfile) {
      const low = shell.toLowerCase();
      if (low.endsWith('pwsh.exe') || low.endsWith('powershell.exe')) {
        // Inject `-NoLogo -NoProfile` at the front if not already present.
        const has = (a: string) => base.some((x) => x.toLowerCase() === a);
        const inject: string[] = [];
        if (!has('-nologo')) inject.push('-NoLogo');
        if (!has('-noprofile')) inject.push('-NoProfile');
        return [...inject, ...base];
      }
    }
    return base;
  }

  private buildEnv(workspaceId: string, extra?: Record<string, string>): Record<string, string> {
    // Allowlist, not denylist. The previous denylist stripped `GENERATORAI_*`
    // and `DATABASE_URL` but passed `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
    // `GITHUB_TOKEN` and `AWS_ACCESS_KEY_ID` straight into a shell that runs
    // model-authored commands — and every new secret added to the server
    // would have been leaked by default. §11.1: no capability by negation.
    const out = buildChildEnv({
      passthrough: [
        ...SHELL_PASSTHROUGH,
        ...(this.opts.stripSensitiveSecrets ? [] : SHELL_SSH_PASSTHROUGH),
      ],
    });
    out['TERM'] = 'xterm-256color';
    out['COLORTERM'] = 'truecolor';
    out['GENERATORAI_WORKSPACE_ID'] = workspaceId;
    if (process.platform !== 'win32') {
      // Distinctive prompt so users know they're in a GeneratorAI shell.
      out['PS1'] = out['PS1'] ?? '\\[\\e[36m\\][genai]\\[\\e[0m\\] \\w \\$ ';
    }
    if (extra) Object.assign(out, extra);
    return out;
  }
}

/** Adapter over a node-pty process implementing `ITerminalHandle`. */
class NodePtyHandle implements ITerminalHandle {
  readonly id: string = randomUUID();
  readonly host: TerminalHostKind = 'node-pty';
  readonly pid: number;
  readonly createdAt = Date.now();

  private readonly bus = new EventEmitter();
  private disposed = false;
  private _cols: number;
  private _rows: number;
  private _exitCode: number | null = null;
  private _exitSignal: string | undefined = undefined;
  private readonly dataSub: { dispose(): void };
  private readonly exitSub: { dispose(): void };

  constructor(
    readonly workspaceId: string,
    private readonly proc: NodePtyProcess,
    readonly shell: string,
    readonly cwd: string,
    cols: number,
    rows: number,
    private readonly logger: ILogger,
  ) {
    this._cols = cols;
    this._rows = rows;
    this.pid = proc.pid;

    // node-pty exposes strings; the WS layer prefers Buffers so we encode once.
    this.dataSub = proc.onData((data) => {
      if (this.disposed) return;
      this.bus.emit('data', Buffer.from(data, 'utf8'));
    });
    this.exitSub = proc.onExit(({ exitCode, signal }) => {
      this._exitCode = exitCode;
      this._exitSignal = typeof signal === 'number' ? String(signal) : undefined;
      this.bus.emit('exit', { code: exitCode, signal: this._exitSignal });
      this.disposed = true;
      try { this.dataSub.dispose(); } catch { /* ignore */ }
      try { this.exitSub.dispose(); } catch { /* ignore */ }
    });
  }

  get cols(): number { return this._cols; }
  get rows(): number { return this._rows; }
  get exitCode(): number | null { return this._exitCode; }
  get exitSignal(): string | undefined { return this._exitSignal; }

  write(data: string | Buffer): void {
    if (this.disposed) return;
    this.proc.write(typeof data === 'string' ? data : data.toString('utf8'));
  }
  resize(cols: number, rows: number): void {
    if (this.disposed) return;
    try {
      this.proc.resize(cols, rows);
      this._cols = cols;
      this._rows = rows;
    } catch (err) {
      this.logger.warn?.(`[NodePtyHandle] resize failed: ${(err as Error).message}`);
    }
  }
  signal(name: string): void {
    if (this.disposed) return;
    try {
      this.proc.kill(name);
    } catch (err) {
      this.logger.warn?.(`[NodePtyHandle] signal ${name} failed: ${(err as Error).message}`);
    }
  }
  kill(signal?: string): void {
    if (this.disposed) return;
    try {
      this.proc.kill(signal);
    } catch { /* ignore */ }
  }
  pause(): void { try { this.proc.pause(); } catch { /* ignore */ } }
  resume(): void { try { this.proc.resume(); } catch { /* ignore */ } }
  onData(cb: (chunk: Buffer) => void): () => void {
    this.bus.on('data', cb);
    return () => this.bus.off('data', cb);
  }
  onExit(cb: (info: { code: number; signal?: string }) => void): () => void {
    this.bus.on('exit', cb);
    return () => this.bus.off('exit', cb);
  }
}

// ── Shell resolution ────────────────────────────────────────────

/** Detect the platform default shell. Cached across calls. */
let cachedDefaultShell: string | null = null;
export function resolveDefaultShell(): string {
  if (cachedDefaultShell) return cachedDefaultShell;
  if (process.platform === 'win32') {
    cachedDefaultShell = resolveWindowsShell();
  } else {
    cachedDefaultShell = process.env['SHELL'] ?? '/bin/bash';
  }
  return cachedDefaultShell;
}

function resolveWindowsShell(): string {
  // Cascade: pwsh 7 → powershell → cmd.
  const candidates: string[] = [];
  const programFiles = process.env['ProgramFiles'];
  if (programFiles) {
    candidates.push(path.join(programFiles, 'PowerShell', '7', 'pwsh.exe'));
  }
  const programFilesx86 = process.env['ProgramFiles(x86)'];
  if (programFilesx86) {
    candidates.push(path.join(programFilesx86, 'PowerShell', '7', 'pwsh.exe'));
  }
  const winDir = process.env['WINDIR'] ?? 'C:\\Windows';
  candidates.push(
    path.join(winDir, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    path.join(winDir, 'System32', 'cmd.exe'),
  );
  for (const c of candidates) {
    try {
      if (existsSync(c)) return c;
    } catch { /* ignore */ }
  }
  // Last resort — PATH resolution.
  return 'cmd.exe';
}

// Reference `os` to keep the import for future macOS/Linux SHELL fallback.
void os.platform;
