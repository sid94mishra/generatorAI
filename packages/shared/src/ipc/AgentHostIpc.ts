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
import type { HostHelloFrame } from '../protocol/hostProtocol.js';
import { isHostHelloFrame } from '../protocol/hostProtocol.js';

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
  /**
   * The per-turn options (`SendPromptOptions`): the agent mode and the
   * permission mode the turn runs under. Dropping them made every turn over
   * the host run under the provider's construction-time default.
   * `admitted` (P07 WP-7.2, RV-26): the gateway already holds the turn's
   * `provider:<id>` flow key, so the host takes no permit of its own.
   */
  options?: { agentMode?: string; permissionMode?: string; admitted?: boolean };
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

/** Model catalog of the host's primary provider (`IAgentHarness.getModels`). */
export interface ListModelsRequest {
  type: 'list_models';
  reqId: string;
}
/** `IAgentHarness.selectAgent` for one session. */
export interface SelectAgentRequest {
  type: 'select_agent';
  reqId: string;
  sessionId: string;
  agentName: string;
}
/** `IAgentHarness.listAgents` for one session. */
export interface ListAgentsRequest {
  type: 'list_agents';
  reqId: string;
  sessionId: string;
}
/**
 * RV-26 — the gateway's answer to a `callback_invoke`: the value the host-side
 * stub resolves with, or the error it rejects with.
 */
export interface CallbackResultRequest {
  type: 'callback_result';
  reqId: string;
  callId: string;
  ok: boolean;
  value?: unknown;
  error?: string;
}

export type AgentHostRequest =
  | CallbackResultRequest
  | SpawnSessionRequest
  | SendTurnRequest
  | AbortSessionRequest
  | DeleteSessionRequest
  | GetStatsRequest
  | PingRequest
  | ListModelsRequest
  | SelectAgentRequest
  | ListAgentsRequest;

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

/**
 * RV-26 — the host calls a function that lives in the gateway: a host tool's
 * handler, a permission / question / plan-review gate, or a hook-bridge
 * member. Functions cannot cross IPC, so a spawn replaces each with a
 * `{ __hostCallback: id }` marker (`serializeHostCallbacks`) and the host
 * rebuilds it as a stub that sends this frame and awaits `callback_result`.
 * `args` are the call's JSON-serialisable arguments (tool input and any
 * per-call context the provider passes, such as the tool call id).
 */
export interface CallbackInvokeNotification {
  type: 'callback_invoke';
  sessionId: string;
  callId: string;
  callbackId: string;
  args: unknown[];
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

/**
 * Wire shape of a provider model. Structurally identical to the core port's
 * `HarnessModel`; declared here because `@generatorai/shared` cannot import
 * from core (layering rule).
 */
export interface HostModelInfo {
  id: string;
  name: string;
  provider?: string;
  description?: string;
  category?: string;
  promptTokenLimit?: number;
  supportsReasoning?: boolean;
  [key: string]: unknown;
}
export interface ModelsResponse {
  type: 'models';
  reqId: string;
  models: HostModelInfo[];
}
/** Wire shape of `HarnessAgentInfo`. */
export interface HostAgentInfo {
  name: string;
  description?: string;
  model?: string;
  source?: string;
}
export interface AgentsResponse {
  type: 'agents';
  reqId: string;
  agents: HostAgentInfo[];
}
export type AgentHostResponse =
  /** Plan item 43 — always the FIRST frame the host sends; see protocol/hostProtocol.ts. */
  | HostHelloFrame
  | RequestAck
  | RequestError
  | AgentEventNotification
  | SessionEndedNotification
  | CallbackInvokeNotification
  | HostStats
  | PongResponse
  | ModelsResponse
  | AgentsResponse;

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * The exhaustive discriminator sets. Declared as `Set<AgentHostRequest['type']>`
 * so adding a member to either union without listing it here is a compile error
 * — the guards below are the only thing standing between the IPC channel and
 * `handleRequest`'s `default:` branch.
 */
const REQUEST_TYPES: ReadonlySet<AgentHostRequest['type']> = new Set([
  'callback_result',
  'spawn_session',
  'send_turn',
  'abort_session',
  'delete_session',
  'get_stats',
  'ping',
  'list_models',
  'select_agent',
  'list_agents',
] satisfies AgentHostRequest['type'][]);

const RESPONSE_TYPES: ReadonlySet<AgentHostResponse['type']> = new Set([
  'hello',
  'ack',
  'error',
  'agent_event',
  'session_ended',
  'callback_invoke',
  'stats',
  'pong',
  'models',
  'agents',
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
  // The handshake frame carries neither; it has its own structural guard.
  if (type === 'hello') return isHostHelloFrame(msg);
  if (type === 'agent_event' || type === 'session_ended') {
    return typeof record['sessionId'] === 'string';
  }
  if (type === 'callback_invoke') {
    return (
      typeof record['sessionId'] === 'string' &&
      typeof record['callId'] === 'string' &&
      typeof record['callbackId'] === 'string' &&
      Array.isArray(record['args'])
    );
  }
  return typeof record['reqId'] === 'string';
}

// ─── RV-26: functions across the IPC boundary ─────────────────────────────

/** Key of the marker that stands in for a gateway-side function. */
export const HOST_CALLBACK_KEY = '__hostCallback';

export interface HostCallbackRef {
  [HOST_CALLBACK_KEY]: string;
}

export function isHostCallbackRef(value: unknown): value is HostCallbackRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>)[HOST_CALLBACK_KEY] === 'string'
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/**
 * Gateway side: replace every function in `value` (tool handlers, gate
 * callbacks, hook-bridge members) with a marker, registering the function
 * under the marker's id. Plain objects and arrays are walked; everything
 * else is copied as is.
 */
export function serializeHostCallbacks(value: unknown, register: (fn: (...args: unknown[]) => unknown) => string): unknown {
  if (typeof value === 'function') {
    return { [HOST_CALLBACK_KEY]: register(value as (...args: unknown[]) => unknown) } satisfies HostCallbackRef;
  }
  if (Array.isArray(value)) return value.map((v) => serializeHostCallbacks(v, register));
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = serializeHostCallbacks(v, register);
    return out;
  }
  return value;
}

/**
 * Host side: replace every marker with an async stub that calls the gateway
 * (`invoke(callbackId, args)`) and resolves with its answer.
 */
export function hydrateHostCallbacks(
  value: unknown,
  invoke: (callbackId: string, args: unknown[]) => Promise<unknown>,
): unknown {
  if (isHostCallbackRef(value)) {
    const id = value[HOST_CALLBACK_KEY];
    return (...args: unknown[]) => invoke(id, args.map(toWire));
  }
  if (Array.isArray(value)) return value.map((v) => hydrateHostCallbacks(v, invoke));
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = hydrateHostCallbacks(v, invoke);
    return out;
  }
  return value;
}

/** Arguments are JSON over the channel: functions and abort signals do not travel. */
function toWire(arg: unknown): unknown {
  if (typeof arg === 'function') return undefined;
  if (typeof AbortSignal !== 'undefined' && arg instanceof AbortSignal) return undefined;
  try {
    return JSON.parse(JSON.stringify(arg)) as unknown;
  } catch {
    return undefined;
  }
}
