// ────────────────────────────────────────────────────────────────
// Terminal — Integrated Terminal value objects (pure TS)
//
// A terminal session is a *resource* attached to an ExecutionWorkspace,
// exposed to the SPA over WebSocket and REST. Ephemeral by design — the
// server holds an in-memory `Map<sid, handle>`; server restart clears them.
//
// Consumed by:
//   • packages/core/src/services/TerminalService
//   • apps/server/src/routes/terminals + apps/server/src/terminal-ws
//   • apps/web/src/components/terminal/TerminalPanel
//
// Zero external imports — this file lives in @generatorai/shared.
// ────────────────────────────────────────────────────────────────

/**
 * Public descriptor returned by the REST API and embedded in
 * `terminal.session_*` events.
 */
export interface TerminalSessionDescriptor {
  /** Server-generated session id (uuid). */
  id: string;
  /** Owning workspace. */
  workspaceId: string;
  /** OS process id — null when running on the fallback child-process host. */
  pid: number | null;
  /** Absolute working directory. */
  cwd: string;
  /** Current terminal dimensions. */
  cols: number;
  rows: number;
  /**
   * Host implementation that spawned this PTY. Reported to the SPA so the
   * header can render a fallback banner or a sandbox-attached tint.
   */
  host: TerminalHostKind;
  /** Resolved shell command (e.g. `pwsh.exe`, `/bin/bash`). */
  shell: string;
  /** Non-null once the PTY has exited. */
  exitCode: number | null;
  /** Exit signal name (POSIX) when the PTY was killed by signal. */
  exitSignal?: string;
  /** ms since epoch — created timestamp. */
  createdAt: number;
  /** ms since epoch — last observed activity (any input/output/resize/ack). */
  lastActivityAt: number;
}

/** Which infrastructure adapter spawned this terminal. */
export type TerminalHostKind =
  | 'node-pty'
  | 'fallback-child-process'
  /** Phase 2 — sandbox-attached terminal (docker exec -it). */
  | 'sandbox'
  /** Out-of-process PTY host — see `packages/core/src/services/PtyHostAdapter.ts`. */
  | 'pty-host';

/**
 * Body of `POST /api/workspaces/:id/terminals`.
 *
 * `cwd` is intentionally NOT part of this shape — the server resolves it
 * from `workspace.rootPath` to avoid a path-traversal escape hatch.
 */
export interface CreateTerminalRequest {
  cols?: number;
  rows?: number;
  /**
   * Optional shell override (advanced users / power-tests). When omitted,
   * the host picks a platform default (POSIX: `$SHELL ?? /bin/bash`;
   * Windows: pwsh 7 → powershell → cmd).
   */
  shell?: string;
  /**
   * Phase 2 — request a sandbox-attached terminal. Only honoured when the
   * workspace has an active sandbox for the caller's run. Ignored in MVP.
   */
  attachToSandbox?: boolean;
}

/**
 * Client → server WS control frame (JSON). Binary frames are strictly
 * output only. Rate-limited to ~200 msgs/sec/WS.
 */
export type TerminalInputFrame =
  | { t: 'input'; data: string }
  | { t: 'resize'; cols: number; rows: number }
  /** Client-side "I've written N bytes into xterm" flow-control ACK. */
  | { t: 'ack'; bytes: number }
  /** POSIX signal name (e.g. `SIGINT`). Best-effort on Windows. */
  | { t: 'signal'; name: string }
  /**
   * Explicit "kill this session" — used by the SPA on tab close so that
   * even if the concurrent DELETE fetch aborts under Vite/HMR, the PTY
   * still exits promptly (no 30-min idle wait).
   */
  | { t: 'kill' };

/**
 * Server → client WS JSON control frame. Binary WS frames are raw PTY
 * bytes and MUST be fed straight into `xterm.write(bytes, ackCallback)`.
 */
export type TerminalOutputFrame =
  | { t: 'exit'; code: number; signal?: string }
  | { t: 'resized'; cols: number; rows: number }
  | { t: 'ready'; descriptor: TerminalSessionDescriptor }
  | { t: 'error'; message: string };
