// ────────────────────────────────────────────────────────────────
// Relay route table — the ONE place the relay's URL layout is written down.
//
// The host connector (`apps/server/src/relay/RelayHostBroker.ts`) and the
// relay itself (`apps/relay`) were once built against two different route
// tables (`/v1/hosts/register` + `/v1/host` vs `/relay/assignment` +
// `/relay/host`) and had never been run against each other. Both sides now
// import their paths from here, so a rename is a one-line change that the
// type checker and the end-to-end test catch on the other side.
//
// Canonical shapes:
//   * `directorUrl` and `cellUrl` (in an assignment AND in a pairing offer)
//     are bare http(s) ORIGINS — no path, no trailing slash. The pairing
//     offer schema already required this (`isCanonicalHttpsOrigin`); the
//     relay used to hand out `wss://…/relay/host` here, which that schema
//     rejects.
//   * WebSocket URLs are derived from the origin with the helpers below,
//     never assembled by hand.
// ────────────────────────────────────────────────────────────────

import { randomBytes, toBase64Url } from './bytes.js';

export const RELAY_ROUTES = {
  /** Director: `GET ?relayHostId=…` → `RelayAssignment`. */
  assignment: '/relay/assignment',
  /** Cell: host control channel (WebSocket, text frames only). */
  host: '/relay/host',
  /** Cell: paired-device connection (WebSocket). */
  client: '/relay/client',
  /** Cell: per-stream byte pipe dialled back by the host (WebSocket). */
  data: '/relay/data',
  /** Liveness + capacity. */
  health: '/healthz',
} as const;

export type RelayRoute = (typeof RELAY_ROUTES)[keyof typeof RELAY_ROUTES];

/**
 * Normalises any relay URL — `ws://`, `wss://`, `http://`, `https://`, with
 * or without a path — to its canonical http(s) origin. This is the form that
 * appears in assignments, pairing offers and the host-proof transcript's
 * `relayOrigin`, so a host and a cell configured with different schemes
 * still agree on what they are signing.
 *
 * Returns null when the input is not an absolute URL on one of those schemes.
 */
export function canonicalRelayOrigin(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  switch (parsed.protocol) {
    case 'ws:':
      parsed.protocol = 'http:';
      break;
    case 'wss:':
      parsed.protocol = 'https:';
      break;
    case 'http:':
    case 'https:':
      break;
    default:
      return null;
  }
  return parsed.origin;
}

function websocketUrl(origin: string, route: RelayRoute): URL {
  const canonical = canonicalRelayOrigin(origin);
  if (!canonical) throw new Error(`Not a relay origin: ${origin}`);
  const url = new URL(canonical);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = route;
  return url;
}

/** `GET` URL a host calls to learn which cell it is assigned to. */
export function relayAssignmentUrl(directorUrl: string, relayHostId: string): string {
  const canonical = canonicalRelayOrigin(directorUrl);
  if (!canonical) throw new Error(`Not a relay origin: ${directorUrl}`);
  const url = new URL(canonical);
  url.pathname = RELAY_ROUTES.assignment;
  url.searchParams.set('relayHostId', relayHostId);
  return url.toString();
}

/** WebSocket URL of the host control channel on `cellUrl`. */
export function relayHostSocketUrl(cellUrl: string): string {
  return websocketUrl(cellUrl, RELAY_ROUTES.host).toString();
}

/** WebSocket URL a paired device dials on `cellUrl`. */
export function relayClientSocketUrl(cellUrl: string): string {
  return websocketUrl(cellUrl, RELAY_ROUTES.client).toString();
}

/** WebSocket URL the host dials back for one stream's bytes. */
export function relayDataSocketUrl(
  cellUrl: string,
  params: { streamId: string; relayHostId: string },
): string {
  const url = websocketUrl(cellUrl, RELAY_ROUTES.data);
  url.searchParams.set('streamId', params.streamId);
  url.searchParams.set('relayHostId', params.relayHostId);
  return url.toString();
}

/** Health-check URL on a relay origin. */
export function relayHealthUrl(origin: string): string {
  const canonical = canonicalRelayOrigin(origin);
  if (!canonical) throw new Error(`Not a relay origin: ${origin}`);
  const url = new URL(canonical);
  url.pathname = RELAY_ROUTES.health;
  return url.toString();
}

/** Character class every `streamId` on the wire must satisfy (`Base64Url`). */
export const RELAY_STREAM_ID_PATTERN = /^[A-Za-z0-9_-]{1,512}$/;

/**
 * Mints a stream id the wire schema accepts.
 *
 * The cell used to build `${relayBinding}:${uuid}` — the colon is outside the
 * `Base64Url` character class, so the cell's own `stream_open` failed the
 * host's strict parser and the host closed the control channel on the very
 * first client. Any per-stream metadata (the binding) now lives in the cell's
 * stream table, never in the identifier.
 */
export function newRelayStreamId(): string {
  return toBase64Url(randomBytes(24));
}

export function isRelayStreamId(value: string): boolean {
  return RELAY_STREAM_ID_PATTERN.test(value);
}
