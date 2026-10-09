// ────────────────────────────────────────────────────────────────
// The scheme and authority a client used to reach us (D-111, D-114).
//
// Three security checks depend on it and must agree:
//   * the DPoP `htu` a client signed (`https://<host>/api/...` when it came
//     over TLS) — get the scheme wrong and every proof fails HTU_MISMATCH;
//   * whether a request arrived over plain HTTP from another device, which
//     the transport policy refuses for browsers;
//   * HSTS.
//
// Before D-114 three copies of this logic trusted `X-Forwarded-Proto` from
// ANY client, so a request could claim `https` and change what its proof was
// checked against. Forwarded headers are now honoured only when the operator
// opted in with `GENERATORAI_TRUST_PROXY` AND the request's immediate peer is
// that proxy:
//
//   unset / 0 / false     never (the default)
//   1 / true / loopback   a proxy on this machine — Tailscale Serve, Caddy or
//                         nginx on the same host forwarding to 127.0.0.1
//   <ip>[,<ip>…]          those exact proxy addresses (a reverse proxy on
//                         another host). Loopback is not implied.
//
// "Connect with Tailscale" (D-123, D-124) adds one narrow lane without that
// opt-in: `tailscale serve` terminates HTTPS for `<machine>.<tailnet>.ts.net`
// and forwards to 127.0.0.1:<port>, keeping the client's Host and setting
// `X-Forwarded-Host` (= Host), `X-Forwarded-Proto: https` and
// `X-Forwarded-For` (the tailnet peer). Its forwarded scheme is honoured only
// when ALL hold: the peer is loopback, Tailscale access is on, and both
// `Host` and `X-Forwarded-Host` (when sent) are exactly that ts.net name. A
// page rebinding its own name to 127.0.0.1 cannot meet it (its Host is its
// own name), and a local process that forges it only makes its request
// non-loopback — never more privileged. Unlike a GENERATORAI_TRUST_PROXY
// peer, the lane never bypasses the Host allow-list (the name is simply on
// it), and `Tailscale-User-*` headers are never read: device pairing (DPoP)
// stays the only authority.
// ────────────────────────────────────────────────────────────────

import { isLoopbackAddress } from '@generatorai/auth';

export type TrustProxyPolicy =
  | { mode: 'off' }
  | { mode: 'loopback' }
  | { mode: 'addresses'; addresses: ReadonlySet<string> };

function normaliseAddress(address: string): string {
  return address.trim().replace(/^::ffff:/, '').replace(/^\[|\]$/g, '').toLowerCase();
}

export function parseTrustProxy(value: string | undefined): TrustProxyPolicy {
  const raw = value?.trim().toLowerCase() ?? '';
  if (!raw || raw === '0' || raw === 'false' || raw === 'off' || raw === 'no') return { mode: 'off' };
  if (raw === '1' || raw === 'true' || raw === 'loopback' || raw === 'yes' || raw === 'on') return { mode: 'loopback' };
  const addresses = new Set(raw.split(',').map(normaliseAddress).filter(Boolean));
  return addresses.size > 0 ? { mode: 'addresses', addresses } : { mode: 'off' };
}

let processPolicy: TrustProxyPolicy | null = null;

/** The policy from `GENERATORAI_TRUST_PROXY`, read once. */
export function trustProxyPolicy(): TrustProxyPolicy {
  processPolicy ??= parseTrustProxy(process.env['GENERATORAI_TRUST_PROXY']);
  return processPolicy;
}

/** Test seam: forget the cached policy so the next read sees the environment again. */
export function resetTrustProxyPolicy(): void {
  processPolicy = null;
}

let tailscaleHost: string | null = null;

/**
 * The ts.net name `tailscale serve` forwards for, while Tailscale access is on
 * (lower-case, no trailing dot); null turns the lane off.
 */
export function setTailscaleServeHost(name: string | null): void {
  tailscaleHost = name ? name.trim().toLowerCase().replace(/\.$/, '') || null : null;
}

export function tailscaleServeHost(): string | null {
  return tailscaleHost;
}

/** `name[:port]` → `name`, lower-cased; IPv6 literals are never a ts.net name. */
function hostOnly(value: string): string {
  const v = value.trim().toLowerCase();
  if (v.startsWith('[')) return v;
  const colon = v.lastIndexOf(':');
  return (colon >= 0 && v.indexOf(':') === colon ? v.slice(0, colon) : v).replace(/\.$/, '');
}

/** True when this request came through `tailscale serve` for our ts.net name (the D-124 lane). */
export function isTailscaleServeRequest(req: OriginRequest, serveHost: string | null = tailscaleHost): boolean {
  if (!serveHost) return false;
  if (!isLoopbackAddress(req.socket.remoteAddress)) return false;
  const host = first(req.headers['host']);
  if (!host || hostOnly(host) !== serveHost) return false;
  const forwardedHost = first(req.headers['x-forwarded-host']);
  if (forwardedHost !== undefined && hostOnly(forwardedHost) !== serveHost) return false;
  return true;
}

export function isTrustedProxyPeer(policy: TrustProxyPolicy, remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return false;
  if (policy.mode === 'off') return false;
  if (policy.mode === 'loopback') return isLoopbackAddress(remoteAddress);
  return policy.addresses.has(normaliseAddress(remoteAddress));
}

/** The minimal request shape: Express `Request` and Node `IncomingMessage` both fit. */
export interface OriginRequest {
  headers: Record<string, string | string[] | undefined>;
  socket: { remoteAddress?: string | undefined; encrypted?: boolean };
}

function first(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  // A chain of proxies appends: the left-most entry is the client-facing hop.
  return raw?.split(',')[0]?.trim() || undefined;
}

export interface RequestOrigin {
  scheme: 'http' | 'https';
  /** `host[:port]` as the client addressed us, lower-cased (hosts are case-insensitive; F-7). */
  host: string;
  /** True when the scheme/host came from a trusted proxy's forwarded headers. */
  forwarded: boolean;
}

export function requestOrigin(
  req: OriginRequest,
  policy: TrustProxyPolicy = trustProxyPolicy(),
  serveHost: string | null = tailscaleHost,
): RequestOrigin {
  const direct: RequestOrigin = {
    scheme: req.socket.encrypted ? 'https' : 'http',
    host: (first(req.headers['host']) ?? 'localhost').toLowerCase(),
    forwarded: false,
  };
  if (!isTrustedProxyPeer(policy, req.socket.remoteAddress)) {
    if (!isTailscaleServeRequest(req, serveHost)) return direct;
    // The Host is already the ts.net name; only the scheme comes from the proxy.
    const proto = first(req.headers['x-forwarded-proto'])?.toLowerCase();
    return { scheme: proto === 'https' ? 'https' : direct.scheme, host: direct.host, forwarded: true };
  }
  const proto = first(req.headers['x-forwarded-proto'])?.toLowerCase();
  const host = first(req.headers['x-forwarded-host']);
  if (!proto && !host) return direct;
  return {
    scheme: proto === 'https' ? 'https' : proto === 'http' ? 'http' : direct.scheme,
    host: host?.toLowerCase() ?? direct.host,
    forwarded: true,
  };
}

/**
 * The address of the client itself, for per-source limits and audit: the
 * left-most `X-Forwarded-For` entry when the request came through a proxy we
 * trust (so every tailnet device does not share the proxy's 127.0.0.1
 * budget), otherwise the socket peer.
 */
export function requestClientAddress(req: OriginRequest, policy?: TrustProxyPolicy): string | null {
  const peer = req.socket.remoteAddress ?? null;
  if (!requestOrigin(req, policy).forwarded) return peer;
  return first(req.headers['x-forwarded-for']) ?? peer;
}

/** Absolute URL for DPoP `htu` binding: what the client signed. */
export function requestAbsoluteUrl(req: OriginRequest, path: string, policy?: TrustProxyPolicy): string {
  const origin = requestOrigin(req, policy);
  return `${origin.scheme}://${origin.host}${path}`;
}
