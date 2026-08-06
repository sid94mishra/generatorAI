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
// loads the SPA from `http://<lan-ip>:<port>` and the browser attaches that
// Origin to every request, which the server then rejected — a CORS failure on
// the one flow whose entire purpose is connecting a second device.
//
// Only addresses this process is actually bound to are returned, so this
// widens the allowlist to exactly the surface the server already exposes and
// not one origin further.

import { networkInterfaces } from 'node:os';
import type { Container } from '../composition-root.js';
import { resolveAdvertisedEndpoints } from './advertisedEndpoints.js';

let cached: { key: string; origins: string[] } | null = null;

export function reachableOrigins(container: Container): string[] {
  const production = process.env['NODE_ENV'] === 'production';
  const port = container.config.port;
  const bindHost = container.security.posture.bindHost;

  // Interfaces change when a laptop moves network, but enumerating them on
  // every request (including every WebSocket upgrade) is wasteful. Key the
  // cache on the inputs that would change the answer.
  const key = `${production}|${port}|${bindHost}`;
  if (cached?.key === key) return cached.origins;

  const endpoints = resolveAdvertisedEndpoints({
    port,
    bindHost,
    networkInterfaces: networkInterfaces(),
  });

  // In development the UI and the API are different origins on the same host,
  // so the Vite ports have to be allowed too. In production the server serves
  // the SPA itself and only its own port is ever an origin.
  const ports = production
    ? [String(port)]
    : [String(port), '5173', '5174', '5175', '5176'];

  const origins: string[] = [];
  for (const endpoint of endpoints) {
    const { hostname } = new URL(endpoint.origin);
    const host = hostname.includes(':') ? `[${hostname}]` : hostname;
    for (const candidate of ports) {
      origins.push(`http://${host}:${candidate}`);
      // The dev server can run over TLS (GENERATORAI_DEV_HTTPS=1) so a second
      // machine gets the secure context a browser demands before it will
      // generate a device key. That changes the Origin scheme, and an
      // allowlist holding only the http:// spelling rejects it.
      if (!production) origins.push(`https://${host}:${candidate}`);
    }
  }

  cached = { key, origins };
  return origins;
}
