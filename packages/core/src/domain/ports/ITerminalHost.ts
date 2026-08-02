// ────────────────────────────────────────────────────────────────
// ITerminalHost — Port interface for spawning + driving PTYs.
//
// Implementations:
//   • NodePtyHost              — default; requires `node-pty` native module
//   • FallbackChildProcessHost — no PTY; used when node-pty fails to load
//   • SandboxPtyHost           — Phase 2; `docker exec -it` into a run sandbox
//
// Consumers:
//   • TerminalService (packages/core/src/services/TerminalService.ts)
// ────────────────────────────────────────────────────────────────

import type { TerminalHostKind } from '@generatorai/shared';

export interface TerminalSpawnOptions {
  workspaceId: string;
  /** Absolute cwd — computed by TerminalService, never user-supplied. */
  cwd: string;
  cols: number;
  rows: number;
  /** Sanitised env override. Merges over the host-computed base env. */
  env?: Record<string, string>;
  /** Optional shell override; else host-picked platform default. */
  shell?: string;
  /** Optional args. Host may inject platform-specific defaults (e.g. `-NoProfile`). */
  shellArgs?: string[];
  /**
   * Phase-2 hint: caller wants a sandbox-attached PTY. Non-sandbox hosts
   * SHOULD ignore this. `SandboxPtyHost.spawn` rejects when there is no
   * active sandbox for the caller's run.
   */
  attachToSandbox?: boolean;
  /**
   * Optional run id used by `SandboxPtyHost` to look up the docker
   * sandbox container. Ignored by other hosts.
   */
  runId?: string;
}

/**
 * A single running terminal. Lifetime is owned by TerminalService — hosts
 * MUST NOT hold internal references beyond the returned handle.
 */
export interface ITerminalHandle {
  readonly id: string;
  readonly workspaceId: string;
  readonly host: TerminalHostKind;
  readonly pid: number | null;
  readonly cwd: string;
  readonly shell: string;
  readonly cols: number;
  readonly rows: number;
  readonly exitCode: number | null;
  readonly exitSignal: string | undefined;
  readonly createdAt: number;

  /** Feed user input straight into the PTY. */
  write(data: string | Buffer): void;
  /** Notify the PTY of a new terminal window size. */
  resize(cols: number, rows: number): void;
  /** Deliver a POSIX signal to the child. Best-effort on Windows. */
  signal(name: string): void;
  /** Force-terminate the process. */
  kill(signal?: string): void;
  /** OS-level flow-control pause (XOFF). */
  pause(): void;
  /** OS-level flow-control resume (XON). */
  resume(): void;

  /** Subscribe to raw PTY output. Returns unsubscribe. */
  onData(cb: (chunk: Buffer) => void): () => void;
  /** Subscribe to PTY exit. Returns unsubscribe. */
  onExit(cb: (info: { code: number; signal?: string }) => void): () => void;
}

export interface ITerminalHost {
  readonly kind: TerminalHostKind;
  /** True when the host can actually spawn on the current platform. */
  isAvailable(): boolean;
  spawn(opts: TerminalSpawnOptions): Promise<ITerminalHandle>;
}
