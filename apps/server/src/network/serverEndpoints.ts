// ────────────────────────────────────────────────────────────────
// The one place that answers "which URLs reach this server?" (D-110, D-127).
//
// Four callers used to assemble this separately — the pairing routes, the
// Network exposure route, the first-run bootstrap and the CORS/WebSocket
// origin allowlist — and they have to agree, so they now all ask here.
//
// "Connect with Tailscale" (D-123) puts `https://<machine>.<tailnet>.ts.net`
// first for every audience while it serves this server.
//
// One list for every client (D-127): once TLS is on, every network address
// is `https://`, plus the `<host>.local` name the certificate covers. A
// browser needs the secure context to create its device key; the mobile app
// pins the local CA the offer names (MV-44). Loopback stays
// `http://127.0.0.1` — the same machine needs no TLS.
// ────────────────────────────────────────────────────────────────

import { hostname as osHostname, networkInterfaces as osNetworkInterfaces } from 'node:os';
import { resolveAdvertisedEndpoints, type AdvertisedEndpointCandidate, type NetworkInterfaces } from './advertisedEndpoints.js';
import { mdnsHostname } from './tls/certificateNames.js';
import type { TlsManager } from './tls/TlsManager.js';
import { tailscaleAdvertisedOrigin } from './tailscale/TailscaleAccess.js';

/** `GENERATORAI_ADVERTISED_URLS` (comma-separated) and `GENERATORAI_ADVERTISED_URL`. */
export function configuredAdvertisedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  return [
    ...(env['GENERATORAI_ADVERTISED_URLS']?.split(',') ?? []),
    ...(env['GENERATORAI_ADVERTISED_URL'] ? [env['GENERATORAI_ADVERTISED_URL']] : []),
  ]
    .map((value) => value.trim())
    .filter(Boolean);
}

/** Hosts of the configured advertised URLs, for certificate name checks. */
export function configuredAdvertisedHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  const hosts: string[] = [];
  for (const origin of configuredAdvertisedOrigins(env)) {
    try {
      hosts.push(new URL(origin).hostname.replace(/^\[|\]$/g, ''));
    } catch {
      // Malformed entries are ignored here; resolveAdvertisedEndpoints drops them too.
    }
  }
  return hosts;
}

export interface ServerEndpointsInput {
  port: number;
  bindHost: string;
  tls: TlsManager | null;
  hostname?: string;
  networkInterfaces?: NetworkInterfaces;
  configuredOrigins?: readonly string[];
  /** Defaults to the live "Connect with Tailscale" origin (D-123). */
  tailscaleOrigin?: string | null;
}

export function serverEndpoints(input: ServerEndpointsInput): AdvertisedEndpointCandidate[] {
  const secure = input.tls !== null;
  const mdns = secure ? mdnsHostname(input.hostname ?? osHostname()) : null;
  return resolveAdvertisedEndpoints({
    port: input.port,
    bindHost: input.bindHost,
    configuredOrigins: input.configuredOrigins ?? configuredAdvertisedOrigins(),
    networkInterfaces: input.networkInterfaces ?? osNetworkInterfaces(),
    lanScheme: secure ? 'https' : 'http',
    hostnames: secure ? [...(mdns ? [mdns] : []), ...(input.tls?.extraHostnames() ?? [])] : [],
    // The ts.net certificate is publicly trusted: no client pins it (D-125).
    tailscaleOrigin: input.tailscaleOrigin === undefined ? tailscaleAdvertisedOrigin() : input.tailscaleOrigin,
  });
}
