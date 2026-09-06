/**
 * W15 — IPC protocol between gateway and browser-host process.
 *
 * The single Chromium instance lives in browser-host, never in the gateway (L5).
 * All messages are JSON-serializable for Node.js IPC transport.
 *
 * BrowserHostConfig / BrowserHostAction are the IPC wire types.
 * They are distinct from the domain BrowserConfig / BrowserAction in types/
 * to avoid naming collisions.
 */

import type { HostHelloFrame } from '../protocol/hostProtocol.js';

// ─── Shared payload types ───────────────────────────────────────────────────

/** IPC-level browser context configuration (sent across the wire to browser-host). */
export interface BrowserHostConfig {
  /** Viewport width, default 1280. */
  width?: number;
  /** Viewport height, default 720. */
  height?: number;
  /** User agent override. */
  userAgent?: string;
  /** Extra HTTP headers applied to every request in the context. */
  extraHTTPHeaders?: Record<string, string>;
}

/** IPC-level browser action payload (sent across the wire to browser-host). */
export interface BrowserHostAction {
  action: string;
  // Selector-based actions
  selector?: string;
  // Coordinate-based actions
  x?: number;
  y?: number;
  // Text input
  text?: string;
  // Key sequence
  key?: string;
  // Scroll direction + amount
  direction?: string;
  amount?: number;
  // Extra options
  options?: Record<string, unknown>;
}

// ─── Requests (gateway → browser-host) ─────────────────────────────────────

export interface BrowserCreateContextRequest {
  type: 'create_context';
  reqId: string;
  contextId: string;
  config?: BrowserHostConfig;
}

export interface BrowserNavigateRequest {
  type: 'navigate';
  reqId: string;
  contextId: string;
  url: string;
}

export interface BrowserSnapshotRequest {
  type: 'snapshot';
  reqId: string;
  contextId: string;
  mode: 'accessibility' | 'screenshot';
}

export interface BrowserActionRequest {
  type: 'action';
  reqId: string;
  contextId: string;
  action: BrowserHostAction;
}

export interface BrowserStartScreencastRequest {
  type: 'start_screencast';
  reqId: string;
  contextId: string;
  /** Target frames per second, default 5. */
  fps?: number;
}

export interface BrowserStopScreencastRequest {
  type: 'stop_screencast';
  reqId: string;
  contextId: string;
}

export interface BrowserDestroyContextRequest {
  type: 'destroy_context';
  reqId: string;
  contextId: string;
}

export interface BrowserPingRequest {
  type: 'ping';
  reqId: string;
}

export type BrowserHostRequest =
  | BrowserCreateContextRequest
  | BrowserNavigateRequest
  | BrowserSnapshotRequest
  | BrowserActionRequest
  | BrowserStartScreencastRequest
  | BrowserStopScreencastRequest
  | BrowserDestroyContextRequest
  | BrowserPingRequest;

// ─── Responses / notifications (browser-host → gateway) ─────────────────────

export interface BrowserContextReadyNotification {
  type: 'context_ready';
  contextId: string;
}

export interface BrowserSnapshotResultNotification {
  type: 'snapshot_result';
  contextId: string;
  reqId: string;
  data: string;
  format: 'json' | 'jpeg';
}

export interface BrowserActionResultNotification {
  type: 'action_result';
  contextId: string;
  reqId: string;
  success: boolean;
  error?: string;
}

/** Screencast frame — fire-and-forget, no reqId. Latest frame wins. */
export interface BrowserFrameNotification {
  type: 'frame';
  contextId: string;
  data: string;
  format: 'jpeg' | 'webp';
}

export interface BrowserContextDestroyedNotification {
  type: 'context_destroyed';
  contextId: string;
}

export interface BrowserRequestAck {
  type: 'ack';
  reqId: string;
  ok: true;
}

export interface BrowserRequestError {
  type: 'error';
  reqId: string;
  ok: false;
  message: string;
  contextId?: string;
}

export interface BrowserPongResponse {
  type: 'pong';
  reqId: string;
}

export type BrowserHostResponse =
  /** Plan item 43 — always the FIRST frame the host sends; see protocol/hostProtocol.ts. */
  | HostHelloFrame
  | BrowserContextReadyNotification
  | BrowserSnapshotResultNotification
  | BrowserActionResultNotification
  | BrowserFrameNotification
  | BrowserContextDestroyedNotification
  | BrowserRequestAck
  | BrowserRequestError
  | BrowserPongResponse;

// ─── Helpers ───────────────────────────────────────────────────────────────

export function isBrowserHostRequest(msg: unknown): msg is BrowserHostRequest {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    typeof (msg as Record<string, unknown>)['type'] === 'string'
  );
}

export function isBrowserHostResponse(msg: unknown): msg is BrowserHostResponse {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    typeof (msg as Record<string, unknown>)['type'] === 'string'
  );
}
