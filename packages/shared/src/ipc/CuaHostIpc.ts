/**
 * W17 — IPC protocol between gateway and cua-host process.
 *
 * The computer-use driver lives in cua-host, never in the gateway (L5).
 * The descriptor file model: cua-host writes `cua-connection.json` (atomic
 * tmp+rename, mode 0600) so the gateway can locate the driver without IPC.
 */

import type { HostHelloFrame } from '../protocol/hostProtocol.js';

// ─── Shared payload types ───────────────────────────────────────────────────

/**
 * Mirror of the ComputerAction union from shared/types/ComputerUse.
 *
 * ⚠ BLOCKING DESIGN DEFECT — this host must not be wired until it is fixed.
 *
 * There is no app or window identity anywhere in this type. Every field below
 * addresses the SCREEN (a coordinate, a keystroke), so `CuaDriverConnection`
 * has to resolve a `{pid, window_id}` scope for the driver by asking which app
 * happens to be frontmost *at the moment the action runs*. Consent, though, was
 * given earlier and for a named application.
 *
 * `IComputerBridge`'s own header states the hazard in one line: "the user
 * approves Safari and the click lands in 1Password." Anything that changes
 * focus between the approval and the action — a notification stealing focus,
 * an installer window, the user alt-tabbing, a slow settle after the previous
 * action — turns an approved click into an unapproved one, with an audit
 * record naming the app the user approved rather than the one that was hit.
 *
 * This is a protocol design defect, not a scope decision: `ComputerService`'s
 * in-process path resolves the target identity and re-checks the blocklist
 * against the RESOLVED identity, and nothing in this protocol can carry that.
 * Wiring cua-host into `ComputerService` as it stands would be a security
 * regression, not an incomplete migration.
 *
 * The fix is to carry the approved target end-to-end — the resolved
 * `{pid, windowId, appName}` on every request, verified by the host against
 * the live frontmost window and REFUSED (not silently retargeted) when they
 * disagree — and only then wire it.
 */
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
  /** Plan item 43 — always the FIRST frame the host sends; see protocol/hostProtocol.ts. */
  | HostHelloFrame
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
