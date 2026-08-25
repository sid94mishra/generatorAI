/**
 * W17 — IPC protocol between gateway and cua-host process.
 *
 * The computer-use driver lives in cua-host, never in the gateway (L5).
 * The descriptor file model: cua-host writes `cua-connection.json` (atomic
 * tmp+rename, mode 0600) so the gateway can locate the driver without IPC.
 */

// ─── Shared payload types ───────────────────────────────────────────────────

/** Mirror of the ComputerAction union from shared/types/ComputerUse. */
export interface ComputerAction {
  type: string;
  // Common optional fields
  coordinate?: [number, number];
  text?: string;
  button?: string;
  direction?: string;
  amount?: number;
  key?: string;
  keys?: string[];
  start_coordinate?: [number, number];
  path?: Array<[number, number]>;
}

// ─── Requests (gateway → cua-host) ─────────────────────────────────────────

export interface CuaPerformActionRequest {
  type: 'perform_action';
  reqId: string;
  actionId: string;
  action: ComputerAction;
  /** When true, the host returns a screenshot after the action settles. */
  captureAfter: boolean;
}

export interface CuaCaptureRequest {
  type: 'capture';
  reqId: string;
  captureId: string;
}

export interface CuaGetStateRequest {
  type: 'get_state';
  reqId: string;
}

export interface CuaPingRequest {
  type: 'ping';
  reqId: string;
}

export type CuaHostRequest =
  | CuaPerformActionRequest
  | CuaCaptureRequest
  | CuaGetStateRequest
  | CuaPingRequest;

// ─── Responses (cua-host → gateway) ─────────────────────────────────────────

export interface CuaActionResultResponse {
  type: 'action_result';
  reqId: string;
  actionId: string;
  success: boolean;
  /** Base-64 encoded JPEG/PNG when captureAfter=true and success=true. */
  screenshot?: string;
  error?: string;
}

export interface CuaCaptureResultResponse {
  type: 'capture_result';
  reqId: string;
  captureId: string;
  /** Base-64 encoded JPEG/PNG. */
  screenshot: string;
}

export interface CuaStateResponse {
  type: 'state';
  reqId: string;
  connected: boolean;
  descriptorPath: string;
}

export interface CuaRequestError {
  type: 'error';
  reqId: string;
  ok: false;
  message: string;
}

export interface CuaPongResponse {
  type: 'pong';
  reqId: string;
}

export type CuaHostResponse =
  | CuaActionResultResponse
  | CuaCaptureResultResponse
  | CuaStateResponse
  | CuaRequestError
  | CuaPongResponse;

// ─── Descriptor file written by cua-host on startup ─────────────────────────

export interface CuaConnectionDescriptor {
  /** Absolute path to the descriptor file itself (for gateway validation). */
  descriptorPath: string;
  /** PID of the cua-host process. */
  pid: number;
  /** ISO timestamp of when the host started. */
  startedAt: string;
  /** Version of the descriptor format. */
  version: 1;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

export function isCuaHostRequest(msg: unknown): msg is CuaHostRequest {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    typeof (msg as Record<string, unknown>)['type'] === 'string'
  );
}

export function isCuaHostResponse(msg: unknown): msg is CuaHostResponse {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    typeof (msg as Record<string, unknown>)['type'] === 'string'
  );
}
