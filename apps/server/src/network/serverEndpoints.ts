// ────────────────────────────────────────────────────────────────
// The one place that answers "which URLs reach this server?" (D-110, D-112).
//
// Four callers used to assemble this separately — the pairing routes, the
// Network exposure route, the first-run bootstrap and the CORS/WebSocket
// origin allowlist — and they have to agree, so they now all ask here.
//
// Two audiences:
//   browser  a browser must be in a secure context to create its device key,
//            so once TLS is on every network address is `https://`, plus the
//            `<host>.local` name the certificate covers.
//   native   the mobile app cannot yet trust a self-signed certificate
//            (MV-44), so its pairing offer keeps the plain-HTTP LAN addresses
//            — still DPoP-bound on every request — and carries the CA
//            fingerprint it will pin once it can.
// ────────────────────────────────────────────────────────────────

import { hostname as osHostname, networkInterfaces as osNetworkInterfaces } from 'node:os';
import { resolveAdvertisedEndpoints, type AdvertisedEndpointCandidate, type NetworkInterfaces } from './advertisedEndpoints.js';
import { mdnsHostname } from './tls/certificateNames.js';
import type { TlsManager } from './tls/TlsManager.js';

export type EndpointAudience = 'browser' | 'native';

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
  audience: EndpointAudience;
  hostname?: string;
  networkInterfaces?: NetworkInterfaces;
  configuredOrigins?: readonly string[];
}

export function serverEndpoints(input: ServerEndpointsInput): AdvertisedEndpointCandidate[] {
  const secure = input.tls !== null && input.audience === 'browser';
  const mdns = secure ? mdnsHostname(input.hostname ?? osHostname()) : null;
  return resolveAdvertisedEndpoints({
    port: input.port,
    bindHost: input.bindHost,
    configuredOrigins: input.configuredOrigins ?? configuredAdvertisedOrigins(),
    networkInterfaces: input.networkInterfaces ?? osNetworkInterfaces(),
    lanScheme: secure ? 'https' : 'http',
    hostnames: secure ? [...(mdns ? [mdns] : []), ...(input.tls?.extraHostnames() ?? [])] : [],
  });
}
