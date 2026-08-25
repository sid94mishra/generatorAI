/**
 * W12 — IPC protocol between gateway and agent-host process.
 *
 * All messages are JSON-serializable so they can travel over Node.js
 * child_process IPC (process.send / process.on('message')).
 *
 * Design rules:
 *  - Every request carries a `reqId` so responses can be correlated.
 *  - `agent_event` notifications are fire-and-forget (no reqId correlation).
 *  - The gateway never holds provider handles; the host never holds HTTP state.
 */

import type { AgentEvent } from '../types/index.js';

/**
 * Serialized conversation parameters for IPC transport.
 * `CreateConversationParams` lives in packages/core (Layer 2) and cannot be
 * imported here (Layer 1). We carry it as an opaque record across the wire.
 * The host reconstructs the typed form on receipt.
 */
export type SerializedConversationParams = Record<string, unknown>;

// ─── Requests (gateway → host) ─────────────────────────────────────────────

export interface SpawnSessionRequest {
  type: 'spawn_session';
  /** Correlation id — host echoes it back in the response. */
  reqId: string;
  sessionId: string;
  params: SerializedConversationParams;
}

export interface SendTurnRequest {
  type: 'send_turn';
  reqId: string;
  sessionId: string;
  prompt: string;
  attachments?: Array<{ type: string; id: string }>;
}

export interface AbortSessionRequest {
  type: 'abort_session';
  reqId: string;
  sessionId: string;
}

export interface DeleteSessionRequest {
  type: 'delete_session';
  reqId: string;
  sessionId: string;
}

export interface GetStatsRequest {
  type: 'get_stats';
  reqId: string;
}

export interface PingRequest {
  type: 'ping';
  reqId: string;
}

export type AgentHostRequest =
  | SpawnSessionRequest
  | SendTurnRequest
  | AbortSessionRequest
  | DeleteSessionRequest
  | GetStatsRequest
  | PingRequest;

// ─── Responses (host → gateway) ────────────────────────────────────────────

/** Correlates with a request by reqId. */
export interface RequestAck {
  type: 'ack';
  reqId: string;
  ok: true;
}

export interface RequestError {
  type: 'error';
  reqId: string;
  ok: false;
  message: string;
  code?: string;
}

/** Streamed — no reqId, keyed by sessionId. */
export interface AgentEventNotification {
  type: 'agent_event';
  sessionId: string;
  event: AgentEvent;
}

/** Session reached a terminal state. */
export interface SessionEndedNotification {
  type: 'session_ended';
  sessionId: string;
  reason: 'complete' | 'error' | 'cancelled';
  error?: string;
}

export interface HostStats {
  type: 'stats';
  reqId: string;
  activeSessions: number;
  rssBytes: number;
  uptimeMs: number;
  providerCount: number;
}

export interface PongResponse {
  type: 'pong';
  reqId: string;
}

export type AgentHostResponse =
  | RequestAck
  | RequestError
  | AgentEventNotification
  | SessionEndedNotification
  | HostStats
  | PongResponse;

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Type-guard for any AgentHostRequest. */
export function isAgentHostRequest(msg: unknown): msg is AgentHostRequest {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    typeof (msg as Record<string, unknown>)['type'] === 'string'
  );
}

/** Type-guard for any AgentHostResponse. */
export function isAgentHostResponse(msg: unknown): msg is AgentHostResponse {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    typeof (msg as Record<string, unknown>)['type'] === 'string'
  );
}
