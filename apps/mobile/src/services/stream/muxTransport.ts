// ────────────────────────────────────────────────────────────────
// The mobile half of W09-a's multiplexed stream.
//
// Mobile was the last surface on the per-scope endpoint
// (`GET /api/stream?scope=chat&id=…`), one connection per scope, and it only
// ever subscribed ONE scope — `chat`. That is two separate problems:
//
//   * connection count: every scope the app wants (a chat, and now `global`)
//     would be its own socket, its own ticket, its own reconnect loop and its
//     own stall watchdog;
//   * parity: with no `global` subscription the list screens had no live
//     lifecycle events at all and fell back on TanStack's 30 s staleness — a
//     chat created on the desktop took up to half a minute to appear.
//
// `MuxStreamClient` (client-core) already solves the first for web and the
// CLI against the same server endpoints. This module is what lets RN use it:
// RN's global `fetch` is XHR-backed and gives no `response.body`, so the
// attach GET goes through `expo/fetch` — which streams — authorised by the
// connection ticket rather than a DPoP header. Control-plane calls
// (`POST /connections`, `POST .../subs`) keep going through the authenticated
// fetch, because those are ordinary request/response calls that RN handles
// fine and that DPoP must sign.
//
// `SseClient` — mobile's hand-rolled single-scope reader — is deleted with
// this change rather than left behind. It had exactly one caller, and a
// second, unreachable implementation of resume/backoff/stall detection is the
// thing this whole overhaul keeps finding: real code with no production path
// that nonetheless reads as covered. The terminal and STT surfaces use
// WebSockets, not SSE, so nothing else depended on it.
// ────────────────────────────────────────────────────────────────

import { MuxStreamClient, queryKeys } from '@generatorai/client-core';

export interface MobileMuxOptions {
  /** The authenticated, DPoP-signing fetch from `useAuth()`. */
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
  /** Origin for the streaming attach; from `useAuth().endpoint`. */
  endpoint: string;
  /**
   * Opens the long-lived attach GET.
   *
   * Injected rather than imported here so this module stays free of
   * `expo/fetch`, which cannot be loaded outside a React Native runtime — an
   * import of it at module scope would make the whole transport untestable in
   * the node-only suite this app deliberately runs. The app passes
   * `expoStreamFetch`; tests pass a plain one.
   */
  streamFetch: (url: string, init: RequestInit) => Promise<Response>;
}

/**
 * A shared connection for this auth session.
 *
 * One per session, not per screen: the whole point is that a chat screen and
 * the app-wide `global` subscription ride the same socket.
 */
export function createMobileMuxClient(options: MobileMuxOptions): MuxStreamClient {
  return new MuxStreamClient({
    fetch: options.fetch,
    endpoint: options.endpoint,
    streamFetch: options.streamFetch,
  });
}

/**
 * Kind prefixes the `global` scope subscription cares about.
 *
 * The server only publishes a closed set of lifecycle kinds to `global`
 * (`apps/server/src/composition/streamScopes.ts`), so this filter is belt and
 * braces rather than the primary defence — but it is what keeps a future
 * addition on the server from silently becoming phone traffic.
 */
export const GLOBAL_SCOPE_FILTER: readonly string[] = [
  'chat.',
  'workflow_run.',
  'automation_execution.',
  // A scope request being answered. Without it the phone kept its old
  // permissions for up to the access-token lifetime after an admin approved
  // it, and "Request access" appeared not to work.
  'device.scope_request',
];

/** `scope=global` is addressed by the literal id `all`. */
export const GLOBAL_SCOPE_ID = 'all';

/**
 * Which list an event kind invalidates.
 *
 * Lives here rather than beside the hook so it can be tested at all: the hook
 * imports `MuxStreamProvider`, which imports `react-native`, which the
 * node-only mobile suite cannot load. Pure routing therefore lives on the
 * RN-free side of the line and the hook is the thin part.
 *
 * Deliberately coarse — a lifecycle event invalidates the LIST it belongs to
 * and nothing else. A list view is the only thing that goes wrong when one of
 * these is missed; anything finer belongs to the scope that owns the entity.
 */
export function listKeysForEvent(kind: string): readonly (readonly unknown[])[] {
  if (kind.startsWith('chat.')) return [queryKeys.chats()];
  if (kind.startsWith('workflow_run.')) return [queryKeys.runs(), queryKeys.workflows()];
  if (kind.startsWith('automation_execution.')) return [queryKeys.automations()];
  if (kind.startsWith('device.scope_request')) {
    return [queryKeys.myScopeRequests(), queryKeys.pendingScopeRequests()];
  }
  return [];
}

/** Applies a batch of already-deduplicated, JSON-encoded keys. */
export function invalidateListKeys(
  queryClient: { invalidateQueries(filters: { queryKey: unknown[] }): unknown },
  keys: Iterable<string>,
): void {
  for (const key of keys) {
    void queryClient.invalidateQueries({ queryKey: JSON.parse(key) as unknown[] });
  }
}

/**
 * True when `event` says a scope request from THIS device was approved — the
 * moment to refresh the session so the new permissions apply immediately.
 */
export function isOwnScopeApproval(
  event: { kind: string; data?: unknown },
  deviceId: string | null,
): boolean {
  if (!deviceId || event.kind !== 'device.scope_request_resolved') return false;
  const data = event.data as { deviceId?: unknown; status?: unknown } | undefined;
  return data?.deviceId === deviceId && data?.status === 'approved';
}
