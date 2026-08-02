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
// the chain, but `isAvailable()` returns `false` unless attach is asked
// for — so the default path is unaffected.
// ────────────────────────────────────────────────────────────────

import { execFileSync } from 'node:child_process';
import type { ILogger, TerminalHostKind } from '@generatorai/shared';
import type {
  ITerminalHandle,
  ITerminalHost,
  TerminalSpawnOptions,
} from '../../domain/ports/ITerminalHost.js';
import type { SandboxLifecycleManager } from '../../services/SandboxLifecycleManager.js';
import { NodePtyHost } from './NodePtyHost.js';

export class SandboxPtyHost implements ITerminalHost {
  readonly kind: TerminalHostKind = 'sandbox';
  private readonly inner: NodePtyHost;
  private dockerOnPath: boolean | null = null;

  constructor(
    private readonly logger: ILogger,
    private readonly sandboxes: SandboxLifecycleManager,
  ) {
    // Delegates the PTY plumbing to node-pty — env sanitisation logic reused.
    this.inner = new NodePtyHost(logger);
  }

  isAvailable(): boolean {
    if (!this.inner.isAvailable()) return false;
    if (this.dockerOnPath === null) {
      try {
        execFileSync(process.platform === 'win32' ? 'where' : 'which', ['docker'], {
          stdio: 'ignore',
        });
        this.dockerOnPath = true;
      } catch {
        this.dockerOnPath = false;
      }
    }
    return this.dockerOnPath;
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
