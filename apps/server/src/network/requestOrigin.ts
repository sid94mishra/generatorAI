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
  /** `host[:port]` exactly as the client addressed us. */
  host: string;
  /** True when the scheme/host came from a trusted proxy's forwarded headers. */
  forwarded: boolean;
}

export function requestOrigin(req: OriginRequest, policy: TrustProxyPolicy = trustProxyPolicy()): RequestOrigin {
  const direct: RequestOrigin = {
    scheme: req.socket.encrypted ? 'https' : 'http',
    host: first(req.headers['host']) ?? 'localhost',
    forwarded: false,
  };
  if (!isTrustedProxyPeer(policy, req.socket.remoteAddress)) return direct;
  const proto = first(req.headers['x-forwarded-proto'])?.toLowerCase();
  const host = first(req.headers['x-forwarded-host']);
  if (!proto && !host) return direct;
  return {
    scheme: proto === 'https' ? 'https' : proto === 'http' ? 'http' : direct.scheme,
    host: host ?? direct.host,
    forwarded: true,
  };
}

/** Absolute URL for DPoP `htu` binding: what the client signed. */
export function requestAbsoluteUrl(req: OriginRequest, path: string, policy?: TrustProxyPolicy): string {
  const origin = requestOrigin(req, policy);
  return `${origin.scheme}://${origin.host}${path}`;
}
