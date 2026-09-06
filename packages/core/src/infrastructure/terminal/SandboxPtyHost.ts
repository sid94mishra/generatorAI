// ────────────────────────────────────────────────────────────────
// SandboxPtyHost — Phase-2 opt-in host that attaches a PTY to a running
// workflow-run sandbox container. Implementation uses `docker exec -it
// <sandboxName> /bin/sh -l` wrapped inside a host-side `node-pty` so we
// get real PTY semantics without adding a new sandbox-provider surface.
//
// Availability requires:
//   • node-pty loadable on the host (delegates to NodePtyHost)
//   • `docker` on PATH
//   • a `SandboxLifecycleManager.getSession(runId)` match
//
// Callers request this host via `TerminalSpawnOptions.attachToSandbox` +
// `runId`. The composition root places this host BEFORE `NodePtyHost` in
// the chain; `canServe()` — not `isAvailable()`, which cannot see the spawn
// options — is what keeps the default path on the ordinary hosts.
// ────────────────────────────────────────────────────────────────

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ILogger, TerminalHostKind } from '@generatorai/shared';
import type {
  ITerminalHandle,
  ITerminalHost,
  TerminalSpawnOptions,
} from '../../domain/ports/ITerminalHost.js';
import type { ISandboxSessionLookup } from '../../domain/ports/ISandboxProvider.js';
import { NodePtyHost } from './NodePtyHost.js';

const execFileAsync = promisify(execFile);

export class SandboxPtyHost implements ITerminalHost {
  readonly kind: TerminalHostKind = 'sandbox';
  private readonly inner: NodePtyHost;
  private dockerOnPath: boolean | null = null;
  private readonly dockerProbe: Promise<void>;

  constructor(
    private readonly logger: ILogger,
    // The port, not the concrete `SandboxLifecycleManager`: infrastructure
    // must not import the application layer (boundary lint, plan item 30).
    private readonly sandboxes: ISandboxSessionLookup,
  ) {
    // Delegates the PTY plumbing to node-pty — env sanitisation logic reused.
    this.inner = new NodePtyHost(logger);
    this.dockerProbe = this.probeDocker();
  }

  /**
   * The `which docker` probe used to be `execFileSync`, run lazily from
   * `isAvailable()` — which sits on the terminal SPAWN path, so the first
   * terminal after boot blocked the event loop on a process spawn while every
   * other request waited. It is async now, kicked off at construction and
   * awaited through `whenReady()`; `TerminalService` already awaits that
   * before falling through to the next host, so nothing observes a difference
   * except the blocked loop.
   */
  private async probeDocker(): Promise<void> {
    try {
      await execFileAsync(process.platform === 'win32' ? 'where' : 'which', ['docker']);
      this.dockerOnPath = true;
    } catch {
      this.dockerOnPath = false;
    }
  }

  async whenReady(): Promise<void> {
    await this.dockerProbe;
  }

  isAvailable(): boolean {
    if (!this.inner.isAvailable()) return false;
    // `null` = the probe has not finished. Reporting unavailable is the safe
    // answer: `whenReady()` is what a caller uses to wait for the real one.
    return this.dockerOnPath === true;
  }

  /**
   * The file header above always claimed "`isAvailable()` returns `false`
   * unless attach is asked for", but it never could: `isAvailable()` takes no
   * arguments, so it cannot see `attachToSandbox`. On any machine with docker
   * on PATH this host therefore won first-available selection for EVERY
   * terminal and then threw from `spawn()` on the first line. `canServe()` is
   * the gate the comment was describing.
   */
  canServe(options: TerminalSpawnOptions): boolean {
    return options.attachToSandbox === true && typeof options.runId === 'string' && options.runId.length > 0;
  }

  async spawn(options: TerminalSpawnOptions): Promise<ITerminalHandle> {
    if (!options.attachToSandbox) {
      throw new Error('[SandboxPtyHost] Must be called with attachToSandbox=true');
    }
    if (!options.runId) {
      throw new Error('[SandboxPtyHost] Requires runId to locate the sandbox');
    }
    const session = this.sandboxes.getSession(options.runId);
    if (!session) {
      throw new Error(
        `[SandboxPtyHost] No active sandbox for run ${options.runId} — start the run first or use the host terminal`,
      );
    }

    // We spawn `docker exec -it <sandbox> /bin/sh -l`. The `-t` flag hands
    // the container a PTY, and node-pty on the host end preserves the
    // outer PTY so xterm.js sees the container's shell colours/cursor.
    const dockerArgs = [
      'exec',
      '-it',
      session.sandboxName,
      // Prefer bash if the image has it, fall back to /bin/sh which every
      // image with genai bootstrap has.
      '/bin/sh',
      '-lc',
      'exec bash -l 2>/dev/null || exec sh -l',
    ];

    // Delegate: run docker on the host, node-pty gives us the outer PTY.
    // `cwd` is the host cwd for the docker process — irrelevant inside the
    // container (WORKDIR is used there), but we pass the workspace root
    // for consistency.
    const handle = await this.inner.spawn({
      ...options,
      shell: 'docker',
      shellArgs: dockerArgs,
    });

    // Rebrand the host kind so the SPA renders a "Sandbox attached" tint.
    return new SandboxHandleFacade(handle, session.sandboxName);
  }
}

/**
 * Thin decorator over the underlying node-pty handle that just overrides
 * `host` and augments `cwd`/`shell` for descriptor accuracy.
 */
class SandboxHandleFacade implements ITerminalHandle {
  readonly host: TerminalHostKind = 'sandbox';
  constructor(private readonly inner: ITerminalHandle, readonly sandboxName: string) {}

  get id(): string { return this.inner.id; }
  get workspaceId(): string { return this.inner.workspaceId; }
  get pid(): number | null { return this.inner.pid; }
  get cwd(): string { return `docker://${this.sandboxName}`; }
  get shell(): string { return `docker exec ${this.sandboxName}`; }
  get cols(): number { return this.inner.cols; }
  get rows(): number { return this.inner.rows; }
  get exitCode(): number | null { return this.inner.exitCode; }
  get exitSignal(): string | undefined { return this.inner.exitSignal; }
  get createdAt(): number { return this.inner.createdAt; }

  write(data: string | Buffer): void { this.inner.write(data); }
  resize(cols: number, rows: number): void { this.inner.resize(cols, rows); }
  signal(name: string): void { this.inner.signal(name); }
  kill(signal?: string): void { this.inner.kill(signal); }
  pause(): void { this.inner.pause(); }
  resume(): void { this.inner.resume(); }
  onData(cb: (chunk: Buffer) => void): () => void { return this.inner.onData(cb); }
  onExit(cb: (info: { code: number; signal?: string }) => void): () => void { return this.inner.onExit(cb); }
}
