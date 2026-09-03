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
  /**
   * W12 — per-session monotonic sequence number, assigned by the host's
   * `SessionQueue` at enqueue time and never reused. The gateway uses it to
   * detect loss: a jump means the host's bounded queue overflowed.
   *
   * Optional on the wire so a message produced by an older host still decodes;
   * the gateway treats `undefined` as "this host does not sequence" and skips
   * the gap check rather than reporting a false gap on every event.
   */
  seq?: number;
  /**
   * W12 — how many events for this session were dropped immediately before
   * this one because the per-session queue was at capacity. Present (and > 0)
   * only on the first event delivered after an overflow.
   *
   * This is the gap marker. It is carried as transport metadata rather than a
   * synthetic `AgentEvent` because a dropped-events notice is a property of the
   * IPC channel, not something a provider ever emitted — inventing a
   * `harness.gap` event kind would put a transport concern into the domain
   * event union that every consumer switches over.
   */
  droppedBefore?: number;
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

/**
 * The exhaustive discriminator sets. Declared as `Set<AgentHostRequest['type']>`
 * so adding a member to either union without listing it here is a compile error
 * — the guards below are the only thing standing between the IPC channel and
 * `handleRequest`'s `default:` branch.
 */
const REQUEST_TYPES: ReadonlySet<AgentHostRequest['type']> = new Set([
  'spawn_session',
  'send_turn',
  'abort_session',
  'delete_session',
  'get_stats',
  'ping',
] satisfies AgentHostRequest['type'][]);

const RESPONSE_TYPES: ReadonlySet<AgentHostResponse['type']> = new Set([
  'ack',
  'error',
  'agent_event',
  'session_ended',
  'stats',
  'pong',
] satisfies AgentHostResponse['type'][]);

/**
 * Type-guard for any AgentHostRequest.
 *
 * △ These used to accept ANY object with a string `type`, which made them
 * assertions rather than guards: an unrelated message (or a response echoed
 * onto the wrong channel) passed the check and fell through to the `default:`
 * branch, so the "unrecognised IPC message" warning was unreachable and the
 * mismatch surfaced later as a missing `reqId` instead.
 */
export function isAgentHostRequest(msg: unknown): msg is AgentHostRequest {
  if (typeof msg !== 'object' || msg === null) return false;
  const type = (msg as Record<string, unknown>)['type'];
  if (typeof type !== 'string' || !REQUEST_TYPES.has(type as AgentHostRequest['type'])) return false;
  // Every request carries a correlation id; without one the host cannot reply.
  return typeof (msg as Record<string, unknown>)['reqId'] === 'string';
}

/** Type-guard for any AgentHostResponse. */
export function isAgentHostResponse(msg: unknown): msg is AgentHostResponse {
  if (typeof msg !== 'object' || msg === null) return false;
  const type = (msg as Record<string, unknown>)['type'];
  if (typeof type !== 'string' || !RESPONSE_TYPES.has(type as AgentHostResponse['type'])) return false;
  // Notifications are keyed by sessionId; everything else by reqId.
  const record = msg as Record<string, unknown>;
  if (type === 'agent_event' || type === 'session_ended') {
    return typeof record['sessionId'] === 'string';
  }
  return typeof record['reqId'] === 'string';
}
