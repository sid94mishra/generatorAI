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

/** Credit acknowledgement — gateway notifies host that N chars were consumed. */
export interface PtyAckRequest {
  type: 'ack';
  reqId: string;
  sessionId: string;
  bytesConsumed: number;
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
  | PtyAckRequest
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
