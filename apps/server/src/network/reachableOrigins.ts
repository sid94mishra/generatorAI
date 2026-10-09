// ────────────────────────────────────────────────────────────────
// Origins this server is genuinely reachable on.
// ────────────────────────────────────────────────────────────────
//
// The CORS allowlist and the WebSocket upgrade check both need this, and they
// must agree: an origin allowed to call the REST API but refused on upgrade
// produces a session that loads and then silently cannot open a terminal or a
// live stream — with a browser-side error that names neither cause.
//
// The default allowlist is written for single-machine development and only
// knows the loopback spellings. Once network access is on, a second device
// loads the SPA from `https://<lan-ip>:<port>` (D-110) and the browser attaches that
// Origin to every request, which the server then rejected — a CORS failure on
// the one flow whose entire purpose is connecting a second device.
//
// Only addresses this process is actually bound to are returned, so this
// widens the allowlist to exactly the surface the server already exposes and
// not one origin further.

import type { Container } from '../composition-root.js';
import { serverEndpoints } from './serverEndpoints.js';
import { tailscaleServeHost } from './requestOrigin.js';

/**
 * How long one enumeration of the network adapters is reused. Interfaces
 * change when a laptop moves network — and with TLS on, the https:// origins
 * move with them (D-110) — but enumerating on every request, including every
 * WebSocket upgrade, is wasteful.
 */
const CACHE_TTL_MS = 30_000;

let cached: { key: string; at: number; origins: string[] } | null = null;

export function reachableOrigins(container: Container): string[] {
  const production = process.env['NODE_ENV'] === 'production';
  const port = container.config.port;
  const bindHost = container.security.posture.bindHost;
  const tls = container.security.tls;

  const tailscale = tailscaleServeHost();
  const key = `${production}|${port}|${bindHost}|${tls ? tls.version : 'plain'}|${tailscale ?? ''}`;
  if (cached?.key === key && Date.now() - cached.at < CACHE_TTL_MS) return cached.origins;

  const endpoints = serverEndpoints({ port, bindHost, tls });

  // In development the UI and the API are different origins on the same host,
  // so the Vite ports have to be allowed too. In production the server serves
  // the SPA itself and only its own port is ever an origin.
  const ports = production
    ? [String(port)]
    : [String(port), '5173', '5174', '5175', '5176'];

  const origins = new Set<string>();
  for (const endpoint of endpoints) {
    const url = new URL(endpoint.origin);
    if (endpoint.source === 'configured' || endpoint.source === 'tailscale') {
      // An operator-configured URL (a Tailscale Serve name, a reverse proxy)
      // is an origin exactly as written.
      origins.add(url.origin);
      continue;
    }
    const host = url.hostname.includes(':') && !url.hostname.startsWith('[') ? `[${url.hostname}]` : url.hostname;
    for (const candidate of ports) {
      origins.add(`${url.protocol}//${host}:${candidate}`);
      // The dev server can run over TLS (GENERATORAI_DEV_HTTPS=1) so a second
      // machine gets the secure context a browser demands before it will
      // generate a device key. That changes the Origin scheme, and an
      // allowlist holding only the http:// spelling rejects it.
      if (!production) origins.add(`https://${host}:${candidate}`);
    }
  }
  // "Connect with Tailscale" (D-123): pages served at https://<name>.ts.net
  // call the API with that Origin.
  if (tailscale) origins.add(`https://${tailscale}`);
  // With TLS on the same port also answers https on loopback (D-111).
  if (tls) {
    origins.add(`https://127.0.0.1:${port}`);
    origins.add(`https://localhost:${port}`);
  }

  cached = { key, at: Date.now(), origins: [...origins] };
  return cached.origins;
}
