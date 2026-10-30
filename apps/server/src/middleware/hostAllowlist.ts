// ────────────────────────────────────────────────────────────────
// Host-header allow-list — the DNS-rebinding defence (D-119).
//
// A web page on `evil.example` can re-point its own DNS name at 127.0.0.1 (or
// at this machine's LAN address) and then talk to this server as a
// SAME-ORIGIN page: no CORS preflight, no foreign `Origin`. What it cannot
// change is the `Host` header — the browser sends the name the page was
// loaded from. So every request (public routes included, and every WebSocket
// upgrade) must name this server: Ollama CVE-2024-28224, MCP Inspector
// CVE-2025-49596 and Jupyter's `allow_remote_access` all close it this way.
//
// Allowed:
//   * no `Host` at all — a browser always sends one, so it is not a page;
//   * any IP literal — rebinding needs a DNS name by definition;
//   * `localhost` and `*.localhost` (resolved to loopback by the OS/browser);
//   * this computer's names: the OS hostname, its first label, `<label>.local`,
//     and — only when the server is exposed beyond loopback — any name whose
//     first label is this hostname (`<host>.lan`, `<host>.<tailnet>.ts.net`),
//     the same rule D-113 uses for a custom certificate;
//   * the hosts of `GENERATORAI_ADVERTISED_URL(S)`, the DNS names of the served
//     certificate (generated or brought), and `GENERATORAI_ALLOWED_HOSTS`
//     (comma list; `.example.com` allows a suffix; `*` turns the check off);
//   * a request from a proxy the operator trusts (D-114): it does its own
//     host routing;
//   * the `<machine>.<tailnet>.ts.net` name while "Connect with Tailscale"
//     is on (D-123) — by name only: `tailscale serve` keeps the client's
//     Host, so its requests need no proxy bypass, and a loopback peer with
//     any other Host is still refused.
// Everything else gets 421 `HOST_NOT_ALLOWED`, before auth and before CORS.
// ────────────────────────────────────────────────────────────────

import { isIP } from 'node:net';
import { hostname as osHostname } from 'node:os';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { isLoopbackAddress } from '@generatorai/auth';
import { configuredAdvertisedHosts } from '../network/serverEndpoints.js';
import { isTrustedProxyPeer, tailscaleServeHost, trustProxyPolicy, type TrustProxyPolicy } from '../network/requestOrigin.js';

export const HOST_NOT_ALLOWED_CODE = 'HOST_NOT_ALLOWED';

export interface HostAllowlist {
  /** True when the check is off (`GENERATORAI_ALLOWED_HOSTS=*`). */
  any: boolean;
  /** Exact lower-case DNS names. */
  names: ReadonlySet<string>;
  /** Lower-case suffixes, each starting with a dot. */
  suffixes: readonly string[];
  /** Lower-case first DNS label of this computer, when names in any zone may use it. */
  hostLabel: string | null;
}

export interface HostAllowlistInput {
  bindHost: string;
  /** DNS names (and IPs, ignored here) the served certificate covers. */
  certificateNames?: readonly string[];
  extraHostnames?: readonly string[];
  hostname?: string;
  env?: NodeJS.ProcessEnv;
}

function normaliseName(name: string): string {
  return name.trim().toLowerCase().replace(/\.$/, '');
}

export function buildHostAllowlist(input: HostAllowlistInput): HostAllowlist {
  const env = input.env ?? process.env;
  const configured = (env['GENERATORAI_ALLOWED_HOSTS'] ?? '')
    .split(',')
    .map(normaliseName)
    .filter(Boolean);
  const names = new Set<string>();
  const suffixes: string[] = [];
  for (const entry of configured) {
    if (entry.startsWith('.')) suffixes.push(entry);
    else names.add(entry);
  }

  const host = normaliseName(input.hostname ?? osHostname());
  const label = host.split('.')[0] ?? '';
  if (host) names.add(host);
  if (label) {
    names.add(label);
    names.add(`${label}.local`);
  }
  for (const advertised of configuredAdvertisedHosts(env)) names.add(normaliseName(advertised));
  for (const name of [...(input.certificateNames ?? []), ...(input.extraHostnames ?? [])]) {
    if (isIP(name) === 0) names.add(normaliseName(name));
  }

  return {
    any: configured.includes('*'),
    names,
    suffixes,
    hostLabel: label && !isLoopbackAddress(input.bindHost) && input.bindHost !== 'localhost' ? label : null,
  };
}

/** The hostname part of a `Host` header (`name[:port]`, `[v6][:port]`), lower-cased; null when malformed. */
export function hostnameOfHeader(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    if (end < 0) return null;
    const rest = value.slice(end + 1);
    if (rest && !/^:\d{1,5}$/.test(rest)) return null;
    return value.slice(1, end).toLowerCase();
  }
  const colon = value.lastIndexOf(':');
  // More than one colon without brackets: a bare IPv6 literal (not valid in Host, but unambiguous).
  if (colon >= 0 && value.indexOf(':') === colon) {
    if (!/^\d{1,5}$/.test(value.slice(colon + 1))) return null;
    return normaliseName(value.slice(0, colon));
  }
  if (colon >= 0) return isIP(value) === 6 ? value.toLowerCase() : null;
  return normaliseName(value);
}

export function isHostAllowed(rawHost: string | undefined, allowlist: HostAllowlist): boolean {
  if (rawHost === undefined) return true;
  if (allowlist.any) return true;
  const host = hostnameOfHeader(rawHost);
  if (!host) return false;
  if (isIP(host) !== 0) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (allowlist.names.has(host)) return true;
  if (allowlist.suffixes.some((suffix) => host.endsWith(suffix))) return true;
  if (allowlist.hostLabel && host.split('.')[0] === allowlist.hostLabel) return true;
  return false;
}

export interface HostCheckRequest {
  headers: Record<string, string | string[] | undefined>;
  socket: { remoteAddress?: string | undefined };
}

/** The whole check, shared by the HTTP middleware and the WebSocket upgrade path. */
export function hostCheck(
  req: HostCheckRequest,
  allowlist: HostAllowlist,
  policy: TrustProxyPolicy = trustProxyPolicy(),
): { ok: true } | { ok: false; host: string } {
  const header = req.headers['host'];
  const raw = Array.isArray(header) ? header[0] : header;
  if (isHostAllowed(raw, allowlist)) return { ok: true };
  if (isTrustedProxyPeer(policy, req.socket.remoteAddress)) return { ok: true };
  return { ok: false, host: raw ?? '' };
}

export function hostNotAllowedMessage(host: string): string {
  return (
    `This server does not answer to "${host.slice(0, 200)}". Use its IP address or localhost, or, if this name ` +
    'is yours, add it to GENERATORAI_ALLOWED_HOSTS.'
  );
}

export interface HostAllowlistMiddlewareOptions {
  allowlist: () => HostAllowlist;
  policy?: TrustProxyPolicy;
  onReject?: (host: string, req: Request) => void;
}

export function createHostAllowlistMiddleware(options: HostAllowlistMiddlewareOptions): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = hostCheck(req, options.allowlist(), options.policy);
    if (result.ok) {
      next();
      return;
    }
    options.onReject?.(result.host, req);
    res.status(421).json({
      error: { code: HOST_NOT_ALLOWED_CODE, message: hostNotAllowedMessage(result.host), requestId: req.requestId },
    });
  };
}

/** What the composition knows; `Container` satisfies it. */
export interface HostAllowlistSource {
  security: {
    posture: { bindHost: string };
    tls: { version: number; status(): { names: string[] }; extraHostnames(): string[] } | null;
  };
}

const CACHE_TTL_MS = 30_000;
let cached: { key: string; at: number; allowlist: HostAllowlist } | null = null;

/** The allow-list for this server, cached briefly (the hostname and certificate rarely change). */
export function serverHostAllowlist(source: HostAllowlistSource): HostAllowlist {
  const { bindHost } = source.security.posture;
  const tls = source.security.tls;
  const key = [
    bindHost,
    tls ? tls.version : 'plain',
    process.env['GENERATORAI_ALLOWED_HOSTS'] ?? '',
    process.env['GENERATORAI_ADVERTISED_URL'] ?? '',
    process.env['GENERATORAI_ADVERTISED_URLS'] ?? '',
    tailscaleServeHost() ?? '',
  ].join('|');
  if (cached?.key === key && Date.now() - cached.at < CACHE_TTL_MS) return cached.allowlist;
  let certificateNames: string[] = [];
  let extraHostnames: string[] = [];
  try {
    certificateNames = tls?.status().names ?? [];
    extraHostnames = tls?.extraHostnames() ?? [];
  } catch {
    // Not initialised yet — the loopback and hostname names still apply.
  }
  const tailscale = tailscaleServeHost();
  if (tailscale) extraHostnames = [...extraHostnames, tailscale];
  const allowlist = buildHostAllowlist({ bindHost, certificateNames, extraHostnames });
  cached = { key, at: Date.now(), allowlist };
  return allowlist;
}

/** Test seam. */
export function resetHostAllowlistCache(): void {
  cached = null;
}
