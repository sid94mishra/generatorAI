// ────────────────────────────────────────────────────────────────
// How a client should trust an https:// endpoint from a pairing offer
// (D-125). One rule for the desktop, mobile and web clients:
//
//   install-ca  the server's own local CA vouches for it (D-110): a private
//               or loopback IP literal, `<host>.local`, `localhost`. No public
//               CA can certify these names, so a native client pins the CA
//               fingerprint the offer carries (`certificateFingerprint`) and
//               accepts exactly that CA for this host.
//   system      any other name — `<machine>.<tailnet>.ts.net` from "Connect
//               with Tailscale" (D-123), a reverse proxy, a custom domain —
//               carries a publicly trusted certificate: verify it normally,
//               never pin, and never accept the install CA for it (the CA's
//               name constraints forbid public names anyway).
//   none        plain http:// (loopback, or the native LAN lane, D-112).
// ────────────────────────────────────────────────────────────────

export type EndpointTrust = 'install-ca' | 'system' | 'none';

function isPrivateOrLoopbackIp(host: string): boolean {
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v6 = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (!v6.includes(':')) return false;
  return v6 === '::1' || /^f[cd][0-9a-f]{2}:/.test(v6);
}

export function endpointTrust(origin: string): EndpointTrust {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return 'none';
  }
  if (url.protocol !== 'https:') return 'none';
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || isPrivateOrLoopbackIp(host)) {
    return 'install-ca';
  }
  return 'system';
}

/** True for a Tailscale MagicDNS name (`<machine>.<tailnet>.ts.net`). */
export function isTailscaleOrigin(origin: string): boolean {
  try {
    return new URL(origin).hostname.toLowerCase().endsWith('.ts.net');
  } catch {
    return false;
  }
}
