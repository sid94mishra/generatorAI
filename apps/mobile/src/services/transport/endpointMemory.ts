// ────────────────────────────────────────────────────────────────
// Which of a server's addresses to try first (MV-44, MD-203).
//
// A pairing offer lists every address the server answers on — the ts.net name
// first when "Connect with Tailscale" serves it (D-123), then the LAN https://
// addresses, `<host>.local`, loopback. A phone without Tailscale cannot reach
// the first, and a laptop's LAN address moves with DHCP. So the app tries the
// list in order with a short timeout per address, uses the first that answers,
// and remembers it per server: the next start tries it first and falls back to
// the rest when it stops answering. The app has no network identity to key on
// (an SSID needs location permission), so "per network" is the self-correcting
// order: the address that worked last goes first until it fails.
//
// Pure ordering here; the prefs adapter is injected (unit-tested on node).
// ────────────────────────────────────────────────────────────────

import { usableEndpoints } from './trust';

/** Per-address budget while picking a route: long enough for a LAN TLS handshake, short enough to fall through fast. */
export const ENDPOINT_PROBE_TIMEOUT_MS = 3_000;

export interface EndpointMemoryStore {
  getString(key: string): string | undefined;
  setString(key: string, value: string): void;
}

const keyFor = (serverId: string): string => `srv.${serverId}.endpoint.last`;

export function rememberedEndpoint(store: EndpointMemoryStore, serverId: string): string | null {
  return store.getString(keyFor(serverId)) ?? null;
}

export function rememberEndpoint(store: EndpointMemoryStore, serverId: string, origin: string): void {
  if (store.getString(keyFor(serverId)) !== origin) store.setString(keyFor(serverId), origin);
}

/**
 * The order to try: the remembered address first (only if the server still lists it), then the given order, without
 * duplicates and without plain HTTP to another device (MD-201).
 */
export function orderEndpoints(endpoints: readonly string[], remembered: string | null): string[] {
  const usable = [...new Set(usableEndpoints(endpoints))];
  if (!remembered || !usable.includes(remembered)) return usable;
  return [remembered, ...usable.filter((endpoint) => endpoint !== remembered)];
}
