// ────────────────────────────────────────────────────────────────
// FallbackChildProcessHost — degraded terminal path used when `node-pty`
// cannot be loaded (native module build failed, Alpine/musl Linux, etc.).
//
// The shell is spawned via plain `child_process.spawn` with the parent
// stdio piped. This gives us line-buffered output only — no cursor
// addressing, no color from programs that check isatty(), no `vim` /
// `htop`. We surface this via `TerminalHostKind = 'fallback-child-process'`
// so the SPA can render a "Fallback mode" banner.
// ────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { buildChildEnv } from '@generatorai/shared';
import type { ILogger, TerminalHostKind } from '@generatorai/shared';
import type {
  ITerminalHandle,
  ITerminalHost,
  TerminalSpawnOptions,
} from '../../domain/ports/ITerminalHost.js';
import { resolveDefaultShell } from './NodePtyHost.js';

export class FallbackChildProcessHost implements ITerminalHost {
  readonly kind: TerminalHostKind = 'fallback-child-process';

  constructor(private readonly logger: ILogger) {}

  isAvailable(): boolean {
    return true; // always available — this is the last-resort host
  }

  async spawn(options: TerminalSpawnOptions): Promise<ITerminalHandle> {
    const shell = options.shell ?? resolveDefaultShell();
    // Spawn an interactive shell. `-i` on POSIX; on Windows we rely on the
    // default of PowerShell / cmd's interactive behaviour.
    const args = options.shellArgs ?? (process.platform === 'win32' ? [] : ['-i']);
    // Allowlist, not a clone-then-delete. The previous version cloned
    // `process.env` and removed three names while claiming parity with
    // `NodePtyHost` — it leaked GENERATORAI_SECRET_KEY, the desktop admin
    // token, DATABASE_URL and every provider credential into a shell that
    // runs model-authored commands. Both hosts now build from the same
    // shared allowlist, so the comment and the behaviour cannot drift apart
    // again.
    const env = buildChildEnv({
      passthrough: ['EDITOR', 'VISUAL', 'PAGER', 'LESS'],
      ...(options.env ? { extra: options.env } : {}),
    }) as NodeJS.ProcessEnv;
    env['TERM'] = 'dumb';
    env['GENERATORAI_WORKSPACE_ID'] = options.workspaceId;

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(shell, args, {
        cwd: options.cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (err) {
      throw new Error(
        `[FallbackChildProcessHost] spawn failed shell=${shell} cwd=${options.cwd}: ${(err as Error).message}`,
      );
    }

    // Print a one-line banner so the user knows they're in the fallback mode.
    const banner =
      `\r\n[GeneratorAI] Fallback terminal — full PTY features (colors, vim, htop) are unavailable.\r\n\r\n`;

    return new FallbackHandle(
      options.workspaceId,
      shell,
      options.cwd,
      options.cols,
      options.rows,
      child,
      banner,
      this.logger,
    );
  }
}

class FallbackHandle implements ITerminalHandle {
  readonly id: string = randomUUID();
  readonly host: TerminalHostKind = 'fallback-child-process';
  readonly createdAt = Date.now();
  readonly pid: number | null;
  private readonly bus = new EventEmitter();
  private _cols: number;
  private _rows: number;
  private _exitCode: number | null = null;
  private _exitSignal: string | undefined = undefined;
  private disposed = false;

  constructor(
    readonly workspaceId: string,
    readonly shell: string,
    readonly cwd: string,
    cols: number,
    rows: number,
    private readonly child: ChildProcessWithoutNullStreams,
    banner: string,
    private readonly logger: ILogger,
  ) {
    this._cols = cols;
    this._rows = rows;
    this.pid = child.pid ?? null;

    child.stdout.on('data', (b) => {
      if (this.disposed) return;
      this.bus.emit('data', b as Buffer);
    });
    child.stderr.on('data', (b) => {
      if (this.disposed) return;
      this.bus.emit('data', b as Buffer);
    });
    child.on('exit', (code, signal) => {
      this._exitCode = code ?? 1;
      this._exitSignal = signal ?? undefined;
      this.bus.emit('exit', { code: this._exitCode, ...(signal ? { signal } : {}) });
      this.disposed = true;
    });
    child.on('error', (err) => {
      this.logger.warn?.(`[FallbackHandle] child error: ${err.message}`);
    });

    // Emit the banner asynchronously so subscribers have a chance to attach.
    setImmediate(() => this.bus.emit('data', Buffer.from(banner, 'utf8')));
  }

  get cols(): number { return this._cols; }
  get rows(): number { return this._rows; }
  get exitCode(): number | null { return this._exitCode; }
  get exitSignal(): string | undefined { return this._exitSignal; }

  write(data: string | Buffer): void {
    if (this.disposed) return;
    try {
      this.child.stdin.write(data);
    } catch { /* ignore */ }
  }
  resize(cols: number, rows: number): void {
    // No PTY, no resize semantics. Track for descriptor consistency.
    this._cols = cols;
    this._rows = rows;
  }
  signal(name: string): void {
    if (this.disposed) return;
    try {
      this.child.kill(name as NodeJS.Signals);
    } catch (err) {
      this.logger.warn?.(`[FallbackHandle] signal ${name} failed: ${(err as Error).message}`);
    }
  }
  kill(signal?: string): void {
    if (this.disposed) return;
    try { this.child.kill((signal as NodeJS.Signals | undefined) ?? 'SIGTERM'); } catch { /* ignore */ }
  }
  pause(): void { try { this.child.stdout.pause(); this.child.stderr.pause(); } catch { /* ignore */ } }
  resume(): void { try { this.child.stdout.resume(); this.child.stderr.resume(); } catch { /* ignore */ } }
  onData(cb: (chunk: Buffer) => void): () => void {
    this.bus.on('data', cb);
    return () => this.bus.off('data', cb);
  }
  onExit(cb: (info: { code: number; signal?: string }) => void): () => void {
    this.bus.on('exit', cb);
    return () => this.bus.off('exit', cb);
  }
}
