/**
 * W14 — IPC protocol between gateway and pty-host process.
 *
 * PTY sessions never live in the control-plane process (L5).
 * All messages are JSON-serializable for Node.js IPC transport.
 */

// ─── Requests (gateway → pty-host) ─────────────────────────────────────────

export interface PtyCreateSessionRequest {
  type: 'create_session';
  reqId: string;
  sessionId: string;
  cols: number;
  rows: number;
  cwd: string;
  env?: Record<string, string>;
  /** Shell binary override; host picks a platform default (`powershell.exe` / `$SHELL`) when omitted. */
  shell?: string;
  /** Extra shell args. On Windows PowerShell/pwsh, the host also injects `-NoLogo -NoProfile` unless already present — same fast-start behavior as the in-process `NodePtyHost`. */
  shellArgs?: string[];
}

export interface PtyWriteRequest {
  type: 'write';
  reqId: string;
  sessionId: string;
  data: string;
}

export interface PtyResizeRequest {
  type: 'resize';
  reqId: string;
  sessionId: string;
  cols: number;
  rows: number;
}

export interface PtyDestroyRequest {
  type: 'destroy';
  reqId: string;
  sessionId: string;
}

/** Deliver a POSIX signal to the PTY's child process (best-effort on Windows — see `ITerminalHandle.signal`). */
export interface PtySignalRequest {
  type: 'signal';
  reqId: string;
  sessionId: string;
  signal: string;
}

/** OS-level flow-control pause — stop reading from the PTY, backpressuring the child. */
export interface PtyPauseRequest {
  type: 'pause';
  reqId: string;
  sessionId: string;
}

/** Resume reading from a paused PTY. */
export interface PtyResumeRequest {
  type: 'resume';
  reqId: string;
  sessionId: string;
}

/** Credit acknowledgement — gateway notifies host that N chars were consumed. */
export interface PtyAckRequest {
  type: 'ack';
  reqId: string;
  sessionId: string;
  bytesConsumed: number;
}

/**
 * Read the session's rendered scrollback out of the host's headless VT model
 * (W14). The gateway keeps raw bytes for byte-exact replay; this returns the
 * *parsed* view — bounded at O(lines × columns) no matter how much output the
 * command produced — for tail replay and cross-restart revive.
 */
export interface PtyScrollbackRequest {
  type: 'scrollback';
  reqId: string;
  sessionId: string;
  /** Most-recent N lines. `0`/omitted returns everything the model retains. */
  tailLines?: number;
}

export interface PtyPingRequest {
  type: 'ping';
  reqId: string;
}

export type PtyHostRequest =
  | PtyCreateSessionRequest
  | PtyWriteRequest
  | PtyResizeRequest
  | PtyDestroyRequest
  | PtySignalRequest
  | PtyPauseRequest
  | PtyResumeRequest
  | PtyAckRequest
  | PtyScrollbackRequest
  | PtyPingRequest;

// ─── Responses / notifications (pty-host → gateway) ─────────────────────────

export interface PtySessionReadyNotification {
  type: 'session_ready';
  sessionId: string;
  pid: number;
}

/** Streamed data chunk — no reqId. */
export interface PtyDataNotification {
  type: 'data';
  sessionId: string;
  chunk: string;
}

/** PTY process exited. */
export interface PtyExitNotification {
  type: 'exit';
  sessionId: string;
  code: number | null;
}

export interface PtyRequestAck {
  type: 'ack';
  reqId: string;
  ok: true;
}

export interface PtyRequestError {
  type: 'error';
  reqId: string;
  ok: false;
  message: string;
  sessionId?: string;
}

export interface PtyScrollbackResponse {
  type: 'scrollback';
  reqId: string;
  ok: true;
  sessionId: string;
  /** Rendered lines, oldest first. */
  lines: string[];
  /** False when the host fell back to the degraded line ring (see `HeadlessTerminalModel`). */
  vt: boolean;
}

export interface PtyPongResponse {
  type: 'pong';
  reqId: string;
}

export type PtyHostResponse =
  | PtySessionReadyNotification
  | PtyDataNotification
  | PtyExitNotification
  | PtyRequestAck
  | PtyRequestError
  | PtyScrollbackResponse
  | PtyPongResponse;

// ─── Helpers ───────────────────────────────────────────────────────────────

export function isPtyHostRequest(msg: unknown): msg is PtyHostRequest {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    typeof (msg as Record<string, unknown>)['type'] === 'string'
  );
}

export function isPtyHostResponse(msg: unknown): msg is PtyHostResponse {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    typeof (msg as Record<string, unknown>)['type'] === 'string'
  );
}
